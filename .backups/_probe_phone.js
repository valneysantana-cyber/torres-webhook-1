require('dotenv').config();
const { MongoClient } = require('mongodb');

(async () => {
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const db = c.db('torresguest');

  const phones = ['5511999073135', '11999073135', '999073135'];
  for (const p of phones) {
    const rs = await db.collection('reservations').find(
      { $or: [{ guestPhoneClean: p }, { guestPhone: { $regex: p } }] },
      {
        projection: {
          guestName: 1, guestPhone: 1, guestPhoneClean: 1, status: 1,
          checkInDate: 1, checkOutDate: 1, tenantId: 1,
          staysReservationId: 1, updatedAt: 1,
          cancellationReasonReceivedAt: 1, cancellationRetentionSentAt: 1,
        },
      }
    ).sort({ checkInDate: -1 }).limit(5).toArray();
    if (rs.length) {
      console.log('phone=' + p + ' →', rs.length, 'reservas:');
      rs.forEach(r => console.log('  ', r.staysReservationId || '(no-id)', '| tenant=' + r.tenantId,
        '| status=' + r.status, '| check-in=' + (r.checkInDate ? new Date(r.checkInDate).toISOString().slice(0,10) : '-'),
        '| phone=' + r.guestPhone, '| clean=' + r.guestPhoneClean,
        '| name=' + (r.guestName || '-')));
    }
  }

  // Active query como o resolveTenantByGuestPhone faz
  console.log('\n--- Como resolveTenantByGuestPhone vê (status not cancelado/no-show) ---');
  for (const p of phones) {
    const r = await db.collection('reservations').findOne(
      { guestPhoneClean: p, status: { $nin: ['cancelado', 'no-show'] } },
      { sort: { checkInDate: -1, createdAt: -1 } }
    );
    if (r) console.log('  ATIVA p=' + p + ':', r.staysReservationId, 'tenant=' + r.tenantId, 'status=' + r.status);
    else console.log('  SEM ATIVA p=' + p);
  }

  await c.close();
})().catch(e => console.error('ERR', e.message));
