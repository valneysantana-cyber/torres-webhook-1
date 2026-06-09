'use strict';

/**
 * app-api/inspections.js — Vistorias com checklist, fotos, geolocalização e IA.
 *
 * Coleção: inspections
 *   { _id, tenantId, listingId, listingName, room, providerId, providerName,
 *     date 'YYYY-MM-DD', status: 'pending'|'in_progress'|'submitted'|'reviewed',
 *     items: [ { category, key, label, status, photos:[{url|data}], note, aiNote } ],
 *     geo: { lat, lng, accuracy, ts, withinFence },
 *     aiReport: { summary, issues, items, generatedAt, ran },
 *     createdAt, updatedAt }
 *
 * Escopo por papel:
 *   provider → só vistorias atribuídas a ele (providerId) nos seus listings
 *   host     → todo o tenant
 *   owner    → leitura, só os seus listings
 *   admin    → tudo (ou por tenantId na query)
 */

const { requireAuth, requireRole, canAccessListing, scopeFilter } = require('./auth');
const { generateReport } = require('./ai');

// Checklist padrão (configurável por tenant no futuro). Reaproveita as categorias do inventário.
const CHECKLIST = [
  { category: 'frigobar',  key: 'frigobar',   label: 'Frigobar — itens e quantidades' },
  { category: 'enxoval',   key: 'cama',       label: 'Enxoval de cama — limpeza e estado' },
  { category: 'enxoval',   key: 'banho',      label: 'Enxoval de banho — toalhas e reposição' },
  { category: 'banheiro',  key: 'banheiro',   label: 'Banheiro e amenidades' },
  { category: 'eletro',    key: 'eletro',     label: 'Eletro e mobília (TV, ar, cafeteira)' },
  { category: 'estrutura', key: 'estrutura',  label: 'Estrutura / defeitos (paredes, rodapé, fechaduras)' },
];

// distância (m) entre dois pontos GPS — Haversine
function distMeters(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371000, rad = x => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
}

const GEOFENCE_M = parseInt(process.env.APP_GEOFENCE_METERS || '200', 10);

// remove fotos pesadas da resposta de listagem (mantém contagem)
function lightItems(items = []) {
  return items.map(it => ({
    category: it.category, key: it.key, label: it.label, status: it.status,
    note: it.note, aiNote: it.aiNote, photoCount: Array.isArray(it.photos) ? it.photos.length : 0,
  }));
}

