#!/usr/bin/env node
/**
 * Standalone runner — sincroniza métricas (likes/reach/impressions) dos
 * posts publicados nos últimos 7 dias.
 *
 * Configurar como Render Cron Job:
 *   schedule: 0 2 * * *     (02h UTC = 23h BRT diário)
 *   command:  node scripts/instagram/run-metrics.js
 *
 * Lê IG Graph API insights pra cada post recente e atualiza
 * metrics.{impressions, reach, likes, comments, saves, shares} no doc.
 *
 * Exit code:
 *   0 = sucesso
 *   1 = erro fatal
 *   2 = não configurado
 */

const mongoose = require('mongoose');
const ccPublisher = require('../../services/instagram/cc-publisher');

const DAYS = parseInt(process.env.IG_METRICS_LOOKBACK_DAYS || '7', 10);

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('[ig-metrics] ERRO: MONGODB_URI não definido');
    process.exit(1);
  }

  console.log(`[ig-metrics] start ${new Date().toISOString()} · lookback ${DAYS}d`);

  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    console.log('[ig-metrics] mongo conectado');

    const result = await ccPublisher.syncMetrics(DAYS);
    console.log('[ig-metrics] resultado:', JSON.stringify(result));

    await mongoose.disconnect();
    if (result.skipped) process.exit(2);
    process.exit(0);
  } catch (err) {
    console.error('[ig-metrics] FATAL:', err);
    try { await mongoose.disconnect(); } catch (_) {}
    process.exit(1);
  }
}

main();
