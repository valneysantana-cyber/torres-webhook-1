'use strict';
/**
 * crm-server/index.js — TorresGuest CRM API
 * Express + MongoDB · Porta 3001 · VPS Hostgator
 *
 * Rotas públicas (sem auth):
 *   GET  /              → Dashboard HTML
 *   GET  /search.html   → Painel de pesquisa de hóspedes
 *   GET  /health
 *
 * Rotas protegidas (x-api-key):
 *   POST   /guest/:phone/message
 *   GET    /guest/:phone/context
 *   GET    /guest/:phone/profile
 *   PUT    /guest/:phone/profile
 *   POST   /guest/:phone/checkout
 *   POST   /guests/import          ← importação em lote (Excel)
 *   GET    /guests/search?q=nome   ← busca por nome
 */
require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const { dailyCampaignRun } = require('./campaigns');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3001;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/torresguest';
const API_KEY = process.env.CRM_API_KEY || '';
let db;

// ─── 1. STATIC (sem auth) ──────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'), err => {
    if (err) res.json({ ok: true, service: 'TorresGuest CRM' });
  })
);

// ─── 2. AUTH MIDDLEWARE ───────────────────────────────────────────────────
app.use((req, res, next) => {
  if (API_KEY && req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// ─── Helpers ──────────────────────────────────────────────────────────────
function calcLevel(n = 0) {
  if (n >= 20) return 'Embaixador';
  if (n >= 10) return 'VIP';
  if (n >= 4)  return 'Frequente';
  return 'Visitante';
}

// ─── 3. ROTAS ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date() }));

// POST /guest/:phone/message
app.post('/guest/:phone/message', async (req, res) => {
  try {
    const { phone } = req.params;
    const { role, content } = req.body;
    if (!role || !content) return res.status(400).json({ error: 'role e content obrigatórios' });
    await db.collection('messages').insertOne({ phone, role, content, ts: new Date() });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /guest/:phone/context
app.get('/guest/:phone/context', async (req, res) => {
  try {
    const { phone } = req.params;
    const limit = Math.min(Number(req.query.limit) || 10, 30);
    const msgs = await db.collection('messages')
      .find({ phone }).sort({ ts: -1 }).limit(limit).toArray();
    res.json(msgs.reverse());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /guest/:phone/profile
app.get('/guest/:phone/profile', async (req, res) => {
  try {
    const { phone } = req.params;
    const profile = await db.collection('guests').findOne({ phone }, { projection: { _id: 0 } });
    if (!profile) return res.json({ phone, level: 'Visitante', totalNights: 0, totalStays: 0 });
    res.json(profile);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /guest/:phone/profile
app.put('/guest/:phone/profile', async (req, res) => {
  try {
    const { phone } = req.params;
    const data = req.body || {};
    delete data._id;
    await db.collection('guests').updateOne(
      { phone },
      { $set: { ...data, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
    const profile = await db.collection('guests').findOne({ phone }, { projection: { _id: 0 } });
    res.json(profile);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /guest/:phone/checkout
app.post('/guest/:phone/checkout', async (req, res) => {
  try {
    const { phone } = req.params;
    const { nights = 1, name, apartment } = req.body;
    const existing = await db.collection('guests').findOne({ phone }) || {};
    const totalNights = (existing.totalNights || 0) + Number(nights);
    const totalStays  = (existing.totalStays  || 0) + 1;
    const level = calcLevel(totalNights);
    const update = { totalNights, totalStays, level, lastCheckout: new Date(), updatedAt: new Date() };
    if (name) update.name = name;
    if (apartment) update.preferredApartment = apartment;
    await db.collection('guests').updateOne(
      { phone },
      { $set: update, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
    res.json({ ok: true, level, totalNights, totalStays });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /guests/import — importação em lote do Excel (Stays.net)
app.post('/guests/import', async (req, res) => {
  try {
    const guests = req.body;
    if (!Array.isArray(guests)) return res.status(400).json({ error: 'Esperado array de hóspedes' });
    const col = db.collection('guests');
    let imported = 0, errors = 0;
    for (const g of guests) {
      if (!g.phone) { errors++; continue; }
      try {
        const existing = await col.findOne({ phone: g.phone }) || {};
        // Só atualiza level/totalNights se os dados do Excel forem maiores
        // (evita sobrescrever dados já incrementados pelo bot)
        const totalNights = Math.max(existing.totalNights || 0, g.totalNights || 0);
        const totalStays  = Math.max(existing.totalStays  || 0, g.totalStays  || 0);
        const level = calcLevel(totalNights);
        const update = {
          ...g,
          totalNights,
          totalStays,
          level,
          updatedAt: new Date(),
        };
        delete update._id;
        await col.updateOne(
          { phone: g.phone },
          { $set: update, $setOnInsert: { createdAt: new Date() } },
          { upsert: true }
        );
        imported++;
      } catch (e) { errors++; }
    }
    console.log(`[import] ${imported} importados, ${errors} erros`);
    res.json({ ok: true, imported, errors });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /guests/search?q=nome — busca por nome para o painel
app.get('/guests/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const terms = q.split(/\s+/).filter(Boolean);
    const regex = new RegExp(terms.join('.*'), 'i');
    const guests = await db.collection('guests')
      .find({ name: { $regex: regex } })
      .sort({ totalNights: -1 })
      .limit(30)
      .project({ _id: 0 })
      .toArray();
    res.json(guests);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /guests/stats — totais para o dashboard
app.get('/guests/stats', async (req, res) => {
  try {
    const col = db.collection('guests');
    const [total, embaixador, vip, frequente] = await Promise.all([
      col.countDocuments(),
      col.countDocuments({ level: 'Embaixador' }),
      col.countDocuments({ level: 'VIP' }),
      col.countDocuments({ level: 'Frequente' }),
    ]);
    res.json({ total, embaixador, vip, frequente, visitante: total - embaixador - vip - frequente });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Boot ─────────────────────────────────────────────────────────────────
function scheduleCampaigns() {
    const now  = new Date();
    const next = new Date();
    next.setHours(10, 30, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delayMs = next - now;
    console.log('[campaign] Proxima execucao agendada: ' +
                next.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) +
                ' (em ' + Math.round(delayMs / 60000) + ' min)');
    setTimeout(async function() {
          try {
                  await dailyCampaignRun(db);
          } catch (err) {
                  console.error('[campaign] Erro na execucao agendada', err);
          } finally {
                  scheduleCampaigns();
          }
    }, delayMs);
}
async function start() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db();
  await db.collection('messages').createIndex({ phone: 1, ts: -1 });
  await db.collection('guests').createIndex({ phone: 1 }, { unique: true });
  await db.collection('guests').createIndex({ name: 1 });
  console.log('[crm-server] MongoDB conectado');
  app.listen(PORT, () => console.log(`[crm-server] Porta ${PORT}`));
    scheduleCampaigns();
}
start().catch(err => { console.error('[crm-server] Falha:', err.message); process.exit(1); });
