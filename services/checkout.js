'use strict';

const { fetchYesterdayCheckoutReservations, fetchListingsMap } = require('./stays');
const { registerCheckout } = require('./crm');

function normalizePhone(raw) {
  return (raw || '').replace(/\D/g, '');
}

async function dailyCheckoutSync() {
  console.log('[checkout] Iniciando sincronização pós-checkout...');
  let checkouts, listingsMap;
  try {
    [checkouts, listingsMap] = await Promise.all([
      fetchYesterdayCheckoutReservations(),
      fetchListingsMap(),
    ]);
  } catch (err) {
    console.error('[checkout] Erro ao buscar checkouts:', err.message);
    return;
  }

  if (!checkouts || !checkouts.length) {
    console.log('[checkout] Nenhum checkout ontem.');
    return;
  }

  console.log(`[checkout] ${checkouts.length} checkout(s) para processar.`);

  for (const r of checkouts) {
    const gd = Array.isArray(r.guestsDetails) ? r.guestsDetails : [];

    // Busca hóspede principal com telefone
    const primaryGuest =
      gd.find(g => g.primary && Array.isArray(g.phones) && g.phones.length > 0) ||
      gd.find(g => Array.isArray(g.phones) && g.phones.length > 0);

    if (!primaryGuest) {
      console.log(`[checkout] Reserva sem telefone: ${r._id}`);
      continue;
    }

    const rawPhone = primaryGuest.phones[0]?.iso || '';
    const phone = normalizePhone(rawPhone);

    if (phone.length < 8) {
      console.log(`[checkout] Telefone inválido (${rawPhone}) na reserva ${r._id}`);
      continue;
    }

    const checkIn = new Date(r.checkInDate);
    const checkOut = new Date(r.checkOutDate);
    const nights = Math.round((checkOut - checkIn) / 86400000) || 1;

    const apartment = (listingsMap && listingsMap.get(r._idlisting)) || r._idlisting || '?';
    const name = primaryGuest.name || primaryGuest._idcontact || 'Hóspede';

    try {
      await registerCheckout(phone, { nights, name, apartment });
      console.log(`[checkout] Registrado: ${name} (${phone}) | ${apartment} | ${nights} noite(s)`);
    } catch (err) {
      console.error(`[checkout] Erro ao registrar ${phone}:`, err.message);
    }
  }

  console.log('[checkout] Sincronização concluída.');
}

module.exports = { dailyCheckoutSync };
