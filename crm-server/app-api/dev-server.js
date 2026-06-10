'use strict';
/* Harness de desenvolvimento: sobe a API /app/v1 + serve o app (www/) no MESMO
 * origin, contra um MongoDB em memória com dados de teste. Sem tocar dados reais.
 *
 *   APP_JWT_SECRET=dev node app-api/dev-server.js   → http://localhost:4000
 *   Logins: glauco@cc / g  ·  prest@cc / p  ·  owner@cc / o  ·  admin@cc / a
 */
process.env.APP_JWT_SECRET = process.env.APP_JWT_SECRET || 'dev-secret';
const path = require('path');
const express = require('express');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const { createAppApi, ensureAppIndexes } = require('./index');
const { hashPassword } = require('./auth');

const PORT = process.env.PORT || 4000;
const L = '6a1058da0e560b8533401b99';

(async () => {
  const mem = await MongoMemoryServer.create();
  const client = new MongoClient(mem.getUri());
  await client.connect();
  const db = client.db('dev');
  await ensureAppIndexes(db);

  await db.collection('app_users').insertMany([
    { login: 'admin@cc', name: 'Equipe ConciergeCloud', role: 'admin', tenantId: 'torres', listings: [], active: true, passwordHash: await hashPassword('a') },
    { login: 'glauco@cc', name: 'Glauco Vaz', role: 'host', tenantId: 'glauco-vaz', listings: [L], active: true, passwordHash: await hashPassword('g') },
    { login: 'prest@cc', name: 'Jessica (vistoriadora)', role: 'provider', tenantId: 'glauco-vaz', listings: [L], active: true, passwordHash: await hashPassword('p') },
    { login: 'owner@cc', name: 'Proprietário 1704', role: 'owner', tenantId: 'glauco-vaz', listings: [L], active: true, passwordHash: await hashPassword('o') },
  ]);
  await db.collection('app_listings').insertOne({ tenantId: 'glauco-vaz', listingId: L, name: '1704', coords: { lat: -23.5388, lng: -46.6722 } });
  await db.collection('reservations').insertMany([
    { tenantId: 'glauco-vaz', listingStaysId: L, listingName: '1704', checkin: '2026-01-10', checkout: '2026-01-12', status: 'checkout', totalValue: 'R$ 800' },
    { tenantId: 'glauco-vaz', listingStaysId: L, listingName: '1704', checkin: '2026-12-20', checkout: '2026-12-23', status: 'reservado' },
    { tenantId: 'glauco-vaz', listingStaysId: L, listingName: '1704', checkin: '2026-07-05', checkout: '2026-07-09', status: 'confirmado' },
  ]);
  // uma vistoria já enviada para popular a home
  await db.collection('inspections').insertOne({
    tenantId: 'glauco-vaz', listingId: L, listingName: '1704', providerId: 'seed', providerName: 'Jessica (vistoriadora)',
    date: '2026-06-08', status: 'reviewed',
    items: [{ category: 'estrutura', key: 'estrutura', label: 'Estrutura', status: 'attention', aiNote: 'Rodapé descolado ~1,5m', photos: [] }],
    aiReport: { ran: true, summary: 'Unidade em bom estado; rodapé precisa de atenção.', issues: ['Recolocar rodapé descolado na sala'], generatedAt: new Date() },
    createdAt: new Date(), updatedAt: new Date(),
  });

  const app = express();
  // CORS liberado APENAS no harness de dev (permite preview estático em outra porta)
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use('/app/v1', createAppApi(db));
  app.use(express.static(path.join(__dirname, '..', '..', 'mobile-app', 'www')));
  app.listen(PORT, () => console.log(`[dev-server] http://localhost:${PORT}  (API em /app/v1)`));
})().catch(e => { console.error(e); process.exit(1); });
