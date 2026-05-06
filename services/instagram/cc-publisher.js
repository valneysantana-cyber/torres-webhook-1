'use strict';
/**
 * services/instagram/cc-publisher.js
 *
 * Worker que pega posts em status 'ready' (rendered) cujo scheduledFor
 * já passou e publica via cc-api.publishFromQueueDoc().
 *
 * Chamado pelo scheduler em index.js a cada 15min entre 9-19h BRT.
 * Idempotente: status muda ready→publishing→published (ou failed),
 * cron seguinte só pega ready de novo.
 *
 * Também expõe syncMetrics() rodado diário às 23h pra atualizar insights.
 */

const InstagramQueue = require('../../models/InstagramQueue');
const queue = require('./cc-queue');
const api = require('./cc-api');

const MAX_RETRY = 3;

/** Publica todos os posts ready com scheduledFor <= now. */
async function publishDuePosts() {
  if (!api.isConfigured()) {
    console.log('[ig-pub] skip — IG_CC envs não configurados');
    return { published: 0, failed: 0, skipped: 'not_configured' };
  }
  if (!api.isAutoPublishEnabled()) {
    console.log('[ig-pub] skip — IG_CC_AUTO_PUBLISH=false');
    return { published: 0, failed: 0, skipped: 'auto_publish_off' };
  }

  const due = await InstagramQueue.findDueForPublish();
  if (!due.length) {
    console.log('[ig-pub] nenhum post due');
    return { published: 0, failed: 0 };
  }

  let published = 0;
  let failed = 0;

  for (const doc of due) {
    if ((doc.retryCount || 0) >= MAX_RETRY) {
      console.warn(`[ig-pub] skip ${doc._id} — atingiu MAX_RETRY=${MAX_RETRY}`);
      continue;
    }

    try {
      await queue.setStatus(doc._id, 'publishing');
      console.log(`[ig-pub] publishing ${doc._id} (${doc.format} · ${doc.template})`);

      const result = await api.publishFromQueueDoc(doc);

      await queue.setStatus(doc._id, 'published', {
        ig_media_id: result.ig_media_id,
        permalink: result.permalink
      });

      console.log(`[ig-pub] OK ${doc._id} → ${result.permalink || result.ig_media_id}`);
      published++;
    } catch (err) {
      console.error(`[ig-pub] FALHA ${doc._id}:`, err.message, err.code ? `[code ${err.code}]` : '');
      await queue.setStatus(doc._id, 'failed', { error: `${err.message}${err.code ? ` (code ${err.code})` : ''}` });
      failed++;
    }
  }

  console.log(`[ig-pub] resultado: ${published} ok · ${failed} falha · ${due.length} total`);
  return { published, failed };
}

/** Atualiza métricas dos posts publicados nos últimos N dias. */
async function syncMetrics(days = 7) {
  if (!api.isConfigured()) return { synced: 0, skipped: 'not_configured' };

  const recent = await InstagramQueue.findRecentPublished(days);
  let synced = 0;
  let failed = 0;

  for (const doc of recent) {
    if (!doc.published?.ig_media_id) continue;
    try {
      const metrics = await api.getInsights(doc.published.ig_media_id);
      await queue.updateMetrics(doc._id, metrics);
      synced++;
    } catch (err) {
      console.error(`[ig-metrics] FALHA ${doc._id}:`, err.message);
      failed++;
    }
  }

  console.log(`[ig-metrics] ${synced} synced · ${failed} falhas · ${recent.length} verificados`);
  return { synced, failed };
}

/** Roda 1× pra testar config sem publicar nada. */
async function dryRun() {
  if (!api.isConfigured()) return { ok: false, reason: 'IG_CC envs não configurados' };

  try {
    const quota = await api.checkPublishingQuota();
    const due = await InstagramQueue.findDueForPublish();
    return {
      ok: true,
      configured: true,
      auto_publish: api.isAutoPublishEnabled(),
      quota,
      due_count: due.length,
      next_due: due[0] ? { id: due[0]._id, scheduledFor: due[0].scheduledFor, template: due[0].template } : null
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  publishDuePosts,
  syncMetrics,
  dryRun
};
