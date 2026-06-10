require('dotenv').config();
const { MongoClient } = require('mongodb');

(async () => {
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const db = c.db('torresguest');

  const phones = ['5511999073135', '11999073135', '999073135'];

  // 1. TODAS as reservas (qualquer status)
  console.log('=== TODAS as reservas (qualquer status) ===');
  for (const p of phones) {
    const rs = await db.collection('reservations').find(
      { $or: [{ guestPhoneClean: p }, { guestPhone: { $regex: p } }] }
    ).sort({ updatedAt: -1, checkInDate: -1 }).toArray();
    if (rs.length) {
      console.log(`phone=${p} → ${rs.length} reservas:`);
      rs.forEach(r => {
        console.log(`  ${r.staysReservationId||'(no-id)'} | tenant=${r.tenantId} | status=${r.status} | checkIn=${r.checkInDate?new Date(r.checkInDate).toISOString().slice(0,10):'-'} | updatedAt=${r.updatedAt?new Date(r.updatedAt).toISOString().slice(0,16):'-'} | cancelReason=${r.cancellationReasonReceivedAt?'SET':'-'} | cancelRetention=${r.cancellationRetentionSentAt?'SET':'-'} | phone=${r.guestPhone}`);
      });
    }
  }

  // 2. Cancellation recente (7d window)
  console.log('\n=== Cancelamentos recentes (window 7d) ===');
  const weekAgo = new Date(Date.now() - 7*24*3600*1000);
  for (const p of phones) {
    const r = await db.collection('reservations').findOne(
      { guestPhoneClean: p, status: { $in: ['cancelado', 'no-show'] } },
      { sort: { updatedAt: -1, checkInDate: -1 } }
    );
    if (r) {
      const ts = r.cancellationReasonReceivedAt || r.cancellationRetentionSentAt || r.updatedAt || r.createdAt;
      const ageH = ts ? Math.round((Date.now() - new Date(ts).getTime())/3600000) : null;
      const inWindow = ts && new Date(ts) > weekAgo;
      console.log(`  phone=${p}: ${r.staysReservationId} tenant=${r.tenantId} status=${r.status} idade=${ageH}h inWindow7d=${inWindow}`);
    }
  }

  // 3. Tenant master (default torres)
  console.log('\n=== Tenant default (torres) ===');
  const torres = await db.collection('tenants').findOne({tenantId:'torres'},{projection:{tenantId:1,name:1,active:1}});
  console.log('  ', torres);

  // 4. cc_sales current state
  console.log('\n=== cc_sales current state ===');
  const cc = await db.collection('tenants').findOne({tenantId:'cc_sales'},{projection:{settings:{humanEscalationNumber:1,signatureName:1},updatedAt:1,active:1}});
  console.log('  ', cc);

  await c.close();
})().catch(e => console.error('ERR', e.message));
