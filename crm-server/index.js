'use strict';
/**
 * crm-server/index.js
 * TorresGuest CRM API — Express + MongoDB
 * Deploy no VPS Hostgator. Porta padrão: 3001.
 *
 * Rotas:
 *   GET  /health
 *   POST /guest/:phone/message     — salva mensagem
 *   GET  /guest/:phone/context     — retorna últimas 10 mensagens
 *   GET  /guest/:phone/profile     — retorna perfil do hóspede
 *   PUT  /guest/:phone/profile     — atualiza perfil
 *   POST /guest/:phone/checkout    — registra checkout e incrementa fidelidade
 */

require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());

const PORT       = process.env.PORT        || 3001;
const MONGO_URI  = process.env.MONGODB_URI || 'mongodb://localhost:27017/torresguest';
const API_KEY    = process.env.CRM_API_KEY || '';

let db;

// ---- Auth middleware -------------------------------------------------------
app.use((req, res, next) => {
  if (API_KEY && req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// ---- Level calculation -----------------------------------------------------
function calcLevel(totalNights = 0) {
  if (totalNights >= 20) return 'Embaixador';
  if (totalNights >= 10) return 'VIP';
  if (totalNights >= 4)  return 'Frequente';
  return 'Visitante';
}

// ---- Routes ----------------------------------------------------------------

app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date() }));

// POST /guest/:phone/message
app.post('/guest/:phone/message', async (req, res) => {
  try {
    const { phone } = req.params;
    const { role, content } = req.body;
    if (!role || !content) return res.status(400).json({ error: 'role e content obrigatórios' });
    await db.collection('messages').insertOne({ phone, role, content, ts: new Date() });
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /message]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /guest/:phone/context
app.get('/guest/:phone/context', async (req, res) => {
  try {
    const { phone } = req.params;
    const limit = Math.min(Number(req.query.limit) || 10, 30);
    const msgs = await db.collection('messages')
      .find({ phone })
      .sort({ ts: -1 })
      .limit(limit)
      .toArray();
    res.json(msgs.reverse()); // oldest first
  } catch (err) {
    console.error('[GET /context]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /guest/:phone/profile
app.get('/guest/:phone/profile', async (req, res) => {
  try {
    const { phone } = req.params;
    const profile = await db.collection('guests').findOne({ phone }, { projection: { _id: 0 } });
    if (!profile) return res.json({ phone, level: 'Visitante', totalNights: 0, totalStays: 0 });
    res.json(profile);
  } catch (err) {
    console.error('[GET /profile]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /guest/:phone/profile — atualiza campos livres
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
  } catch (err) {
    console.error('[PUT /profile]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /guest/:phone/checkout — registra estadia e recalcula nível
app.post('/guest/:phone/checkout', async (req, res) => {
  try {
    const { phone } = req.params;
    const { nights = 1, name, apartment } = req.body;

    const existing = await db.collection('guests').findOne({ phone }) || {};
    const totalNights = (existing.totalNights || 0) + Number(nights);
    const totalStays  = (existing.totalStays  || 0) + 1;
    const level       = calcLevel(totalNights);

    const update = { totalNights, totalStays, level, lastCheckout: new Date(), updatedAt: new Date() };
    if (name)      update.name               = name;
    if (apartment) update.preferredApartment = apartment;

    await db.collection('guests').updateOne(
      { phone },
      { $set: update, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );

    console.log(`[checkout] ${phone} — ${totalNights} noites — nível: ${level}`);
    res.json({ ok: true, level, totalNights, totalStays });
  } catch (err) {
    console.error('[POST /checkout]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---- Boot ------------------------------------------------------------------
async function start() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db();

  // Indexes
  await db.collection('messages').createIndex({ phone: 1, ts: -1 });
  await db.collection('guests').createIndex({ phone: 1 }, { unique: true });

  console.log('[crm-server] MongoDB conectado:', MONGO_URI);
  app.listen(PORT, () => console.log(`[crm-server] Ouvindo na porta ${PORT}`));
}

start().catch(err => {
  console.error('[crm-server] Falha ao iniciar:', err.message);
  process.exit(1);
});
