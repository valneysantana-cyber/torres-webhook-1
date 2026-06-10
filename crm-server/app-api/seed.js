'use strict';

/**
 * app-api/seed.js — Cria os primeiros usuários e o cadastro de imóvel (com coords).
 *
 * Uso:
 *   MONGODB_URI=... APP_JWT_SECRET=... node crm-server/app-api/seed.js
 *
 * Idempotente: se o login já existir, atualiza papel/escopo e (se SEED_RESET_PW=1) a senha.
 * Senhas vêm de variáveis de ambiente; nunca commitar senhas no código.
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');
const { hashPassword, ensureIndexes } = require('./auth');
const { ensureIndexes: ensureInspIdx } = require('./inspections');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/torresguest';
const RESET_PW = process.env.SEED_RESET_PW === '1';

// senhas via env (com fallback só para ambiente de teste local)
const PW = {
  admin: process.env.SEED_PW_ADMIN || 'trocar-admin-123',
  glauco: process.env.SEED_PW_GLAUCO || 'trocar-glauco-123',
  provider: process.env.SEED_PW_PROVIDER || 'trocar-prestador-123',
};

// Flat 1704 do Glauco (listingStaysId real do projeto). Coords aprox. Hotel Transamérica Perdizes.
const LISTING_1704 = '6a1058da0e560b8533401b99';

const USERS = [
  { name: 'Equipe ConciergeCloud', login: 'admin@conciergecloud.com.br', role: 'admin', tenantId: 'torres', listings: [], pw: PW.admin },
  { name: 'Glauco Vaz', login: 'g.vazflats@gmail.com', role: 'host', tenantId: 'glauco-vaz', listings: [LISTING_1704], pw: PW.glauco },
  { name: 'Prestador (vistoriador)', login: 'prestador@glauco-vaz.app', role: 'provider', tenantId: 'glauco-vaz', listings: [LISTING_1704], pw: PW.provider },
  // exemplo de proprietário (mesma pessoa pode ser host e owner — aqui ilustrativo)
  { name: 'Glauco Vaz (proprietário)', login: 'owner.1704@glauco-vaz.app', role: 'owner', tenantId: 'glauco-vaz', listings: [LISTING_1704], pw: PW.glauco },
];

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db();
  await ensureIndexes(db);
  await ensureInspIdx(db);

  for (const u of USERS) {
    const login = u.login.toLowerCase();
    const existing = await db.collection('app_users').findOne({ login });
    const base = { tenantId: u.tenantId, name: u.name, role: u.role, listings: u.listings, active: true, updatedAt: new Date() };
    if (existing) {
      const set = { ...base };
      if (RESET_PW) set.passwordHash = await hashPassword(u.pw);
      await db.collection('app_users').updateOne({ login }, { $set: set });
      console.log(`~ atualizado: ${login} (${u.role})${RESET_PW ? ' [senha redefinida]' : ''}`);
    } else {
      await db.collection('app_users').insertOne({ login, passwordHash: await hashPassword(u.pw), createdAt: new Date(), ...base });
      console.log(`+ criado: ${login} (${u.role})`);
    }
  }

  // cadastro do imóvel com coordenadas (para geofencing) — Hotel Transamérica Executive Perdizes
  await db.collection('app_listings').updateOne(
    { tenantId: 'glauco-vaz', listingId: LISTING_1704 },
    { $set: { tenantId: 'glauco-vaz', listingId: LISTING_1704, name: '1704', address: 'Rua Monte Alegre, 835 — Perdizes, São Paulo',
              coords: { lat: -23.5388, lng: -46.6722 }, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );
  console.log('+ imóvel cadastrado: 1704 (com coords para geofencing)');

  console.log('\nSeed concluído. Defina SEED_RESET_PW=1 e SEED_PW_* para gravar senhas reais.');
  await client.close();
}

main().catch(err => { console.error('seed falhou:', err); process.exit(1); });
