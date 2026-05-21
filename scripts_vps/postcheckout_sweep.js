#!/usr/bin/env node
'use strict';
/**
 * postcheckout_sweep.js — Disparo automático de templates Meta pós-checkout.
 *
 * Roda 1x/hora via cron. Pra cada reserva ATIVA com checkout date+time já
 * passado dentro de uma janela específica e ainda não notificada, envia:
 *   - frigobar_pix_charge_v1 (UTILITY)  — 2h após check-out
 *   - post_checkout_review_v1 (MARKETING) — 6h após check-out
 *
 * Janelas e flags configuráveis em tenant.settings.postCheckout:
 *   - enabled (bool)
 *   - frigobarPixDelayHours (default 2)
 *   - reviewDelayHours (default 6)
 *
 * Pula:
 *   - tenant.settings.postCheckout.enabled !== true
 *   - reserva cancelada/no-show
 *   - já enviado (flags frigobarPixSentAt / postCheckoutReviewSentAt)
 *   - review: partner direct/website (sem OTA pra avaliar)
 *   - pix: tenant.settings.frigobar.enabled !== true
 *
 * Flags: DRY_RUN=1 não envia, só loga. PERIOD=YYYY-MM-DD limita.
 * Log em /var/log/postcheckout_sweep.log
 */

const { MongoClient } = require('/root/torres-crm-api/node_modules/mongodb');
const https = require('https');
const fs = require('fs');

const DRY_RUN = process.env.DRY_RUN === '1';

