'use strict';
/**
 * jevShadow.js — Jev (TypeSafe AI) em MODO SOMBRA.
 *
 * O que faz: para cada mensagem de hóspede (WhatsApp e SMM/OTAs), classifica em paralelo
 * (intenção, "pede humano", urgência) e GRAVA o resultado para comparação com o regex atual.
 * NÃO altera nenhuma resposta, rota ou escalonamento. É fire-and-forget: o atendimento nunca
 * espera o Jev e nunca é afetado por ele.
 *
 * Liga/desliga por ambiente (sem redeploy de código):
 *   TYPESAFE_MODE=shadow  (qualquer outro valor ou ausente = OFF, padrão)
 *   TYPESAFE_API_KEY=...  (sem chave = OFF)
 * Opcionais: TYPESAFE_MODEL (padrão jev-1.14.0), TYPESAFE_TIMEOUT_MS (2500),
 *            TYPESAFE_MAX_PER_MIN (60, trava de custo), TYPESAFE_API_BASE.
 *
 * Privacidade: só o TEXTO da mensagem é enviado (sem telefone, nome ou código de reserva),
 * com CPF, cartão, e-mail e telefone mascarados antes de sair.
 * Saída: linha `[jev-shadow] {json}` no log + documento na coleção `jev_shadow` (TTL 45 dias).
 *
 * Docs: https://docs.typesafe.ai/api/system-one.md · custo: US$ 0,042 por milhão de tokens de entrada.
 */

const crypto = require('crypto');

const BASE = () => (process.env.TYPESAFE_API_BASE || 'https://api.typesafe.ai').replace(/\/$/, '');
const MODEL = () => process.env.TYPESAFE_MODEL || 'jev-1.14.0';
const TIMEOUT_MS = () => Number(process.env.TYPESAFE_TIMEOUT_MS || 2500);
const MAX_PER_MIN = () => Number(process.env.TYPESAFE_MAX_PER_MIN || 60);
const PRICE_IN_PER_TOKEN = 0.042 / 1e6;

function enabled() {
  return String(process.env.TYPESAFE_MODE || 'off').toLowerCase() === 'shadow' && !!process.env.TYPESAFE_API_KEY;
}

