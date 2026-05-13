'use strict';
/**
 * services/instagram/cc-api.js
 *
 * Cliente Meta IG Graph API para a conta @conciergecloud.app.
 * Separado de services/instagram.js (que serve @torresguest) pra isolar
 * tokens, rate limits, e estratégia de posting entre as duas contas.
 *
 * Env vars (Render):
 *   IG_CC_BUSINESS_ID         IG Business Account ID de @conciergecloud.app
 *   IG_CC_ACCESS_TOKEN        Long-Lived Page Access Token (60 dias)
 *   IG_CC_APP_ID              Reutiliza app OpenClaw existente (Fase 4)
 *   IG_CC_APP_SECRET          Idem
 *   FB_CC_PAGE_ID             ID da página Facebook ConciergeCloud (req. pra IG Business)
 *   IG_CC_AUTO_PUBLISH        'true' libera cron a postar; default OFF
 *
 * Endpoints Meta Graph API v23.0+:
 *   POST /{ig-user-id}/media               cria media container
 *   POST /{ig-user-id}/media_publish        publica container
 *   GET  /{ig-media-id}/insights            metricas
 *   GET  /refresh_access_token              renova long-lived token
 */

const API_VERSION = 'v23.0';
// Tokens com prefixo IGAA* (Instagram Business API with Instagram Login, 2024+)
// usam graph.instagram.com — NAO graph.facebook.com (que e pro fluxo antigo via FB Page).
const BASE = `https://graph.instagram.com/${API_VERSION}`;

const IG_BUSINESS_ID = process.env.IG_CC_BUSINESS_ID || '';
const ACCESS_TOKEN = process.env.IG_CC_ACCESS_TOKEN || '';
const AUTO_PUBLISH = process.env.IG_CC_AUTO_PUBLISH === 'true';

function assertConfigured() {
  if (!IG_BUSINESS_ID) throw new Error('IG_CC_BUSINESS_ID não configurado');
  if (!ACCESS_TOKEN) throw new Error('IG_CC_ACCESS_TOKEN não configurado');
}

async function call(method, path, body = null) {
  assertConfigured();
  const url = `${BASE}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const err = json.error || {};
    throw Object.assign(new Error(`Meta API ${method} ${path} ${res.status}: ${err.message || res.statusText}`), {
      code: err.code,
      type: err.type,
      subcode: err.error_subcode,
      fbtrace: err.fbtrace_id
    });
  }
  return json;
}

function withToken(params = {}) {
  return { ...params, access_token: ACCESS_TOKEN };
}

function qs(params) {
  return Object.entries(params)
    .filter(([_, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * Cria container de media (single image).
 * @param {string} imageUrl URL pública (R2/CDN).
 * @param {string} caption Legenda.
 * @returns {Promise<{id: string}>}
 */
async function createSingleContainer(imageUrl, caption) {
  const params = withToken({ image_url: imageUrl, caption });
  return call('POST', `/${IG_BUSINESS_ID}/media?${qs(params)}`);
}

/**
 * Cria child container de carrossel (precisa is_carousel_item=true).
 * Cada item retorna um child_id que entra no array children do container final.
 */
async function createCarouselChild(imageUrl) {
  const params = withToken({ image_url: imageUrl, is_carousel_item: true });
  return call('POST', `/${IG_BUSINESS_ID}/media?${qs(params)}`);
}

/**
 * Cria container final de carrossel com até 10 children.
 */
async function createCarouselContainer(childIds, caption) {
  if (childIds.length < 2 || childIds.length > 10) {
    throw new Error(`Carrossel precisa entre 2 e 10 itens, recebido ${childIds.length}`);
  }
  const params = withToken({
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption
  });
  return call('POST', `/${IG_BUSINESS_ID}/media?${qs(params)}`);
}

/**
 * Cria container de reel (vídeo MP4).
 * Reels são assíncronos — Meta processa o vídeo, status_code passa de IN_PROGRESS → FINISHED.
 * Tem que poll antes de publicar.
 */
async function createReelContainer(videoUrl, caption, coverUrl = null) {
  const params = withToken({
    media_type: 'REELS',
    video_url: videoUrl,
    caption,
    ...(coverUrl ? { cover_url: coverUrl } : {})
  });
  return call('POST', `/${IG_BUSINESS_ID}/media?${qs(params)}`);
}

/**
 * Cria container de story (single image).
 */
async function createStoryContainer(imageUrl) {
  const params = withToken({ media_type: 'STORIES', image_url: imageUrl });
  return call('POST', `/${IG_BUSINESS_ID}/media?${qs(params)}`);
}

/**
 * Verifica status de um container (pra reels — ver se já processou).
 */
async function getContainerStatus(containerId) {
  const params = withToken({ fields: 'status_code,status' });
  return call('GET', `/${containerId}?${qs(params)}`);
}

/**
 * Aguarda container ficar pronto (status_code === 'FINISHED').
 * Aplica polling com timeout para reels.
 */
async function waitForContainer(containerId, timeoutMs = 5 * 60 * 1000, intervalMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await getContainerStatus(containerId);
    if (s.status_code === 'FINISHED') return s;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') {
      throw new Error(`Container ${containerId} falhou com status_code=${s.status_code} status=${s.status}`);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Container ${containerId} timeout após ${timeoutMs}ms`);
}

