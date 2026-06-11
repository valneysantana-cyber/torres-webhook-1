'use strict';
/**
 * app-api/overview.js — Painel consolidado do ADMIN no app (v6, 11/06/2026).
 *
 * GET /app/v1/admin/overview  (JWT, roles admin|host)
 * Compõe o resumo do dia SEM duplicar lógica: faz proxy interno (127.0.0.1)
 * pros endpoints do Monitor NOC, que já são tenant-aware e testados:
 *   - /monitor/health            → status do sistema (SÓ role admin)
 *   - /monitor/occupancy         → ocupação de hoje
 *   - /monitor/inspections-today → vistorias exigidas/feitas + checkins/outs
 *   - /monitor/finance           → receita do mês corrente
 */
const { requireAuth, requireRole } = require('./auth');

const PORT = process.env.PORT || 3001;

async function internal(path, asUser) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}${path}`, {
      headers: { 'X-Remote-User': asUser },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function mountOverviewRoutes(router) {
  router.get('/admin/overview', requireAuth, requireRole('admin', 'host'), async (req, res) => {
    try {
      const tenant = req.user.tenantId || 'torres';
      const isAdmin = req.user.role === 'admin';
      const [health, occupancy, inspections, finance] = await Promise.all([
        isAdmin ? internal('/monitor/health', 'admin') : Promise.resolve(null),
        internal('/monitor/occupancy', tenant),
        internal('/monitor/inspections-today', tenant),
        internal('/monitor/finance', tenant),
      ]);
      const months = (finance && finance.months) || [];
      const cur = months[months.length - 1] || {};
      res.json({
        tenant,
        generatedAt: new Date(),
        system: health ? {
          overall: health.overall,
          checks: (health.checks || []).map(c => ({ label: c.label, status: c.status, detail: c.detail })),
        } : null,
        occupancy: occupancy ? {
          occupied: occupancy.occupied, total: occupancy.total, free: occupancy.free, pct: occupancy.pct,
          occupiedRooms: occupancy.occupiedRooms || [], freeRooms: occupancy.freeRooms || [],
        } : null,
        inspections: inspections ? {
          required: inspections.required, done: inspections.done, pending: inspections.pending, ok: inspections.ok,
          checkins: inspections.checkins || [], checkouts: inspections.checkouts || [],
        } : null,
        month: cur.label ? { label: cur.label, revenue: cur.revenue || 0, reservations: cur.reservations || null } : null,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}

module.exports = { mountOverviewRoutes };