// ── mascaramento antes de enviar/gravar ──────────────────────────────────────────────────
function mask(s) {
  return String(s || '')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[doc]')
    .replace(/\b\d{4}[ .-]?\d{4}[ .-]?\d{4}[ .-]?\d{4}\b/g, '[cartao]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\+?\d[\d\s().-]{8,}\d/g, '[tel]')
    .slice(0, 1500);
}

// ── perguntas (iguais às validadas no bench de 24/10/2026, + café e datas por serem centrais no bot) ──
const INTENCOES = {
  wifi_acesso: 'Senha do Wi-Fi, código da porta/fechadura, como entrar no prédio ou apartamento',
  checkin_checkout: 'Horários, antecipar/estender check-in ou check-out, instruções de chegada e saída',
  manutencao: 'Algo quebrado ou sem funcionar: chuveiro, ar-condicionado, luz, internet caiu, vazamento',
  limpeza: 'Pedido de limpeza, troca de roupa de cama ou toalhas, itens de higiene',
  cobranca_reembolso: 'Cobrança indevida, cobrança duplicada, pedido de reembolso, nota fiscal, pagamento',
  cancelamento: 'Cancelar a reserva',
  alteracao_datas: 'Alterar, remarcar ou trocar as datas ou o apartamento da reserva',
  cafe_da_manha: 'Perguntas sobre café da manhã: se está incluso, horário, oferta',
  informacao_local: 'Dicas da região, restaurantes, transporte, mercado, farmácia',
  outro: 'Nada acima, ou mensagem sem pedido claro (ex.: agradecimento, saudação)',
};
const URGENCIA = [
  'Pode esperar: curiosidade, informação geral, pedido sem prazo, agradecimento',
  'Atenção hoje: afeta conforto ou trabalho, mas a pessoa consegue esperar algumas horas',
  'Urgente agora: sem acesso ou sem serviço essencial (porta, água quente, luz, internet para trabalhar), emergência de saúde, dinheiro em risco ou cobrança indevida, cliente irritado',
];
const QUESTIONS = {
  intencao: { type: 'choice', instructions: 'Qual é o pedido principal desta mensagem de um hóspede de hospedagem?', criteria: INTENCOES },
  pede_humano: { type: 'noul', instructions: 'A pessoa pede explicitamente para falar com um humano, está irritada ou ameaçando, ou o assunto é dinheiro em disputa?' },
  urgencia: { type: 'score', instructions: 'Qual a urgência deste pedido?', criteria: URGENCIA },
};

// ── trava de custo: no máximo N chamadas/min por processo; dedup 10 min por (canal+texto) ──────────
let _bucket = { t: 0, n: 0 };
function allow() {
  const now = Date.now();
  if (now - _bucket.t > 60000) _bucket = { t: now, n: 0 };
  return ++_bucket.n <= MAX_PER_MIN();
}
const _seen = new Map();
function dedup(key) {
  const now = Date.now();
  for (const [k, t] of _seen) if (now - t > 600000) _seen.delete(k);
  if (_seen.has(key)) return true;
  _seen.set(key, now);
  return false;
}

let _sink = null; // injeção para teste
let _indexed = false;
async function persist(doc) {
  try {
    if (_sink) return _sink(doc);
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return;
    const col = mongoose.connection.db.collection('jev_shadow');
    if (!_indexed) { _indexed = true; col.createIndex({ ts: 1 }, { expireAfterSeconds: 45 * 24 * 3600 }).catch(() => {}); }
    await col.insertOne(doc);
  } catch (_) { /* gravação é best-effort */ }
}

/** Chama o Jev. Devolve null em qualquer falha. */
async function classify(text) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS());
  const t0 = Date.now();
  try {
    const resp = await fetch(`${BASE()}/v1/systemone`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), state: { mensagem: mask(text) }, questions: QUESTIONS }),
      signal: ctrl.signal,
    });
    if (!resp.ok) { console.warn('[jev-shadow] HTTP', resp.status); return null; }
    const j = await resp.json();
    const a = j && j.answers;
    if (!a || !a.intencao || !a.urgencia || !a.pede_humano) return null;
    const tokens = (j.usage && j.usage.input_tokens) || 0;
    return {
      intencao: a.intencao.choice, confIntencao: a.intencao.confidence,
      pedeHumano: a.pede_humano.noul,
      urgencia: a.urgencia.score, confUrgencia: a.urgencia.confidence,
      ms: Date.now() - t0, tokens, costUSD: tokens * PRICE_IN_PER_TOKEN, model: j.model || MODEL(),
    };
  } catch (e) {
    console.warn('[jev-shadow] falha:', e && e.name === 'AbortError' ? 'timeout' : (e && e.message));
    return null;
  } finally { clearTimeout(timer); }
}

/**
 * Observa uma mensagem. Nunca lança, nunca bloqueia (não use await).
 * @param {{channel:string, tenantId?:string, text:string, regex?:object}} p
 *   regex = o que o fluxo ATUAL decidiria (ex.: {cancel:bool, human:bool, escalation:string|null}) — para comparar.
 */
function observe(p) {
  try {
    if (!enabled() || !p || !p.text || String(p.text).trim().length < 2) return;
    if (dedup(`${p.channel}:${crypto.createHash('sha1').update(String(p.text)).digest('hex')}`)) return;
    if (!allow()) return;
    classify(p.text).then((r) => {
      if (!r) return;
      const doc = {
        ts: new Date(), v: 1, channel: p.channel || 'unknown', tenantId: p.tenantId || 'torres',
        texto: mask(p.text).slice(0, 400), regex: p.regex || null,
        intencao: r.intencao, confIntencao: Number(r.confIntencao.toFixed(3)),
        pedeHumano: Number(r.pedeHumano.toFixed(3)),
        urgencia: Number(r.urgencia.toFixed(2)), confUrgencia: Number(r.confUrgencia.toFixed(3)),
        ms: r.ms, tokens: r.tokens, costUSD: r.costUSD, model: r.model,
      };
      console.log('[jev-shadow] ' + JSON.stringify({ ch: doc.channel, tn: doc.tenantId, i: doc.intencao, ci: doc.confIntencao, h: doc.pedeHumano, u: doc.urgencia, rx: doc.regex, ms: doc.ms }));
      return persist(doc);
    }).catch(() => {});
  } catch (_) { /* nunca quebra o atendimento */ }
}

module.exports = { observe, enabled, classify, mask, QUESTIONS, _setSinkForTest: (f) => { _sink = f; }, _resetForTest: () => { _seen.clear(); _bucket = { t: 0, n: 0 }; } };