function loadEnv(p) {
  const t = fs.readFileSync(p, 'utf8');
  const e = {};
  t.split('\n').forEach(l => {
    const m = l.match(/^([A-Z_][A-Z0-9_]*)=["']?(.*?)["']?$/);
    if (m && m[1]) e[m[1]] = m[2];
  });
  return e;
}

const secrets = loadEnv('/root/.backup_secrets.env');
const crmEnv = loadEnv('/root/torres-crm-api/.env');

const TOKEN = secrets.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = secrets.WHATSAPP_PHONE_NUMBER_ID;
const REVIEW_TEMPLATE = process.env.WA_REVIEW_TEMPLATE_NAME || 'post_checkout_review_v1';
const PIX_TEMPLATE = process.env.WA_FRIGOBAR_PIX_TEMPLATE_NAME || 'frigobar_pix_charge_v1';

function now() { return new Date().toISOString(); }

// Normaliza partner do Stays → OTA name apresentável (mesmo padrão do
// normalizePartner no monthly-report endpoint).
function otaDisplayName(partner) {
  const raw = String(partner || '').toLowerCase().replace(/^api\s+/, '').trim();
  const map = {
    'booking.com': 'Booking.com',
    'booking': 'Booking.com',
    'airbnb': 'Airbnb',
    'expedia': 'Expedia',
    'vrbo': 'Vrbo',
    'despegar': 'Despegar',
    'decolar': 'Decolar',
  };
  return map[raw] || null;
}

// Partner indica reserva direct/website (sem OTA pra avaliar)
const DIRECT_PARTNER_RE = /^(direct|website|direto)$/i;

function isOtaPartner(partner) {
  const ota = otaDisplayName(partner);
  return !!ota && !DIRECT_PARTNER_RE.test(partner || '');
}

// Constrói datetime do check-out: checkOutDate (YYYY-MM-DD) + checkOutTime (HH:MM)
// Default 12:00 se time ausente. Timezone: assume America/Sao_Paulo (-03:00).
function buildCheckoutDateTime(checkOutDate, checkOutTime) {
  if (!checkOutDate) return null;
  const time = checkOutTime || '12:00';
  // Constrói ISO com offset -03:00 (BRT, sem horário de verão no BR atual)
  const iso = `${checkOutDate}T${time}:00-03:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

async function sendTemplate(templateName, phone, parameters) {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] would send ${templateName} to ${phone} with ${JSON.stringify(parameters)}`);
    return { dryRun: true };
  }
  return new Promise((resolve) => {
    const body = JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'pt_BR' },
        components: [{ type: 'body', parameters }],
      },
    });
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v19.0/${PHONE_NUMBER_ID}/messages`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let chunks = '';
      res.on('data', c => { chunks += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(chunks);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, messageId: j.messages?.[0]?.id });
          } else {
            resolve({ ok: false, status: res.statusCode, error: j });
          }
        } catch (e) {
          resolve({ ok: false, error: e.message, body: chunks.slice(0, 200) });
        }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.write(body);
    req.end();
  });
}

async function main() {
  const startTs = Date.now();
  console.log(`[${now()}] [postcheckout-sweep] start${DRY_RUN ? ' [DRY_RUN]' : ''}`);

  const atlas = new MongoClient(crmEnv.MONGODB_ATLAS_URI);
  const local = new MongoClient(crmEnv.MONGODB_URI);
  await Promise.all([atlas.connect(), local.connect()]);
  const atlasDb = atlas.db('torresguest');
  const localDb = local.db('torresguest');

  // Carregar tenants ativos
  const tenants = await localDb.collection('tenants').find({ active: true }).toArray();
  const tenantMap = new Map(tenants.map(t => [t.tenantId, t]));
  console.log(`[${now()}] [postcheckout-sweep] ${tenants.length} tenant(s) ativo(s)`);

  // Buscar reservas com checkout nas últimas 8h (janela suficiente pra cobrir
  // PIX 2h e review 6h sem atraso de cron miss). Filtro fino vem depois.
  // Janela: checkouts entre 36h atrás e hoje. Cobre PIX (2h+24h dispatch window)
  // e Review (6h+24h dispatch window) sem trazer reservas futuras.
  const todayStr  = new Date().toISOString().slice(0, 10);
  const sinceStr  = new Date(Date.now() - 36 * 3600_000).toISOString().slice(0, 10);
  const reservas = await atlasDb.collection('reservations').find({
    checkOutDate: { $gte: sinceStr, $lte: todayStr },
    type: { $not: /^cancel/i },
    guestPhoneClean: { $exists: true, $ne: null, $ne: '' },
  }).toArray();
  console.log(`[${now()}] [postcheckout-sweep] ${reservas.length} reservas candidatas (checkOut >= ${sinceStr})`);

  const stats = { pixSent: 0, reviewSent: 0, skippedAlreadySent: 0, skippedNoTenant: 0, skippedDisabled: 0, skippedDirect: 0, skippedNotYet: 0, skippedTooLate: 0, errors: 0 };

  for (const r of reservas) {
    const tenant = tenantMap.get(r.tenantId);
    if (!tenant) { stats.skippedNoTenant++; continue; }
    const pc = tenant.settings?.postCheckout;
    if (!pc || pc.enabled !== true) { stats.skippedDisabled++; continue; }

    const coDT = buildCheckoutDateTime(r.checkOutDate, r.checkOutTime);
    if (!coDT) { stats.errors++; console.warn(`[skip] ${r.confirmationCode} sem checkout válido`); continue; }
    const hoursSinceCheckout = (Date.now() - coDT.getTime()) / 3600_000;

    const firstName = String(r.guestName || '').split(/\s+/)[0] || 'Hóspede';
    const phone = String(r.guestPhoneClean || '').replace(/\D/g, '');
    if (!phone) { stats.errors++; continue; }

    // === FRIGOBAR PIX (2h após checkout) ===
    const pixDelay = pc.frigobarPixDelayHours ?? 2;
    const fb = tenant.settings?.frigobar;
    const frigobarOk = fb && fb.enabled === true && fb.pixKey && fb.pixHolder && fb.confirmationWhatsapp;
    if (frigobarOk && !r.frigobarPixSentAt) {
      if (hoursSinceCheckout >= pixDelay && hoursSinceCheckout < pixDelay + 24) {
        console.log(`[pix] sending ${r.confirmationCode} → ${phone} (${hoursSinceCheckout.toFixed(1)}h pós-checkout)`);
        const res = await sendTemplate(PIX_TEMPLATE, phone, [
          { type: 'text', text: firstName },
          { type: 'text', text: fb.pixKey },
          { type: 'text', text: fb.pixHolder },
          { type: 'text', text: fb.confirmationWhatsapp },
        ]);
        if (res.ok || res.dryRun) {
          stats.pixSent++;
          if (!DRY_RUN) {
            await atlasDb.collection('reservations').updateOne(
              { _id: r._id },
              { $set: { frigobarPixSentAt: new Date(), frigobarPixMessageId: res.messageId } }
            );
          }
        } else {
          stats.errors++;
          console.error(`[pix] ERROR ${r.confirmationCode}:`, JSON.stringify(res.error).slice(0, 200));
        }
      } else if (hoursSinceCheckout < pixDelay) {
        stats.skippedNotYet++;
      } else {
        stats.skippedTooLate++;
      }
    } else if (r.frigobarPixSentAt) {
      stats.skippedAlreadySent++;
    }

    // === REVIEW (6h após checkout) ===
    const reviewDelay = pc.reviewDelayHours ?? 6;
    if (!isOtaPartner(r.partner)) { stats.skippedDirect++; continue; }
    if (r.postCheckoutReviewSentAt) { stats.skippedAlreadySent++; continue; }
    if (hoursSinceCheckout < reviewDelay) { stats.skippedNotYet++; continue; }
    if (hoursSinceCheckout >= reviewDelay + 24) { stats.skippedTooLate++; continue; }

    console.log(`[review] sending ${r.confirmationCode} → ${phone} (${hoursSinceCheckout.toFixed(1)}h pós-checkout, OTA=${otaDisplayName(r.partner)})`);
    const res = await sendTemplate(REVIEW_TEMPLATE, phone, [
      { type: 'text', text: firstName },
      { type: 'text', text: otaDisplayName(r.partner) },
    ]);
    if (res.ok || res.dryRun) {
      stats.reviewSent++;
      if (!DRY_RUN) {
        await atlasDb.collection('reservations').updateOne(
          { _id: r._id },
          { $set: { postCheckoutReviewSentAt: new Date(), postCheckoutReviewMessageId: res.messageId } }
        );
      }
    } else {
      stats.errors++;
      console.error(`[review] ERROR ${r.confirmationCode}:`, JSON.stringify(res.error).slice(0, 200));
    }
  }

  console.log(`[${now()}] [postcheckout-sweep] done em ${((Date.now()-startTs)/1000).toFixed(1)}s`, JSON.stringify(stats));

  await atlas.close();
  await local.close();
}

main().catch(e => { console.error('[postcheckout-sweep] FATAL:', e.message, e.stack); process.exit(1); });
