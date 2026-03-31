'use strict';

/**
 * dailyCheckinDispatch
 *
 * Sends a WhatsApp summary of ALL active guests to the operations number:
 *   - Section 1: today's check-ins
 *   - Section 2: mid-stay guests (arrived before today, checkout >= today)
 *
 * Call this from a cron job or scheduled trigger — NOT on server boot.
 *
 * Fixed bugs vs original:
 *  - Uses resolveGuestName() instead of fragile inline property chain
 *  - Uses listing.internalName instead of raw _idlisting (MongoDB ObjectID)
 *  - Includes mid-stay guests (the original only showed today's arrivals)
 */

const { DISPATCH_NUMBER } = require('../config');
const { getCurrentDateBRT, resolveGuestName } = require('../utils/formatters');
const { fetchTodayAllActiveGuests } = require('./stays');
const { sendWhatsAppText } = require('./whatsapp');

async function dailyCheckinDispatch() {
  const { arrivals, midStay } = await fetchTodayAllActiveGuests();
  const today = getCurrentDateBRT();
  const lines = [`\ud83d\udccb H\u00f3spedes ativos \u2014 ${today}\n`];

  if (arrivals.length > 0) {
    lines.push(`\ud83d\udeec Check-ins de hoje (${arrivals.length}):`);
    arrivals.forEach((r, i) => {
      const guest  = resolveGuestName(r) || 'N/A';
      const apt    = r.listing?.internalName || r.listing?.name || String(r._idlisting || 'N/A');
      const status = r.type || r.status || r.bookingStatus || 'N/A';
      lines.push(`${i + 1}. ${guest} \u2014 Flat ${apt} \u2014 ${status}`);
    });
  } else {
    lines.push('\ud83d\udeec Nenhum check-in hoje.');
  }

  if (midStay.length > 0) {
    lines.push(`\n\ud83c\udfe8 Em estadia (${midStay.length} h\u00f3spede(s) j\u00e1 hospedado(s)):`);
    midStay.forEach((r, i) => {
      const guest    = resolveGuestName(r) || 'N/A';
      const apt      = r.listing?.internalName || r.listing?.name || String(r._idlisting || 'N/A');
      const checkout = (r.checkOutDate || r.checkout || '').split('T')[0] || 'N/A';
      lines.push(`${i + 1}. ${guest} \u2014 Flat ${apt} \u2014 sa\u00edda ${checkout}`);
    });
  }

  const mensagem = lines.join('\n');

  try {
    await sendWhatsAppText(DISPATCH_NUMBER, mensagem);
    console.log('[dispatch] Mensagem de h\u00f3spedes ativos enviada com sucesso!');
  } catch (err) {
    console.error('[dispatch] Erro ao enviar mensagem via WhatsApp:', err);
  }
}

module.exports = { dailyCheckinDispatch };
