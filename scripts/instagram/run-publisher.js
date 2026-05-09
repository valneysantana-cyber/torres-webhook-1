#!/usr/bin/env node
/**
 * Standalone runner — publica posts due da fila IG ConciergeCloud.
 *
 * Configurar como Render Cron Job:
 *   schedule: 0,15,30,45 12-22 * * *   (a cada 15min entre 9-19h BRT = 12-22h UTC)
 *   command:  node scripts/instagram/run-publisher.js
 *
 * NOTA: o formato expandido `0,15,30,45` é equivalente a `*<barra>15` em cron,
 * mas evita o bug clássico de JSDoc (asterisco-barra fecha bloco de comentário,
 * causando SyntaxError no Node). Render aceita os 2 formatos no field schedule.
 *
 * Pré-req envs (Render):
 *   MONGODB_URI
 *   IG_CC_BUSINESS_ID
 *   IG_CC_ACCESS_TOKEN
 *   IG_CC_AUTO_PUBLISH=true   (default OFF)
 *
 * Idempotente: marca status=publishing antes da chamada Meta, depois published/failed.
 * Cron seguinte só pega posts ready de novo (não republica).
 *
 * Exit code:
 *   0 = sucesso (mesmo que 0 posts publicados)
 *   1 = erro fatal (DB não conecta, etc)
 *   2 = config faltando (IG_CC envs ou auto_publish off)
 */

const mongoose = require('mongoose');
const ccPublisher = require('../../services/instagram/cc-publisher');

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('[ig-pub] ERRO: MONGODB_URI não definido');
    process.exit(1);
  }

  console.log(`[ig-pub] start ${new Date().toISOString()}`);

  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000
    });
    console.log('[ig-pub] mongo conectado');

    const result = await ccPublisher.publishDuePosts();
    console.log('[ig-pub] resultado:', JSON.stringify(result));

    await mongoose.disconnect();
    console.log('[ig-pub] mongo desconectado');

    if (result.skipped) {
      process.exit(2);
    }
    process.exit(0);
  } catch (err) {
    console.error('[ig-pub] FATAL:', err);
    try { await mongoose.disconnect(); } catch (_) {}
    process.exit(1);
  }
}

main();
