'use strict';
// Teste offline do modo sombra do Jev (fetch e Mongo simulados). `node scripts/test-jev-shadow.js`
const assert = require('assert');
const jev = require('../services/jevShadow');

let n = 0;
const ok = (nome) => { n++; console.log('✓', nome); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const resp = (over = {}) => ({
  ok: true, status: 200,
  json: async () => ({ model: 'jev-1.14.0', usage: { input_tokens: 300, output_tokens: 5 }, answers: {
    intencao: { type: 'choice', choice: 'cancelamento', confidence: 0.96, probabilities: {} },
    pede_humano: { type: 'noul', noul: 0.12 },
    urgencia: { type: 'score', score: 1.4, confidence: 0.6, legend: {}, probabilities: {} },
    ...over } }),
});

(async () => {
  const docs = []; jev._setSinkForTest(async (d) => docs.push(d));
  const logs = []; const origLog = console.log; console.log = (...a) => { logs.push(a.join(' ')); };
  let calls = 0, lastBody = null, lastHeaders = null;
  global.fetch = async (url, init) => { calls++; lastBody = JSON.parse(init.body); lastHeaders = init.headers; assert.strictEqual(url, 'https://api.typesafe.ai/v1/systemone'); return resp(); };

  // 1) OFF por padrão
  delete process.env.TYPESAFE_MODE; delete process.env.TYPESAFE_API_KEY;
  jev.observe({ channel: 'whatsapp', text: 'quero cancelar' }); await wait(30);
  assert.strictEqual(calls, 0); ok('off por padrão: nenhuma chamada');

  // 2) modo shadow sem chave => off
  process.env.TYPESAFE_MODE = 'shadow';
  jev.observe({ channel: 'whatsapp', text: 'quero cancelar' }); await wait(30);
  assert.strictEqual(calls, 0); ok('shadow sem chave: nenhuma chamada');

  // 3) 'enforce' NÃO existe nesta versão => off
  process.env.TYPESAFE_MODE = 'enforce'; process.env.TYPESAFE_API_KEY = 'chave-de-teste';
  jev.observe({ channel: 'whatsapp', text: 'quero cancelar' }); await wait(30);
  assert.strictEqual(calls, 0); ok("'enforce' é ignorado (só shadow existe)");

  // 4) shadow + chave: chama, mascara PII, grava com regex, não envia telefone/nome
  process.env.TYPESAFE_MODE = 'shadow';
  jev.observe({ channel: 'whatsapp', tenantId: 'torres', text: 'Meu CPF 123.456.789-09, cartão 4111 1111 1111 1111, mail a@b.com, tel +55 11 99999-8888: quero cancelar', regex: { cancel: true, human: false, escalation: null } });
  await wait(60);
  assert.strictEqual(calls, 1);
  const enviado = JSON.stringify(lastBody);
  assert.ok(!/123\.456|4111|a@b\.com|99999-8888/.test(enviado), 'PII não pode sair: ' + enviado);
  assert.ok(/\[doc\]/.test(enviado) && /\[cartao\]/.test(enviado) && /\[email\]/.test(enviado) && /\[tel\]/.test(enviado));
  assert.strictEqual(lastHeaders.Authorization, 'Bearer chave-de-teste');
  assert.strictEqual(lastBody.model, 'jev-1.14.0'); assert.deepStrictEqual(Object.keys(lastBody.state), ['mensagem']);
  assert.strictEqual(lastBody.questions.intencao.type, 'choice'); assert.ok(lastBody.questions.intencao.criteria.outro);
  assert.strictEqual(docs.length, 1); assert.strictEqual(docs[0].intencao, 'cancelamento'); assert.deepStrictEqual(docs[0].regex, { cancel: true, human: false, escalation: null });
  assert.ok(!/123\.456|4111|a@b\.com/.test(docs[0].texto)); assert.ok(docs[0].costUSD > 0 && docs[0].costUSD < 0.0001);
  assert.ok(logs.some((l) => l.startsWith('[jev-shadow] ')));
  ok('shadow: chama, mascara PII, grava com o regex atual e custo');

  // 5) dedup
  jev.observe({ channel: 'whatsapp', text: 'Meu CPF 123.456.789-09, cartão 4111 1111 1111 1111, mail a@b.com, tel +55 11 99999-8888: quero cancelar' }); await wait(30);
  assert.strictEqual(calls, 1); ok('dedup: mesma mensagem não gera 2ª chamada');

  // 6) observe é síncrono e rápido (não bloqueia), mesmo com Jev lento
  global.fetch = async (url, init) => new Promise((res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))));
  process.env.TYPESAFE_TIMEOUT_MS = '80';
  const t0 = Date.now(); jev.observe({ channel: 'smm', text: 'mensagem lenta um' }); const dt = Date.now() - t0;
  assert.ok(dt < 20, 'observe bloqueou ' + dt + 'ms'); await wait(200);
  assert.strictEqual(docs.length, 1); ok('Jev lento: observe não bloqueia e o timeout descarta');

  // 7) HTTP 500, JSON inválido e exceção de rede => silencioso
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  jev.observe({ channel: 'smm', text: 'mensagem erro dois' }); await wait(30);
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ answers: {} }) });
  jev.observe({ channel: 'smm', text: 'mensagem invalida tres' }); await wait(30);
  global.fetch = async () => { throw new Error('rede caiu'); };
  jev.observe({ channel: 'smm', text: 'mensagem rede quatro' }); await wait(30);
  assert.strictEqual(docs.length, 1); ok('500 / JSON inválido / rede caiu: nada quebra, nada é gravado');

  // 8) entradas inválidas nunca lançam
  for (const x of [undefined, null, {}, { text: '' }, { text: ' ' }, { text: 5 }]) jev.observe(x);
  ok('entradas inválidas não lançam');

  // 9) trava de custo por minuto
  jev._resetForTest(); process.env.TYPESAFE_MAX_PER_MIN = '3'; calls = 0;
  global.fetch = async () => { calls++; return resp(); };
  for (let i = 0; i < 10; i++) jev.observe({ channel: 'smm', text: 'msg distinta numero ' + i }); await wait(60);
  assert.strictEqual(calls, 3); ok('trava de custo: máx. 3/min respeitado');

  console.log = origLog;
  console.log(`\n${n} casos passaram, sem rede.`);
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
