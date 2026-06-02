'use strict';
/**
 * safeFetch.js — global fetch wrapper que força Accept-Encoding: identity.
 *
 * Bug raiz (02/06/2026): undici em Node 18/20 no Render NÃO descomprime
 * automaticamente gzip em alguns casos, mesmo com Content-Encoding: gzip
 * presente. Resultado: JSON.parse() recebe bytes binários e lança
 * "Unexpected token '\xff'".
 *
 * PR #126 fixou apenas `services/stays.js`. Mas o mesmo bug afeta:
 *   - downloadWhatsAppMedia (Meta Graph API binary download — áudio)
 *   - sendWhatsAppText/Template (Meta Graph API JSON)
 *   - CRM API calls (torres-crm-api)
 *   - Anthropic / OpenAI SDK (gzip auto)
 *
 * Em vez de patchar cada fetch individualmente, este módulo monkey-patcha
 * `global.fetch` adicionando 'Accept-Encoding: identity' em TODA request
 * que não já tenha o header. Trade-off: payloads maiores (sem compressão),
 * irrelevante pra volume típico do bot (~kbs por request).
 *
 * Carregar PRIMEIRO no boot — antes de qualquer require que faça fetch.
 */

const _originalFetch = global.fetch;

if (typeof _originalFetch !== 'function') {
  console.warn('[safeFetch] global.fetch indisponível — skip patch');
  module.exports = { patched: false };
  return;
}

global.fetch = function patchedFetch(input, init) {
  init = init || {};

  // Normalizar headers (Headers obj OU plain object)
  if (init.headers instanceof Headers) {
    if (!init.headers.has('accept-encoding')) {
      init.headers.set('accept-encoding', 'identity');
    }
  } else if (Array.isArray(init.headers)) {
    const hasAE = init.headers.some(([k]) => String(k).toLowerCase() === 'accept-encoding');
    if (!hasAE) init.headers.push(['accept-encoding', 'identity']);
  } else if (init.headers && typeof init.headers === 'object') {
    const hasAE = Object.keys(init.headers).some(k => k.toLowerCase() === 'accept-encoding');
    if (!hasAE) init.headers['Accept-Encoding'] = 'identity';
  } else {
    init.headers = { 'Accept-Encoding': 'identity' };
  }

  return _originalFetch.call(this, input, init);
};

console.log('[safeFetch] global.fetch patched — Accept-Encoding: identity default');
module.exports = { patched: true };
