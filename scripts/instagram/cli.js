#!/usr/bin/env node
/**
 * scripts/instagram/cli.js
 *
 * CLI pra gerenciar a fila de posts @conciergecloud.app sem precisar de UI web.
 * Usar localmente (com MONGODB_URI no env) ou via Render Shell.
 *
 * Comandos:
 *   list [--status pending|approved|...] [--limit 14]
 *   show <id>
 *   approve <id>
 *   approve-week                          (aprova todos os pending da semana corrente)
 *   approve-week --next                   (aprova pending da próxima semana)
 *   edit <id> --caption "..." --hashtags "#a #b"
 *   postpone <id> [days]                  (default 1)
 *   skip <id> [reason]
 *   set-ready <id> --image URL [--image URL...]   (marca rendered+ready manualmente)
 *   stats                                 (counts por status + métricas 30d)
 *   dry-run                               (testa quota Meta API + due_count)
 *
 * Exemplos:
 *   node scripts/instagram/cli.js list --status pending
 *   node scripts/instagram/cli.js approve-week
 *   node scripts/instagram/cli.js set-ready 65f1... --image https://cdn.cc/ig/2026-05-07/slide1.png --image https://cdn.cc/.../slide2.png
 */

const mongoose = require('mongoose');
const InstagramQueue = require('../../models/InstagramQueue');
const queue = require('../../services/instagram/cc-queue');
const ccPublisher = require('../../services/instagram/cc-publisher');

function parseArgs(argv) {
  const args = { _: [], flags: {}, multi: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      if (args.flags[key] !== undefined) {
        args.multi[key] = (args.multi[key] || [args.flags[key]]).concat(val);
      } else {
        args.flags[key] = val;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}

function fmtRow(doc) {
  const id = String(doc._id).slice(-6);
  const dt = fmtDate(doc.scheduledFor);
  const status = (doc.status || '').padEnd(10);
  const pillar = (doc.pillar || '').padEnd(10);
  const fmt = (doc.format || '').padEnd(15);
  const tpl = doc.template || '';
  return `${id}  ${dt}  ${status}  ${pillar}  ${fmt}  ${tpl}`;
}

async function cmdList(args) {
  const filter = {};
  if (args.flags.status) filter.status = args.flags.status;
  const limit = parseInt(args.flags.limit || '14', 10);
  const docs = await InstagramQueue.find(filter).sort({ scheduledFor: 1 }).limit(limit).lean();
  console.log(`\n${docs.length} posts encontrados:`);
  console.log('id      scheduledFor       status      pillar      format           template');
  console.log('─'.repeat(110));
  docs.forEach(d => console.log(fmtRow(d)));
}

async function cmdShow(args) {
  const id = args._[1];
  if (!id) { console.error('uso: show <id>'); process.exit(1); }
  const doc = await InstagramQueue.findById(id).lean();
  if (!doc) { console.error('not found'); process.exit(1); }
  console.log(JSON.stringify(doc, null, 2));
}

async function cmdApprove(args) {
  const id = args._[1];
  if (!id) { console.error('uso: approve <id>'); process.exit(1); }
  const doc = await queue.approve(id, 'cli');
  console.log(`approved: ${doc._id} (${doc.template})`);
}

async function cmdApproveWeek(args) {
  const useNext = args.flags.next;
  let weekStart, weekEnd;
  if (useNext) {
    weekStart = queue.nextMondayUtc(new Date());
    weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
  } else {
    weekEnd = queue.nextMondayUtc(new Date());
    weekStart = new Date(weekEnd.getTime() - 7 * 86400000);
  }
  console.log(`Aprovando pending entre ${fmtDate(weekStart)} e ${fmtDate(weekEnd)}...`);
  const count = await queue.approveBatch(weekStart, weekEnd, 'cli');
  console.log(`${count} posts aprovados.`);
}

async function cmdEdit(args) {
  const id = args._[1];
  if (!id) { console.error('uso: edit <id> [--caption ...] [--hashtags "#a #b"] [--scheduled-for ISO]'); process.exit(1); }
  const updates = {};
  if (args.flags.caption) updates.caption = args.flags.caption;
  if (args.flags.hashtags) updates.hashtags = args.flags.hashtags.split(/\s+/).filter(Boolean);
  if (args.flags['scheduled-for']) updates.scheduledFor = new Date(args.flags['scheduled-for']);
  const doc = await queue.edit(id, updates);
  console.log(`edited: ${doc._id}`);
}

async function cmdPostpone(args) {
  const id = args._[1];
  const days = parseInt(args._[2] || '1', 10);
  const doc = await queue.postpone(id, days);
  console.log(`postponed: ${doc._id} → ${fmtDate(doc.scheduledFor)}`);
}

async function cmdSkip(args) {
  const id = args._[1];
  const reason = args._.slice(2).join(' ') || 'manual cli skip';
  const doc = await queue.skip(id, reason);
  console.log(`skipped: ${doc._id} (${reason})`);
}

async function cmdSetReady(args) {
  const id = args._[1];
  const images = [].concat(args.multi.image || args.flags.image || []);
  if (!id || !images.length) { console.error('uso: set-ready <id> --image URL [--image URL...]'); process.exit(1); }
  const doc = await queue.setStatus(id, 'ready', { images });
  console.log(`ready: ${doc._id} com ${images.length} imagens`);
}

async function cmdStats() {
  const s = await queue.stats();
  console.log('\nFila:');
  Object.entries(s.byStatus).forEach(([k, v]) => console.log(`  ${k.padEnd(10)} ${v}`));
  console.log('\nÚltimos 30 dias publicados:');
  console.log(`  posts          ${s.last30days.published}`);
  console.log(`  impressions    ${s.last30days.impressions}`);
  console.log(`  likes          ${s.last30days.likes}`);
  console.log(`  saves          ${s.last30days.saves}`);
}

async function cmdDryRun() {
  const r = await ccPublisher.dryRun();
  console.log(JSON.stringify(r, null, 2));
}

const COMMANDS = {
  list: cmdList,
  show: cmdShow,
  approve: cmdApprove,
  'approve-week': cmdApproveWeek,
  edit: cmdEdit,
  postpone: cmdPostpone,
  skip: cmdSkip,
  'set-ready': cmdSetReady,
  stats: cmdStats,
  'dry-run': cmdDryRun
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (!cmd || !COMMANDS[cmd]) {
    console.log('Comandos: ' + Object.keys(COMMANDS).join(', '));
    console.log('Veja header de scripts/instagram/cli.js pra exemplos.');
    process.exit(cmd ? 1 : 0);
  }

  if (!process.env.MONGODB_URI) {
    console.error('ERRO: MONGODB_URI não definido');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await COMMANDS[cmd](args);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(err => {
  console.error('ERRO:', err.message);
  process.exit(1);
});
