'use strict';

/**
 * app-api/owner.js — Visão quantitativa do proprietário (SEM valores financeiros).
 *
 * Lê a coleção `reservations` (modelo OTA já existente) filtrando pelo tenant e
 * pelos imóveis do usuário. Devolve contagem passada/futura, ocupação por mês e
 * histórico de vistorias — NUNCA campos de valor (totalValue, commission).
 *
 * Disponível para owner (seu imóvel), host e admin. provider não acessa.
 */

const { requireAuth, requireRole, canAccessListing } = require('./auth');

// campos financeiros que JAMAIS saem nesta visão
const MONEY_FIELDS = ['totalValue', 'commission', 'value', 'price', 'amount', 'revenue'];

// parse de datas "01 jul 2026" / "2026-07-01" → Date (meio-dia local) ou null
const MESES = { jan:0, fev:1, mar:2, abr:3, mai:4, jun:5, jul:6, ago:7, set:8, out:9, nov:10, dez:11 };
function parseResDate(s) {
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3], 12);
  const pt = /^(\d{1,2})\s+([a-zç]{3})/i.exec(String(s).toLowerCase());
  if (pt && MESES[pt[2]] != null) {
    const y = /(\d{4})/.exec(s); return new Date(y ? +y[1] : new Date().getFullYear(), MESES[pt[2]], +pt[1], 12);
  }
  return null;
}

function mountOwnerRoutes(router, db) {
  // GET /app/v1/listings/:id/stats  — quantitativo + ocupação (sem R$)
  router.get('/listings/:id/stats', requireAuth, requireRole('owner', 'host', 'admin'), async (req, res) => {
    try {
      const listingId = String(req.params.id);
      if (!canAccessListing(req.user, listingId)) return res.status(403).json({ error: 'Sem acesso a este imóvel' });

      const tenantId = req.user.role === 'admin' ? (req.query.tenantId || undefined) : req.user.tenantId;
      const q = {};
      if (tenantId) q.tenantId = tenantId;
      // o listing pode vir por listingStaysId OU listingName (modelo legado)
      q.$or = [{ listingStaysId: listingId }, { staysId: listingId }, { listingName: listingId }];

      const cancelled = /^cancel/i;
      const res_docs = await db.collection('reservations')
        .find(q, { projection: { totalValue: 0, commission: 0 } })
        .toArray();

      const now = new Date();
      let past = 0, future = 0, active = 0, cancelledCount = 0;
      const byMonth = {}; // 'YYYY-MM' -> noites
      for (const r of res_docs) {
        if (r.status && cancelled.test(r.status)) { cancelledCount++; continue; }
        const ci = parseResDate(r.checkin), co = parseResDate(r.checkout);
        if (ci && co) {
          if (co < now) past++;
          else if (ci > now) future++;
          else active++;
          // ocupação: distribui noites pelos meses
          const nights = Math.max(1, Math.round((co - ci) / 86400000));
          for (let i = 0; i < nights; i++) {
            const d = new Date(ci.getTime() + i * 86400000);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            byMonth[key] = (byMonth[key] || 0) + 1;
          }
        } else if (ci && ci > now) { future++; }
      }
      const occupancy = Object.entries(byMonth).sort().map(([month, nights]) => {
        const [y, m] = month.split('-').map(Number);
        const days = new Date(y, m, 0).getDate();
        return { month, nights, occupancyPct: Math.min(100, Math.round((nights / days) * 100)) };
      });

      // últimas vistorias do imóvel (sem fotos)
      const inspections = await db.collection('inspections')
        .find({ listingId }, { projection: { 'items.photos': 0 } })
        .sort({ date: -1 }).limit(10).toArray();

      res.json({
        listingId,
        totals: { past, future, active, cancelled: cancelledCount, total: past + future + active },
        occupancy,
        inspections: inspections.map(d => ({
          id: String(d._id), date: d.date, status: d.status,
          summary: d.aiReport ? d.aiReport.summary : null,
          issues: d.aiReport ? (d.aiReport.issues || []).length : 0,
        })),
        note: 'Visão quantitativa — valores financeiros omitidos por padrão.',
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
}

module.exports = { mountOwnerRoutes, parseResDate, MONEY_FIELDS };