/**
 * Publica container — passo final.
 * @returns {Promise<{id: string}>} ig_media_id
 */
async function publish(containerId) {
  if (!AUTO_PUBLISH) {
    throw new Error('IG_CC_AUTO_PUBLISH=false — publish bloqueado por env');
  }
  const params = withToken({ creation_id: containerId });
  return call('POST', `/${IG_BUSINESS_ID}/media_publish?${qs(params)}`);
}

/**
 * Pega permalink (URL pública) de um media id.
 */
async function getPermalink(mediaId) {
  const params = withToken({ fields: 'permalink' });
  return call('GET', `/${mediaId}?${qs(params)}`);
}

/**
 * Insights de um post (likes, reach, impressions...).
 * Métricas disponíveis variam por tipo de mídia.
 */
async function getInsights(mediaId) {
  const metricsList = ['impressions', 'reach', 'likes', 'comments', 'saved', 'shares'];
  const params = withToken({ metric: metricsList.join(',') });
  const json = await call('GET', `/${mediaId}/insights?${qs(params)}`);
  const out = {};
  for (const item of json.data || []) {
    const v = item.values?.[0]?.value;
    out[item.name === 'saved' ? 'saves' : item.name] = typeof v === 'number' ? v : 0;
  }
  return out;
}

/**
 * Verifica quota diária (Meta limita 25 posts/dia/IG Business).
 */
async function checkPublishingQuota() {
  const params = withToken({ fields: 'config,quota_usage' });
  return call('GET', `/${IG_BUSINESS_ID}/content_publishing_limit?${qs(params)}`);
}

/**
 * Renova long-lived token (chamar aos ~50 dias para evitar expiração em 60d).
 * Long-lived tokens são renováveis sem reautorização do usuário.
 */
async function refreshToken() {
  if (!ACCESS_TOKEN) throw new Error('IG_CC_ACCESS_TOKEN não configurado pra refresh');
  const params = qs({
    grant_type: 'ig_refresh_token',
    access_token: ACCESS_TOKEN
  });
  const url = `https://graph.instagram.com/refresh_access_token?${params}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) throw new Error(`Refresh failed: ${json.error?.message || res.statusText}`);
  return json;
}

/**
 * High-level: publica um post da fila (single, carrossel, reel, story).
 * Não chamar publish() se IG_CC_AUTO_PUBLISH=false.
 */
/**
 * Monta caption final concatenando hashtags do doc.
 * IG limita 2200 chars / 30 hashtags. Damos margem (não validamos hard).
 * Hashtags vão em bloco separado por linha em branco — prática comum.
 */
function buildFinalCaption(caption, hashtags) {
  const baseCaption = String(caption || '').trim();
  const tags = Array.isArray(hashtags) ? hashtags.filter(Boolean) : [];
  if (!tags.length) return baseCaption;
  const tagsLine = tags.map(t => (String(t).startsWith('#') ? t : `#${t}`)).join(' ');
  return baseCaption ? `${baseCaption}\n\n${tagsLine}` : tagsLine;
}

async function publishFromQueueDoc(doc) {
  const { format, rendered } = doc;
  const caption = buildFinalCaption(doc.caption, doc.hashtags);
  if (!rendered || (!rendered.images?.length && !rendered.video_url)) {
    throw new Error(`Doc ${doc._id} não tem rendered.images nem rendered.video_url`);
  }

  let containerId;

  if (format === 'feed_single' || format === 'story') {
    const c = format === 'story'
      ? await createStoryContainer(rendered.images[0])
      : await createSingleContainer(rendered.images[0], caption);
    containerId = c.id;
  } else if (format === 'feed_carousel') {
    const children = await Promise.all(
      rendered.images.map(url => createCarouselChild(url))
    );
    const c = await createCarouselContainer(children.map(x => x.id), caption);
    containerId = c.id;
  } else if (format === 'reel') {
    const c = await createReelContainer(rendered.video_url, caption, rendered.images?.[0]);
    await waitForContainer(c.id);
    containerId = c.id;
  } else {
    throw new Error(`Format desconhecido: ${format}`);
  }

  // Fix 13/05/2026: aguardar container ficar FINISHED pra TODOS os formatos.
  // Antes só reel chamava waitForContainer. Feed_single/carousel/story podem
  // pegar erro 9007 ("Media ID is not available") se o publish disparar antes
  // do Meta finalizar o processamento da imagem.
  if (format !== 'reel') {
    await waitForContainer(containerId, 60 * 1000, 2000); // 60s timeout, polls 2s
  }

  const published = await publish(containerId);
  const perma = await getPermalink(published.id).catch(() => ({}));

  return {
    ig_media_id: published.id,
    permalink: perma.permalink || null,
    container_id: containerId
  };
}

module.exports = {
  buildFinalCaption,
  createSingleContainer,
  createCarouselChild,
  createCarouselContainer,
  createReelContainer,
  createStoryContainer,
  getContainerStatus,
  waitForContainer,
  publish,
  getPermalink,
  getInsights,
  checkPublishingQuota,
  refreshToken,
  publishFromQueueDoc,
  isAutoPublishEnabled: () => AUTO_PUBLISH,
  isConfigured: () => Boolean(IG_BUSINESS_ID && ACCESS_TOKEN)
};
