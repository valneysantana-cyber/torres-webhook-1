'use strict';
/**
 * services/instagram/cc-queue.js
 *
 * CRUD da fila de posts @conciergecloud.app.
 * Wrapper em cima do model InstagramQueue com helpers de query usados
 * por cc-publisher, render, admin UI e email-digest.
 */

const InstagramQueue = require('../../models/InstagramQueue');

/** Lista próximos N posts em qualquer status (para admin UI). */
async function listUpcoming(limit = 14) {
  const now = new Date();
  return InstagramQueue.find({
    scheduledFor: { $gte: now }
  }).sort({ scheduledFor: 1 }).limit(limit).lean();
}

/** Lista posts da semana (segunda 00h → próxima segunda 00h). */
async function listWeek(weekStart, weekEnd) {
  return InstagramQueue.find({
    scheduledFor: { $gte: weekStart, $lt: weekEnd }
  }).sort({ scheduledFor: 1 }).lean();
}

/** Próxima segunda 00h America/Sao_Paulo (UTC-3 fixo, sem DST no BR desde 2019). */
function nextMondayUtc(refDate = new Date()) {
  const d = new Date(refDate);
  const dow = d.getUTCDay();
  const daysUntilMon = (8 - dow) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysUntilMon);
  d.setUTCHours(3, 0, 0, 0);
  return d;
}

/** Aprova um post — muda status pending→approved. */
async function approve(id, approvedBy = 'manual') {
  const doc = await InstagramQueue.findById(id);
  if (!doc) throw new Error(`Post ${id} not found`);
  if (doc.status !== 'pending') throw new Error(`Post ${id} status=${doc.status}, can only approve pending`);

  doc.status = 'approved';
  doc.approval = { approved_by: approvedBy, approved_at: new Date() };
  await doc.save();
  return doc;
}

/** Aprova batch (todos os posts dentro de um range, em status pending). */
async function approveBatch(weekStart, weekEnd, approvedBy = 'manual') {
  const result = await InstagramQueue.updateMany(
    {
      status: 'pending',
      scheduledFor: { $gte: weekStart, $lt: weekEnd }
    },
    {
      $set: {
        status: 'approved',
        'approval.approved_by': approvedBy,
        'approval.approved_at': new Date()
      }
    }
  );
  return result.modifiedCount;
}

/** Edita caption ou data de um post (e marca approval.edited_at). */
async function edit(id, updates) {
  const allowed = ['caption', 'hashtags', 'scheduledFor', 'data'];
  const $set = { 'approval.edited_at': new Date() };
  for (const k of allowed) {
    if (updates[k] !== undefined) $set[k] = updates[k];
  }
  return InstagramQueue.findByIdAndUpdate(id, { $set }, { new: true });
}

/** Adia post N dias (+ N * 24h no scheduledFor). */
async function postpone(id, days = 1) {
  const doc = await InstagramQueue.findById(id);
  if (!doc) throw new Error(`Post ${id} not found`);
  doc.scheduledFor = new Date(doc.scheduledFor.getTime() + days * 86400000);
  doc.approval = doc.approval || {};
  doc.approval.edited_at = new Date();
  await doc.save();
  return doc;
}

/** Marca post como skipped (não publicar). */
async function skip(id, reason) {
  return InstagramQueue.findByIdAndUpdate(id, {
    $set: { status: 'skipped', 'approval.notes': reason || 'manual skip' }
  }, { new: true });
}

/** Marca como rendering / ready / publishing / published / failed. Usado pelos workers. */
async function setStatus(id, status, extra = {}) {
  const $set = { status };
  if (status === 'ready' && extra.images) {
    $set.rendered = {
      images: extra.images,
      video_url: extra.video_url,
      rendered_at: new Date(),
      render_duration_ms: extra.duration_ms
    };
  }
  if (status === 'published' && extra.ig_media_id) {
    $set.published = {
      ig_media_id: extra.ig_media_id,
      permalink: extra.permalink,
      published_at: new Date()
    };
  }
  if (status === 'failed' && extra.error) {
    $set.lastError = String(extra.error).slice(0, 2000);
    $set.$inc = { retryCount: 1 };
  }
  return InstagramQueue.findByIdAndUpdate(id, { $set }, { new: true });
}

/** Atualiza métricas (likes, reach, etc) — chamado pelo cron diário. */
async function updateMetrics(id, metrics) {
  return InstagramQueue.findByIdAndUpdate(id, {
    $set: {
      'metrics.impressions': metrics.impressions ?? 0,
      'metrics.reach': metrics.reach ?? 0,
      'metrics.likes': metrics.likes ?? 0,
      'metrics.comments': metrics.comments ?? 0,
      'metrics.saves': metrics.saves ?? 0,
      'metrics.shares': metrics.shares ?? 0,
      'metrics.last_synced': new Date()
    }
  }, { new: true });
}

/** Estatísticas globais (usado em /admin/instagram-stats). */
async function stats() {
  const counts = await InstagramQueue.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);
  const byStatus = Object.fromEntries(counts.map(c => [c._id, c.count]));

  const recent = await InstagramQueue.findRecentPublished(30);
  const totals = recent.reduce((acc, p) => {
    acc.impressions += p.metrics?.impressions || 0;
    acc.likes += p.metrics?.likes || 0;
    acc.saves += p.metrics?.saves || 0;
    return acc;
  }, { impressions: 0, likes: 0, saves: 0 });

  return {
    byStatus,
    last30days: {
      published: recent.length,
      ...totals
    }
  };
}

module.exports = {
  listUpcoming,
  listWeek,
  nextMondayUtc,
  approve,
  approveBatch,
  edit,
  postpone,
  skip,
  setStatus,
  updateMetrics,
  stats
};
