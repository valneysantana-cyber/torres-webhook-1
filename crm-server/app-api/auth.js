'use strict';

/**
 * app-api/auth.js — Autenticação por usuário (JWT) + papéis + escopo por imóvel.
 *
 * Diferente da API key compartilhada do crm-server (x-api-key), o app móvel usa
 * login por pessoa: cada usuário tem papel (admin | host | provider | owner) e,
 * para provider/owner, um escopo de imóveis (listings) que limita o que ele vê.
 *
 * Coleção: app_users
 *   { _id, tenantId, name, login, passwordHash, role, listings: [],
 *     active, createdAt, updatedAt }
 *
 * Papéis:
 *   - admin    : acesso a todos os tenants (equipe ConciergeCloud/TorresGuest)
 *   - host     : anfitrião/gestor — todo o seu tenant
 *   - provider : prestador de serviço — só os imóveis (listings) atribuídos
 *   - owner    : proprietário do imóvel — leitura, só os seus imóveis, sem valores
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.APP_JWT_SECRET || '';
const JWT_TTL = process.env.APP_JWT_TTL || '12h';
const ROLES = ['admin', 'host', 'provider', 'owner'];

if (!JWT_SECRET) {
  console.warn('[app-api] AVISO: APP_JWT_SECRET não definido — tokens NÃO serão emitidos até configurar.');
}

// ─── senha ──────────────────────────────────────────────────────────────
async function hashPassword(plain) {
  return bcrypt.hash(String(plain), 10);
}
async function verifyPassword(plain, hash) {
  if (!hash) return false;
  try { return await bcrypt.compare(String(plain), hash); } catch { return false; }
}

// ─── token ──────────────────────────────────────────────────────────────
function signToken(user) {
  if (!JWT_SECRET) throw new Error('APP_JWT_SECRET ausente');
  const payload = {
    uid: String(user._id),
    tenantId: user.tenantId,
    role: user.role,
    name: user.name,
    listings: Array.isArray(user.listings) ? user.listings : [],
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_TTL });
}
function verifyToken(token) {
  if (!JWT_SECRET) return null;
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

// ─── middlewares ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'Token ausente' });
  const claims = verifyToken(m[1]);
  if (!claims) return res.status(401).json({ error: 'Token inválido ou expirado' });
  req.user = claims;
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Sem permissão para esta ação' });
    }
    next();
  };
}

// ─── escopo: tenant + imóvel ───────────────────────────────────────────────
/** Retorna true se o usuário pode ver o tenant informado. */
function canAccessTenant(user, tenantId) {
  if (user.role === 'admin') return true;
  return user.tenantId === tenantId;
}
/** Retorna true se o usuário pode ver o imóvel (listing) informado. */
function canAccessListing(user, listingId) {
  if (!listingId) return false;
  if (user.role === 'admin' || user.role === 'host') return true; // host vê todo o tenant
  return (user.listings || []).map(String).includes(String(listingId));
}
/**
 * Constrói o filtro Mongo base de acordo com o papel.
 * admin: pelo tenant pedido (ou todos); host: seu tenant;
 * provider/owner: seu tenant E listingId ∈ seus listings.
 */
function scopeFilter(user, { tenantIdQuery, listingField = 'listingId' } = {}) {
  const f = {};
  if (user.role === 'admin') {
    if (tenantIdQuery) f.tenantId = tenantIdQuery;
  } else {
    f.tenantId = user.tenantId;
    if (user.role === 'provider' || user.role === 'owner') {
      f[listingField] = { $in: (user.listings || []).map(String) };
    }
  }
  return f;
}

