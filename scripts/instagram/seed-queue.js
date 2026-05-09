#!/usr/bin/env node
/**
 * Seed da fila instagram_queue com cronograma_30dias.json
 *
 * Uso:
 *   node scripts/seed-queue.js                     # dry-run, mostra o que seria inserido
 *   node scripts/seed-queue.js --commit            # insere de verdade
 *   node scripts/seed-queue.js --commit --reset    # apaga fila atual e recria
 *
 * Pré-req: MONGODB_URI no env (já tem no Render)
 */

// Env: lê de process.env (Render injeta automaticamente).
// Para rodar localmente: node --env-file=.env scripts/instagram/seed-queue.js
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const InstagramQueue = require('../../models/InstagramQueue');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const RESET = args.includes('--reset');

const TZ_OFFSET_HOURS = -3;

function buildScheduledFor(dateStr, publishHour) {
  const [yyyy, mm, dd] = dateStr.split('-').map(Number);
  const utcMs = Date.UTC(yyyy, mm - 1, dd, publishHour - TZ_OFFSET_HOURS, 0, 0);
  return new Date(utcMs);
}

async function main() {
  const cronogramaPath = path.join(__dirname, '..', '..', 'data', 'instagram', 'cronograma_30dias.json');
  const cronograma = JSON.parse(fs.readFileSync(cronogramaPath, 'utf8'));

  console.log(`Cronograma: ${cronograma.version} · ${cronograma.posts.length} posts`);
  console.log(`Idioma: ${cronograma.language} · TZ: ${cronograma.timezone}`);
  console.log(`Modo: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}${RESET ? ' + RESET' : ''}\n`);

  if (!COMMIT) {
    cronograma.posts.forEach((p, i) => {
      const sched = buildScheduledFor(p.date, p.publish_hour);
      console.log(`${i + 1}. ${p.date} ${String(p.publish_hour).padStart(2, '0')}:00 [${p.pillar}/${p.format}] ${p.template}`);
      console.log(`   scheduledFor (UTC): ${sched.toISOString()}`);
      console.log(`   caption: "${p.caption.slice(0, 60)}..."`);
    });
    console.log(`\n${cronograma.posts.length} posts no dry-run. Rode com --commit pra inserir.`);
    return;
  }

  if (!process.env.MONGODB_URI) {
    console.error('ERRO: MONGODB_URI não definido no env.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado ao MongoDB.');

  if (RESET) {
    const before = await InstagramQueue.countDocuments({ status: { $in: ['pending', 'approved'] } });
    await InstagramQueue.deleteMany({ status: { $in: ['pending', 'approved'] } });
    console.log(`Reset: ${before} posts pending/approved deletados.`);
  }

  let inserted = 0;
  let skipped = 0;

  for (const p of cronograma.posts) {
    const scheduledFor = buildScheduledFor(p.date, p.publish_hour);

    const existing = await InstagramQueue.findOne({
      scheduledFor: { $gte: new Date(scheduledFor.getTime() - 60000), $lte: new Date(scheduledFor.getTime() + 60000) },
      template: p.template
    });

    if (existing) {
      console.log(`SKIP ${p.date} ${p.template} (já existe id ${existing._id})`);
      skipped++;
      continue;
    }

    const doc = new InstagramQueue({
      scheduledFor,
      status: 'pending',
      pillar: p.pillar,
      format: p.format,
      template: p.template,
      data: p.data,
      caption: p.caption,
      hashtags: p.hashtags || []
    });

    await doc.save();
    console.log(`OK   ${p.date} ${p.template} → ${doc._id}`);
    inserted++;
  }

  console.log(`\nResultado: ${inserted} inseridos · ${skipped} skipped (já existiam).`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('ERRO:', err);
  process.exit(1);
});
