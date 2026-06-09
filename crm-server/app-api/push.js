'use strict';

/**
 * app-api/push.js — Notificações push (FCM, entrega Android + iOS/APNs).
 *
 * Degrada com segurança: sem credenciais Firebase, vira no-op (apenas loga).
 *
 * Env para ativar:
 *   FIREBASE_SERVICE_ACCOUNT  — JSON da service account (string) OU
 *   GOOGLE_APPLICATION_CREDENTIALS — caminho do arquivo JSON
 */

let _app = null, _initTried = false;

function init() {
  if (_initTried) return _app;
  _initTried = true;
  try {
    const admin = require('firebase-admin');
    let credential;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      credential = admin.credential.applicationDefault();
    } else {
      return null; // não configurado
    }
    _app = admin.apps.length ? admin.app() : admin.initializeApp({ credential });
    return _app;
  } catch (e) {
    console.error('[push] init falhou (push desativado):', e.message);
    return null;
  }
}

function isConfigured() { return !!init(); }

// ─── tokens ─────────────────────────────────────────────────────────────
async function tokensForUserIds(db, userIds) {
  if (!userIds.length) return [];
  const docs = await db.collection('app_devices').find({ userId: { $in: userIds.map(String) } }).toArray();
  return [...new Set(docs.map(d => d.pushToken).filter(Boolean))];
}
async function userIdsForTenantRoles(db, tenantId, roles) {
  const users = await db.collection('app_users')
    .find({ tenantId, role: { $in: roles }, active: true }, { projection: { _id: 1 } }).toArray();
  return users.map(u => String(u._id));
}
async function ownerIdsForListing(db, tenantId, listingId) {
  const users = await db.collection('app_users')
    .find({ tenantId, role: 'owner', active: true, listings: String(listingId) }, { projection: { _id: 1 } }).toArray();
  return users.map(u => String(u._id));
}

// ─── envio ──────────────────────────────────────────────────────────────
async function sendToTokens(tokens, { title, body, data }) {
  const app = init();
  if (!app) { console.log(`[push] (no-op) ${title} → ${tokens.length} device(s)`); return { sent: 0, skipped: tokens.length }; }
  if (!tokens.length) return { sent: 0 };
  try {
    const admin = require('firebase-admin');
    const resp = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)])),
    });
    return { sent: resp.successCount, failed: resp.failureCount };
  } catch (e) { console.error('[push] envio falhou:', e.message); return { sent: 0, error: e.message }; }
}

// ─── gatilhos de negócio (fire-and-forget) ───────────────────────────────
async function notifyInspectionSubmitted(db, insp) {
  try {
    const ids = await userIdsForTenantRoles(db, insp.tenantId, ['host', 'admin']);
    const tokens = await tokensForUserIds(db, ids);
    await sendToTokens(tokens, {
      title: 'Vistoria recebida',
      body: `${insp.providerName || 'Equipe'} enviou a vistoria de ${insp.listingName || insp.listingId}.`,
      data: { type: 'inspection_submitted', inspectionId: String(insp._id || ''), listingId: String(insp.listingId) },
    });
  } catch (e) { console.error('[push] notifyInspectionSubmitted:', e.message); }
}
async function notifyReportReady(db, insp, report) {
  try {
    const hostIds = await userIdsForTenantRoles(db, insp.tenantId, ['host', 'admin']);
    const ownerIds = await ownerIdsForListing(db, insp.tenantId, insp.listingId);
    const tokens = await tokensForUserIds(db, [...new Set([...hostIds, ...ownerIds])]);
    const issues = (report && report.issues && report.issues.length) || 0;
    await sendToTokens(tokens, {
      title: 'Relatório de vistoria pronto',
      body: `${insp.listingName || insp.listingId}: ${report && report.summary ? report.summary.slice(0, 80) : 'análise concluída'}${issues ? ` (${issues} pendência(s))` : ''}`,
      data: { type: 'report_ready', inspectionId: String(insp._id || ''), listingId: String(insp.listingId) },
    });
  } catch (e) { console.error('[push] notifyReportReady:', e.message); }
}
async function notifyAssigned(db, insp) {
  try {
    const tokens = await tokensForUserIds(db, [String(insp.providerId)]);
    await sendToTokens(tokens, {
      title: 'Nova vistoria atribuída',
      body: `Vistoria de ${insp.listingName || insp.listingId} para ${insp.date}.`,
      data: { type: 'inspection_assigned', inspectionId: String(insp._id || ''), listingId: String(insp.listingId) },
    });
  } catch (e) { console.error('[push] notifyAssigned:', e.message); }
}

module.exports = { isConfigured, sendToTokens, notifyInspectionSubmitted, notifyReportReady, notifyAssigned };
