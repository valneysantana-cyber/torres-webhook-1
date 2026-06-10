'use strict';

/**
 * app-api/storage.js — Armazenamento de fotos de vistoria no Cloudflare R2 (S3-compatible).
 *
 * Degrada com segurança: se o R2 não estiver configurado, as fotos seguem
 * inline em base64 dentro do documento (comportamento do Sprint 0, bom p/ piloto).
 *
 * Env (todas necessárias para ativar o R2):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 *   R2_PUBLIC_BASE (opcional) — base pública/CDN; se ausente, usa URL assinada
 */

const crypto = require('crypto');

const CFG = {
  accountId: process.env.R2_ACCOUNT_ID || '',
  accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  bucket: process.env.R2_BUCKET || '',
  publicBase: process.env.R2_PUBLIC_BASE || '',
  signTtl: parseInt(process.env.R2_SIGN_TTL || '3600', 10),
};

function isConfigured() {
  return !!(CFG.accountId && CFG.accessKeyId && CFG.secretAccessKey && CFG.bucket);
}

let _s3 = null, _presign = null;
function client() {
  if (_s3) return _s3;
  const { S3Client } = require('@aws-sdk/client-s3');
  _s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${CFG.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: CFG.accessKeyId, secretAccessKey: CFG.secretAccessKey },
  });
  return _s3;
}

function parseDataUrl(dataUrl) {
  const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  return { mediaType: m[1], buffer: Buffer.from(m[2], 'base64'), ext: (m[1].split('/')[1] || 'jpg').replace('jpeg', 'jpg') };
}

/** Sobe uma foto (data URL) e devolve { key, mediaType } ou null se inválida. */
async function putPhoto(dataUrl, prefix) {
  const p = parseDataUrl(dataUrl);
  if (!p) return null;
  const key = `${prefix}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${p.ext}`;
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  await client().send(new PutObjectCommand({ Bucket: CFG.bucket, Key: key, Body: p.buffer, ContentType: p.mediaType }));
  return { key, mediaType: p.mediaType };
}

/** URL para exibir a foto: pública (se R2_PUBLIC_BASE) ou assinada temporária. */
async function urlFor(key) {
  if (CFG.publicBase) return `${CFG.publicBase.replace(/\/$/, '')}/${key}`;
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  if (!_presign) _presign = require('@aws-sdk/s3-request-presigner').getSignedUrl;
  return _presign(client(), new GetObjectCommand({ Bucket: CFG.bucket, Key: key }), { expiresIn: CFG.signTtl });
}

/** Baixa o objeto e devolve data URL base64 (usado para alimentar a IA de visão). */
async function getDataUrl(key) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const out = await client().send(new GetObjectCommand({ Bucket: CFG.bucket, Key: key }));
  const chunks = []; for await (const c of out.Body) chunks.push(c);
  const buf = Buffer.concat(chunks);
  const mediaType = out.ContentType || 'image/jpeg';
  return `data:${mediaType};base64,${buf.toString('base64')}`;
}

/**
 * Processa as fotos dos itens na CRIAÇÃO da vistoria.
 * - R2 configurado: sobe cada base64 → guarda { key } (sem base64 pesado no Mongo).
 * - R2 ausente: mantém { data } base64 inline (fallback).
 */
async function processItemsPhotos(items, prefix) {
  const out = [];
  for (let i = 0; i < (items || []).length; i++) {
    const it = { ...items[i] };
    const photos = Array.isArray(it.photos) ? it.photos : [];
    if (!isConfigured()) { out.push(it); continue; }
    const stored = [];
    for (const ph of photos) {
      const dataUrl = ph && (ph.data || ph.url || ph);
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
        try { const r = await putPhoto(dataUrl, `${prefix}/item${i}`); if (r) stored.push({ key: r.key, mediaType: r.mediaType }); }
        catch (e) { console.error('[storage] upload falhou:', e.message); stored.push(ph); }
      } else if (ph && ph.key) { stored.push({ key: ph.key, mediaType: ph.mediaType }); }
    }
    it.photos = stored;
    out.push(it);
  }
  return out;
}

/** Para exibição: troca { key } por { url } assinada/pública; mantém { data } como está. */
async function hydratePhotosForView(items) {
  const out = [];
  for (const it of (items || [])) {
    const photos = [];
    for (const ph of (it.photos || [])) {
      if (ph && ph.key) { try { photos.push({ url: await urlFor(ph.key), key: ph.key }); } catch { photos.push({ key: ph.key }); } }
      else if (ph && ph.data) photos.push({ data: ph.data });
    }
    out.push({ ...it, photos });
  }
  return out;
}

/** Para a IA: devolve items com fotos como data URL base64 (baixa do R2 se necessário). */
async function hydratePhotosForAI(items) {
  const out = [];
  for (const it of (items || [])) {
    const photos = [];
    for (const ph of (it.photos || [])) {
      if (ph && ph.data) photos.push({ data: ph.data });
      else if (ph && ph.key && isConfigured()) { try { photos.push({ data: await getDataUrl(ph.key) }); } catch {} }
    }
    out.push({ ...it, photos });
  }
  return out;
}

module.exports = { isConfigured, putPhoto, urlFor, getDataUrl, processItemsPhotos, hydratePhotosForView, hydratePhotosForAI };