function mountInspectionRoutes(router, db) {
  // catálogo do checklist
  router.get('/inspections/checklist', requireAuth, (_req, res) => res.json({ checklist: CHECKLIST }));

  // GET /app/v1/inspections?date=&listingId=&status=  (escopo por papel)
  router.get('/inspections', requireAuth, async (req, res) => {
    try {
      const f = scopeFilter(req.user, { tenantIdQuery: req.query.tenantId, listingField: 'listingId' });
      if (req.user.role === 'provider') f.providerId = req.user.uid;
      if (req.query.date) f.date = String(req.query.date);
      if (req.query.listingId) {
        if (!canAccessListing(req.user, req.query.listingId)) return res.status(403).json({ error: 'Sem acesso a este imóvel' });
        f.listingId = String(req.query.listingId);
      }
      if (req.query.status) f.status = String(req.query.status);
      const docs = await db.collection('inspections')
        .find(f).sort({ date: -1, updatedAt: -1 }).limit(200).toArray();
      res.json(docs.map(d => ({
        id: String(d._id), tenantId: d.tenantId, listingId: d.listingId, listingName: d.listingName,
        room: d.room, providerName: d.providerName, date: d.date, status: d.status,
        items: lightItems(d.items), geo: d.geo ? { withinFence: d.geo.withinFence, ts: d.geo.ts } : null,
        aiReport: d.aiReport ? { summary: d.aiReport.summary, issues: d.aiReport.issues, ran: d.aiReport.ran, generatedAt: d.aiReport.generatedAt } : null,
        updatedAt: d.updatedAt,
      })));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /app/v1/inspections/:id  (detalhe; owner não recebe fotos cruas pesadas mas vê estado)
  router.get('/inspections/:id', requireAuth, async (req, res) => {
    try {
      const { ObjectId } = require('mongodb');
      let _id; try { _id = new ObjectId(req.params.id); } catch { return res.status(400).json({ error: 'id inválido' }); }
      const d = await db.collection('inspections').findOne({ _id });
      if (!d) return res.status(404).json({ error: 'Vistoria não encontrada' });
      if (!canAccessListing(req.user, d.listingId)) return res.status(403).json({ error: 'Sem acesso' });
      if (req.user.role === 'provider' && d.providerId !== req.user.uid) return res.status(403).json({ error: 'Sem acesso' });
      res.json({ ...d, id: String(d._id) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /app/v1/inspections  — cria/submete vistoria (provider ou host)
  // body: { listingId, listingName, room, date, status, items:[{category,key,label,status,note,photos:[{data}]}], geo:{lat,lng,accuracy} }
  router.post('/inspections', requireAuth, requireRole('provider', 'host', 'admin'), async (req, res) => {
    try {
      const b = req.body || {};
      if (!b.listingId) return res.status(400).json({ error: 'listingId obrigatório' });
      if (!canAccessListing(req.user, b.listingId)) return res.status(403).json({ error: 'Sem acesso a este imóvel' });

      // geofencing: compara geo enviada com a coordenada cadastrada do listing
      let geo = null;
      if (b.geo && b.geo.lat != null && b.geo.lng != null) {
        let withinFence = null;
        try {
          const listing = await db.collection('app_listings').findOne({ tenantId: req.user.tenantId === 'admin' ? undefined : req.user.tenantId, listingId: String(b.listingId) })
            || await db.collection('app_listings').findOne({ listingId: String(b.listingId) });
          if (listing && listing.coords) {
            const dist = distMeters(listing.coords, b.geo);
            withinFence = dist != null ? dist <= GEOFENCE_M : null;
            geo = { ...b.geo, distMeters: dist, withinFence, ts: new Date() };
          }
        } catch { /* listing sem coords cadastradas */ }
        if (!geo) geo = { ...b.geo, withinFence: null, ts: new Date() };
      }

      const tenantId = req.user.role === 'admin' ? (b.tenantId || req.user.tenantId) : req.user.tenantId;
      const doc = {
        tenantId,
        listingId: String(b.listingId),
        listingName: b.listingName || null,
        room: b.room || null,
        providerId: req.user.uid,
        providerName: req.user.name,
        date: b.date || new Date().toISOString().slice(0, 10),
        status: b.status === 'in_progress' ? 'in_progress' : 'submitted',
        items: Array.isArray(b.items) ? b.items : [],
        geo,
        aiReport: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const r = await db.collection('inspections').insertOne(doc);
      res.json({ ok: true, id: String(r.insertedId), status: doc.status });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /app/v1/inspections/:id/ai-report — dispara análise por IA (host/admin)
  router.post('/inspections/:id/ai-report', requireAuth, requireRole('host', 'admin'), async (req, res) => {
    try {
      const { ObjectId } = require('mongodb');
      let _id; try { _id = new ObjectId(req.params.id); } catch { return res.status(400).json({ error: 'id inválido' }); }
      const d = await db.collection('inspections').findOne({ _id });
      if (!d) return res.status(404).json({ error: 'Vistoria não encontrada' });
      if (!canAccessListing(req.user, d.listingId)) return res.status(403).json({ error: 'Sem acesso' });

      const report = await generateReport(d);

      // aplica status sugerido por item (se a IA rodou)
      const items = Array.isArray(d.items) ? [...d.items] : [];
      if (report.ran && Array.isArray(report.items)) {
        for (const r of report.items) {
          if (typeof r.index === 'number' && items[r.index]) {
            if (r.status) items[r.index].status = r.status;
            if (r.note) items[r.index].aiNote = r.note;
          }
        }
      }
      await db.collection('inspections').updateOne(
        { _id },
        { $set: { items, aiReport: report, status: 'reviewed', updatedAt: new Date() } }
      );
      res.json({ ok: true, ran: report.ran, summary: report.summary, issues: report.issues, reason: report.reason });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
}

async function ensureIndexes(db) {
  await db.collection('inspections').createIndex({ tenantId: 1, date: -1 });
  await db.collection('inspections').createIndex({ tenantId: 1, listingId: 1, date: -1 });
  await db.collection('inspections').createIndex({ providerId: 1, date: -1 });
  await db.collection('app_listings').createIndex({ tenantId: 1, listingId: 1 }, { unique: true });
}

module.exports = { mountInspectionRoutes, ensureIndexes, CHECKLIST, distMeters };
