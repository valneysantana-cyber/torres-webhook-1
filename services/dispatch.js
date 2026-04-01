'use strict';

/**
 * dailyCheckinDispatch
 *
 * Sends a WhatsApp summary of ALL active guests to the operations number.
 * Two sections:
 *   - 🛬 Check-ins de hoje
 *   - 🏨 Em estadia (mid-stay: arrived before today, checkout ≥ today)
 *
 * Trigger via cron — NOT on server boot.
 *
 * Fixes vs original monolith:
 *  - resolveGuestName() with full reservation details (no more N/A)
 *  - listingsMap to resolve _idlisting → apartment name (no more MongoDB IDs)
 *  - mid-stay guests included
 */

const { DISPATCH_NUMBER }                    = require('../config');
const { getCurrentDateBRT, resolveGuestName } = require('../utils/formatters');
const { fetchTodayAllActiveGuests }          = require('./stays');
const { sendWhatsAppText }                   = require('./whatsapp');

function resolveApartmentName(r, listingsMap) {
  const nested = r.listing || r.unit || r.accommodation || {};
  const fromNested = nested.internalName || nested.nickname || nested.name || nested.title || nested.unitNumber;
  if (fromNested) return fromNested;
  const idListing = String(r._idlisting || '');
  if (idListing && listingsMap.has(idListing)) return listingsMap.get(idListing);

  return idListing ? `#${idListing.slice(-6)}` : 'N/A';
}

async function dailyCheckinDispatch() {
  const { arrivals, midStay, listingsMap } = await fetchTodayAllActiveGuests();
  const today = getCurrentDateBRT();
  const lines = [`\ud83d\udccb H\u00f3spedes ativos \u2014 ${today}\n`];

  // ---- check-ins de hoje -----------------------------------------------
  if (arrivals.length > 0) {
    lines.push(`\ud83d\udeec Check-ins de hoje (${arrivals.length}):`);
    arrivals.forEach((r, i) => {
      const guest  = resolveGuestName(r) || r.agent?.name || 'N/A';
      const apt    = resolveApartmentName(r, listingsMap);
      const statusRaw = (r.type || r.status || r.bookingStatus || '').toLowerCase();
      const statusMap = { booked: 'Reservado', confirmed: 'Confirmado', inquiry: 'Consulta', canceled: 'Cancelado' };
      const status = statusMap[statusRaw] || statusRaw || 'N/A';
      const checkout = (r.checkOutDate || r.checkout || '').split('T')[0] || 'N/A';
      lines.push(`${i + 1}. ${guest} \u2014 Flat ${apt} \u2014 ${status} \u2014 sa\u00edda ${checkout}`);
    });
  } else {
    lines.push('\ud83d\udeec Nenhum check-in hoje.');
  }

  // ---- mid-stay ----------------------------------------------------------
  if (midStay.length > 0) {
    lines.push(`\n\ud83c\udfe8 Em estadia (${midStay.length} h\u00f3spede(s) j\u00e1 hospedado(s)):`);
    midStay.forEach((r, i) => {
      const guest    = resolveGuestName(r) || r.agent?.name || 'N/A';
      const apt      = resolveApartmentName(r, listingsMap);
      const checkout = (r.checkOutDate || r.checkout || '').split('T')[0] || 'N/A';
      lines.push(`${i + 1}. ${guest} \u2014 Flat ${apt} \u2014 sa\u00edda ${checkout}`);
    });
  }

  const mensagem = lines.join('\n');
  console.log('[dispatch] mensagem:\n', mensagem);

  try {
    await sendWhatsAppText(DISPATCH_NUMBER, mensagem);
    console.log('[dispatch] Mensagem de h\u00f3spedes ativos enviada com sucesso!');
  } catch (err) {
    console.error('[dispatch] Erro ao enviar mensagem via WhatsApp:', err);
  }
}

module.exports = { dailyCheckinDispatch };
