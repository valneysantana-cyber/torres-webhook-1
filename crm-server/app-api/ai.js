'use strict';

/**
 * app-api/ai.js — Geração do relatório de vistoria por IA (Claude vision).
 *
 * Recebe uma vistoria (com itens e fotos em base64 ou data URL) e devolve:
 *   - por item: status sugerido (ok | attention | problem) + nota curta
 *   - resumo consolidado do dia + lista de pendências priorizadas
 *
 * Usa o mesmo provedor já adotado no atendimento (Anthropic / Claude).
 * Degrada com segurança: sem ANTHROPIC_API_KEY, retorna relatório vazio
 * sinalizando que a IA não rodou (não quebra o fluxo da vistoria).
 */

const MODEL = process.env.APP_AI_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';

let _client = null;
function getClient() {
  if (!API_KEY) return null;
  if (_client) return _client;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    _client = new Anthropic({ apiKey: API_KEY });
    return _client;
  } catch (e) {
    console.error('[app-api/ai] SDK Anthropic indisponível:', e.message);
    return null;
  }
}

/** Converte data URL ("data:image/jpeg;base64,...") ou base64 cru em bloco de imagem da API. */
function toImageBlock(photo) {
  if (!photo) return null;
  let data = photo, mediaType = 'image/jpeg';
  const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(photo);
  if (m) { mediaType = m[1]; data = m[2]; }
  if (typeof data !== 'string' || data.length < 50) return null;
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
}

const SYSTEM = [
  'Você é um inspetor de qualidade de apartamentos de aluguel por temporada.',
  'Analisa fotos de vistoria de uma unidade e avalia cada item do checklist.',
  'Seja objetivo, prático e em português do Brasil. Foque no que impacta o próximo hóspede.',
  'Para cada item classifique o status: "ok" (sem ação), "attention" (observar/repor) ou "problem" (precisa resolver antes do check-in).',
  'Responda SOMENTE com JSON válido, sem texto fora do JSON.',
].join(' ');

/**
 * @param {object} inspection  doc da vistoria (com items[].photos em base64/data URL)
 * @returns {Promise<{summary, issues, items, generatedAt, model, ran}>}
 */
async function generateReport(inspection) {
  const items = Array.isArray(inspection.items) ? inspection.items : [];
  const client = getClient();
  if (!client) {
    return { ran: false, reason: 'ANTHROPIC_API_KEY ausente', summary: '', issues: [], items: [], generatedAt: new Date() };
  }

  // monta o conteúdo multimodal: para cada item, rótulo + suas fotos
  const content = [];
  content.push({ type: 'text', text:
    `Unidade: ${inspection.listingName || inspection.room || inspection.listingId || 'N/D'}\n` +
    `Data: ${inspection.date}\n` +
    `Itens do checklist a avaliar (na ordem):` });
  items.forEach((it, idx) => {
    content.push({ type: 'text', text: `\n[${idx}] ${it.category} › ${it.label}${it.note ? ` (obs. do funcionário: ${it.note})` : ''}` });
    const photos = Array.isArray(it.photos) ? it.photos : [];
    for (const p of photos) {
      const block = toImageBlock(p.data || p.url || p);
      if (block) content.push(block);
    }
  });
  content.push({ type: 'text', text:
    '\n\nRetorne JSON no formato exato:\n' +
    '{ "items": [ { "index": <int>, "status": "ok|attention|problem", "note": "<curta>" } ], ' +
    '"summary": "<resumo do estado geral em 1-2 frases>", ' +
    '"issues": [ "<pendência priorizada>", "..." ] }' });

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });
    const text = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    const json = extractJson(text);
    return {
      ran: true,
      model: MODEL,
      summary: json.summary || '',
      issues: Array.isArray(json.issues) ? json.issues : [],
      items: Array.isArray(json.items) ? json.items : [],
      generatedAt: new Date(),
    };
  } catch (err) {
    console.error('[app-api/ai] erro Claude:', err.message);
    return { ran: false, reason: err.message, summary: '', issues: [], items: [], generatedAt: new Date() };
  }
}

function extractJson(text) {
  if (!text) return {};
  // tenta bloco ```json ... ``` ou o primeiro {...}
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) return {};
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return {}; }
}

module.exports = { generateReport, toImageBlock, extractJson };
