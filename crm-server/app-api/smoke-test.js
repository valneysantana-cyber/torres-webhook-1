'use strict';

/**
 * smoke-test.js — Testa a App API ponta a ponta sem tocar dados reais.
 * Sobe um MongoDB em memória, monta a API, e valida auth + papéis + escopo + vistoria.
 *
 *   APP_JWT_SECRET=test node app-api/smoke-test.js
 */

process.env.APP_JWT_SECRET = process.env.APP_JWT_SECRET || 'smoke-secret';
// força ausência de chave de IA pra testar a degradação segura
delete process.env.ANTHROPIC_API_KEY;

const http = require('http');
const express = require('express');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const { attachAppApi, ensureAppIndexes } = require('./index');
const { hashPassword } = require('./auth');

let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓', msg); } else { failed++; console.log('  ✗', msg); } }

function req(server, method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const r = http.request({ ...server.address(), host: '127.0.0.1', method, path, headers }, res => {
      let buf = ''; res.on('data', c => buf += c);
      res.on('end', () => { let j; try { j = JSON.parse(buf); } catch { j = buf; } resolve({ status: res.statusCode, body: j }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

(async () => {
  const mem = await MongoMemoryServer.create();
  const client = new MongoClient(mem.getUri());
  await client.connect();
  const db = client.db('smoke');
  await ensureAppIndexes(db);

  // seed: 1 admin, 1 host(glauco-vaz), 1 provider(escopo L1704), 1 owner; + outro tenant pra testar vazamento
  const L = '6a1058da0e560b8533401b99', L_OUTRO = 'outro-listing-999';
  await db.collection('app_users').insertMany([
    { login: 'admin@cc', name: 'Admin', role: 'admin', tenantId: 'torres', listings: [], active: true, passwordHash: await hashPassword('a') },
    { login: 'glauco@cc', name: 'Glauco', role: 'host', tenantId: 'glauco-vaz', listings: [L], active: true, passwordHash: await hashPassword('g') },
    { login: 'prest@cc', name: 'Prestador', role: 'provider', tenantId: 'glauco-vaz', listings: [L], active: true, passwordHash: await hashPassword('p') },
    { login: 'owner@cc', name: 'Dono', role: 'owner', tenantId: 'glauco-vaz', listings: [L], active: true, passwordHash: await hashPassword('o') },
  ]);
  await db.collection('app_listings').insertOne({ tenantId: 'glauco-vaz', listingId: L, name: '1704', coords: { lat: -23.5388, lng: -46.6722 } });
  // reservas de exemplo (uma passada, uma futura, uma cancelada) — só do listing L
  await db.collection('reservations').insertMany([
    { tenantId: 'glauco-vaz', listingStaysId: L, listingName: '1704', checkin: '2026-01-10', checkout: '2026-01-12', status: 'checkout', totalValue: 'R$ 800', commission: 'R$ 100' },
    { tenantId: 'glauco-vaz', listingStaysId: L, listingName: '1704', checkin: '2026-12-20', checkout: '2026-12-23', status: 'reservado', totalValue: 'R$ 1200' },
    { tenantId: 'glauco-vaz', listingStaysId: L, listingName: '1704', checkin: '2026-11-01', checkout: '2026-11-03', status: 'cancelado' },
  ]);

  const app = express();
  attachAppApi(app, db); // monta na raiz pra simplificar paths
  const server = http.createServer(app).listen(0);
  await new Promise(r => server.on('listening', r));

  console.log('\n— AUTH —');
  let r = await req(server, 'POST', '/auth/login', { body: { login: 'glauco@cc', password: 'wrong' } });
  ok(r.status === 401, 'login com senha errada → 401');
  r = await req(server, 'POST', '/auth/login', { body: { login: 'glauco@cc', password: 'g' } });
  ok(r.status === 200 && r.body.token, 'login válido → token');
  const tHost = r.body.token;
  const tAdmin = (await req(server, 'POST', '/auth/login', { body: { login: 'admin@cc', password: 'a' } })).body.token;
  const tProv = (await req(server, 'POST', '/auth/login', { body: { login: 'prest@cc', password: 'p' } })).body.token;
  const tOwner = (await req(server, 'POST', '/auth/login', { body: { login: 'owner@cc', password: 'o' } })).body.token;

  r = await req(server, 'GET', '/inspections');
  ok(r.status === 401, 'sem token → 401');
  r = await req(server, 'GET', '/me', { token: tHost });
  ok(r.status === 200 && r.body.user.role === 'host', '/me devolve papel host');

  console.log('\n— VISTORIA (provider cria) —');
  const insBody = { listingId: L, listingName: '1704', date: '2026-06-09',
    items: [{ category: 'frigobar', key: 'frigobar', label: 'Frigobar', note: '2 águas', photos: [] },
            { category: 'enxoval', key: 'cama', label: 'Cama', photos: [] }],
    geo: { lat: -23.5388, lng: -46.6722, accuracy: 8 } };
  r = await req(server, 'POST', '/inspections', { token: tProv, body: insBody });
  ok(r.status === 200 && r.body.id, 'provider cria vistoria no seu imóvel');
  const insId = r.body.id;

  r = await req(server, 'POST', '/inspections', { token: tProv, body: { ...insBody, listingId: L_OUTRO } });
  ok(r.status === 403, 'provider NÃO cria vistoria fora do seu escopo → 403');

  r = await req(server, 'GET', '/inspections', { token: tProv });
  ok(r.status === 200 && r.body.length === 1, 'provider lista só as próprias vistorias');
  ok(r.body[0].items && r.body[0].items[0].photoCount === 0, 'listagem traz photoCount (sem fotos pesadas)');
  ok(r.body[0].geo && r.body[0].geo.withinFence === true, 'geofencing: dentro do raio do imóvel');

  console.log('\n— ESCOPO / ISOLAMENTO —');
  r = await req(server, 'POST', '/inspections/' + insId + '/ai-report', { token: tProv });
  ok(r.status === 403, 'provider NÃO dispara relatório IA → 403 (só host/admin)');
  r = await req(server, 'POST', '/inspections/' + insId + '/ai-report', { token: tHost });
  ok(r.status === 200 && r.body.ran === false, 'host dispara IA; degrada sem ANTHROPIC_API_KEY (ran=false)');

  console.log('\n— PROPRIETÁRIO (sem valores) —');
  r = await req(server, 'GET', '/listings/' + L + '/stats', { token: tOwner });
  ok(r.status === 200, 'owner acessa stats do seu imóvel');
  ok(r.body.totals && r.body.totals.past === 1 && r.body.totals.future === 1, 'contagem passada/futura correta');
  ok(r.body.totals.cancelled === 1, 'cancelada contabilizada à parte');
  const raw = JSON.stringify(r.body);
  ok(!/totalValue|commission|R\$/.test(raw), 'NENHUM valor financeiro vaza na visão do proprietário');
  ok(Array.isArray(r.body.occupancy) && r.body.occupancy.length >= 1, 'ocupação por mês calculada');

  r = await req(server, 'GET', '/listings/' + L_OUTRO + '/stats', { token: tOwner });
  ok(r.status === 403, 'owner NÃO acessa imóvel fora do seu escopo → 403');
  r = await req(server, 'GET', '/inspections', { token: tOwner });
  // owner não é provider/host: scopeFilter restringe por listings; deve ver a vistoria do L (read)
  ok(r.status === 200, 'owner lista vistorias (somente do seu escopo)');

  console.log('\n— ADMIN / USUÁRIOS —');
  r = await req(server, 'POST', '/users', { token: tProv, body: { name: 'x', login: 'x@x', password: 'x', role: 'host' } });
  ok(r.status === 403, 'provider NÃO cria usuário → 403');
  r = await req(server, 'POST', '/users', { token: tAdmin, body: { name: 'Nova Camareira', login: 'cam@cc', password: 'c123', role: 'provider', tenantId: 'glauco-vaz', listings: [L] } });
  ok(r.status === 200 && r.body.id, 'admin cria usuário');
  r = await req(server, 'GET', '/users?role=provider', { token: tHost });
  ok(r.status === 200 && r.body.length >= 2 && !JSON.stringify(r.body).includes('passwordHash'), 'host lista prestadores (sem passwordHash)');
  const provId = r.body.find(u => u.login === 'prest@cc').id;

  console.log('\n— LISTINGS (nome amigável) —');
  r = await req(server, 'GET', '/listings', { token: tProv });
  ok(r.status === 200 && r.body.length === 1 && r.body[0].name === '1704' && r.body[0].id === L, 'provider vê seu imóvel com nome amigável (1704)');
  r = await req(server, 'GET', '/listings', { token: tOwner });
  ok(r.status === 200 && r.body[0] && r.body[0].name === '1704', 'owner vê só o seu imóvel com nome');

  console.log('\n— ATRIBUIÇÃO —');
  r = await req(server, 'POST', '/inspections/assign', { token: tHost, body: { providerId: provId, listingId: L, listingName: '1704', date: '2026-06-10' } });
  ok(r.status === 200 && r.body.status === 'pending', 'host atribui vistoria pendente ao prestador');
  r = await req(server, 'POST', '/inspections/assign', { token: tProv, body: { providerId: provId, listingId: L, date: '2026-06-10' } });
  ok(r.status === 403, 'provider NÃO atribui vistoria → 403');
  r = await req(server, 'GET', '/inspections', { token: tProv });
  ok(r.body.some(d => d.status === 'pending'), 'prestador vê a vistoria pendente atribuída a ele');

  console.log('\n— STORAGE (fallback inline sem R2) —');
  const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  r = await req(server, 'POST', '/inspections', { token: tProv, body: { listingId: L, listingName: '1704', date: '2026-06-09',
    items: [{ category: 'frigobar', key: 'frigobar', label: 'Frigobar', photos: [{ data: px }] }], geo: { lat: -23.5388, lng: -46.6722 } } });
  ok(r.status === 200 && r.body.storage === 'inline', 'sem R2 → fotos ficam inline (fallback)');
  r = await req(server, 'GET', '/inspections/' + r.body.id, { token: tHost });
  ok(r.status === 200 && r.body.items[0].photos[0].data, 'detalhe devolve a foto inline');

  console.log(`\n=== RESULTADO: ${passed} ok, ${failed} falhas ===`);
  server.close(); await client.close(); await mem.stop();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ERRO no teste:', e); process.exit(1); });