// ─── rotas de auth (montadas pelo index do módulo) ─────────────────────────
function mountAuthRoutes(router, db) {
  // POST /app/v1/auth/login  { login, password }
  router.post('/auth/login', async (req, res) => {
    try {
      const { login, password } = req.body || {};
      if (!login || !password) return res.status(400).json({ error: 'login e password obrigatórios' });
      const user = await db.collection('app_users').findOne({ login: String(login).trim().toLowerCase() });
      if (!user || !user.active) return res.status(401).json({ error: 'Credenciais inválidas' });
      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });
      await db.collection('app_users').updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
      const token = signToken(user);
      res.json({
        token,
        user: { id: String(user._id), name: user.name, role: user.role, tenantId: user.tenantId, listings: user.listings || [] },
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /app/v1/me — perfil do usuário logado
  router.get('/me', requireAuth, async (req, res) => {
    res.json({ user: req.user });
  });

  // POST /app/v1/users — criar usuário (admin cria qualquer; host cria no seu tenant)
  router.post('/users', requireAuth, requireRole('admin', 'host'), async (req, res) => {
    try {
      const { name, login, password, role, tenantId, listings } = req.body || {};
      if (!name || !login || !password || !role) {
        return res.status(400).json({ error: 'name, login, password e role obrigatórios' });
      }
      if (!ROLES.includes(role)) return res.status(400).json({ error: 'role inválido' });
      // host só cria dentro do próprio tenant e não cria admin
      const targetTenant = req.user.role === 'admin' ? (tenantId || req.user.tenantId) : req.user.tenantId;
      if (req.user.role === 'host' && role === 'admin') {
        return res.status(403).json({ error: 'host não pode criar admin' });
      }
      const loginNorm = String(login).trim().toLowerCase();
      const exists = await db.collection('app_users').findOne({ login: loginNorm });
      if (exists) return res.status(409).json({ error: 'login já existe' });
      const doc = {
        tenantId: targetTenant,
        name: String(name).trim(),
        login: loginNorm,
        passwordHash: await hashPassword(password),
        role,
        listings: Array.isArray(listings) ? listings.map(String) : [],
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: req.user.uid,
      };
      const r = await db.collection('app_users').insertOne(doc);
      res.json({ ok: true, id: String(r.insertedId) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /app/v1/listings — imóveis do usuário (com nome amigável), conforme escopo
  router.get('/listings', requireAuth, async (req, res) => {
    try {
      const q = {};
      if (req.user.role === 'admin') { if (req.query.tenantId) q.tenantId = req.query.tenantId; }
      else { q.tenantId = req.user.tenantId; }
      if (req.user.role === 'provider' || req.user.role === 'owner') {
        q.listingId = { $in: (req.user.listings || []).map(String) };
      }
      const docs = await db.collection('app_listings').find(q, { projection: { _id: 0, listingId: 1, name: 1, address: 1 } }).toArray();
      const known = new Set(docs.map(d => String(d.listingId)));
      // imóveis no token sem cadastro em app_listings entram com o próprio id como nome
      const extra = (req.user.listings || []).filter(l => !known.has(String(l))).map(l => ({ listingId: String(l), name: String(l) }));
      res.json([...docs, ...extra].map(d => ({ id: String(d.listingId), name: d.name || String(d.listingId), address: d.address || null })));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /app/v1/users?role=provider — lista usuários do tenant (host/admin)
  router.get('/users', requireAuth, requireRole('admin', 'host'), async (req, res) => {
    try {
      const f = {};
      if (req.user.role === 'host') f.tenantId = req.user.tenantId;
      else if (req.query.tenantId) f.tenantId = req.query.tenantId;
      if (req.query.role && ROLES.includes(req.query.role)) f.role = req.query.role;
      const users = await db.collection('app_users')
        .find(f, { projection: { passwordHash: 0 } }).sort({ name: 1 }).limit(200).toArray();
      res.json(users.map(u => ({ id: String(u._id), name: u.name, login: u.login, role: u.role, tenantId: u.tenantId, listings: u.listings || [], active: u.active })));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /app/v1/devices — registra token de push do dispositivo
  router.post('/devices', requireAuth, async (req, res) => {
    try {
      const { platform, pushToken } = req.body || {};
      if (!pushToken) return res.status(400).json({ error: 'pushToken obrigatório' });
      await db.collection('app_devices').updateOne(
        { userId: req.user.uid, pushToken },
        { $set: { userId: req.user.uid, tenantId: req.user.tenantId, platform: platform || 'unknown', pushToken, updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      );
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
}

async function ensureIndexes(db) {
  await db.collection('app_users').createIndex({ login: 1 }, { unique: true });
  await db.collection('app_users').createIndex({ tenantId: 1, role: 1 });
  await db.collection('app_devices').createIndex({ userId: 1, pushToken: 1 }, { unique: true });
}

module.exports = {
  ROLES, JWT_SECRET,
  hashPassword, verifyPassword, signToken, verifyToken,
  requireAuth, requireRole, canAccessTenant, canAccessListing, scopeFilter,
  mountAuthRoutes, ensureIndexes,
};
