'use strict';

/**
 * dailyCheckinDispatch
 *
 * Sends a WhatsApp summary of ALL active guests to the operations number.
 * Two sections:
 * - 🛬 Check-ins de hoje
 * - 🏨 Em estadia (mid-stay: arrived before today, checkout >= today)
 *
 * Trigger via cron — NOT on server boot.
 */
const { DISPATCH_NUMBER } = require('../config');
const { getCurrentDateBRT, resolveGuestName } = require('../utils/formatters');
const { fetchTodayAllActiveGuests } = require('./stays');
const { sendWhatsAppText } = require('./whatsapp');

function resolveApartmentName(r, listingsMap) {
  const nested = r.listing || r.unit || r.accommodation || {};
  const fromNested = nested.internalName || nested.nickname || nested.name || nested.title || nested.unitNumber;
  if (fromNested) return fromNested;
  const idListing = String(r._idlisting || '');
  if (idListing && listingsMap.has(idListing)) return listingsMap.get(idListing);
  return idListing ? `#${idListing.slice(-6)}` : 'N/A';
}

function fmtDate(iso) {
  if (!iso || iso.length < 10) return iso || 'N/A';
  return `${iso.slice(8,10)}/${iso.slice(5,7)}/${iso.slice(0,4)}`;
}

async function dailyCheckinDispatch() {
  const { arrivals, midStay, listingsMap } = await fetchTodayAllActiveGuests();
  const today = getCurrentDateBRT();
  const lines = [`📋 Hóspedes ativos — ${today}\n`];

  // ---- check-ins de hoje -----------------------------------------------
  if (arrivals.length > 0) {
    lines.push(`🛬 Check-ins de hoje (${arrivals.length}):`);
    arrivals.forEach((r, i) => {
      const guest = resolveGuestName(r) || r.agent?.name || 'N/A';
      const apt = resolveApartmentName(r, listingsMap);
      const statusRaw = (r.type || r.status || r.bookingStatus || '').toLowerCase();
      const statusMap = { booked: 'Reservado', confirmed: 'Confirmado', inquiry: 'Consulta', canceled: 'Cancelado' };
      const status = statusMap[statusRaw] || statusRaw || 'N/A';
      const checkout = (r.checkOutDate || r.checkout || '').split('T')[0] || 'N/A';
      const numGuests = r.guests || r.guestsDetails?.adults || r.guestsCount || r.numberOfGuests || 1;
      const guestLabel = `${numGuests} hóspede${numGuests > 1 ? 's' : ''}`;
      lines.push(`${i + 1}. ${guest} — Flat ${apt} — ${guestLabel} — ${status} — saída ${fmtDate(checkout)}`);
    });
  } else {
    lines.push('🛬 Nenhum check-in hoje.');
  }

  // ---- mid-stay ----------------------------------------------------------
  if (midStay.length > 0) {
    lines.push(`\n🏨 Em estadia (${midStay.length} hóspede(s) já hospedado(s)):`);
    midStay.forEach((r, i) => {
      const guest = resolveGuestName(r) || r.agent?.name || 'N/A';
      const apt = resolveApartmentName(r, listingsMap);
      const checkout = (r.checkOutDate || r.checkout || '').split('T')[0] || 'N/A';
      const numGuests = r.guests || r.guestsDetails?.adults || r.guestsCount || r.numberOfGuests || 1;
      const guestLabel = `${numGuests} hóspede${numGuests > 1 ? 's' : ''}`;
      lines.push(`${i + 1}. ${guest} — Flat ${apt} — ${guestLabel} — saída ${fmtDate(checkout)}`);
    });
  }

  const mensagem = lines.join('\n');
  console.log('[dispatch] mensagem:\n', mensagem);

  try {
    const dispatchNumbers = DISPATCH_NUMBER.split(',').map(n => n.trim()).filter(Boolean);
    for (const num of dispatchNumbers) {
      await sendWhatsAppText(num, mensagem);
    }
    console.log('[dispatch] Mensagem de hóspedes ativos enviada com sucesso!');
  } catch (err) {
    console.error('[dispatch] Erro ao enviar mensagem via WhatsApp:', err);
  }
}

// ---------------------------------------------------------------------------
// sendEscalationAlert
// Envia alerta para todos os números de dispatch quando hóspede precisa de
// atendimento humano (manutenção, financeiro, itens físicos, etc.)
// ---------------------------------------------------------------------------
async function sendEscalationAlert(guestPhone, originalMessage, classification) {
  const { level, emoji, name } = classification;
  const mensagem = [
    `${emoji} *TorresGuest — ALERTA ${level}*`,
    ``,
    `📱 *Hóspede:* +${guestPhone}`,
    `📋 *Categoria:* ${name}`,
    ``,
    `💬 *Mensagem do hóspede:*`,
    `"${originalMessage}"`,
    ``,
    `👉 Por favor, entre em contato com o hóspede.`,
  ].join('\n');

  try {
    const dispatchNumbers = DISPATCH_NUMBER.split(',').map(n => n.trim()).filter(Boolean);
    for (const num of dispatchNumbers) {
      await sendWhatsAppText(num, mensagem);
    }
    console.log(`[dispatch] Alerta enviado para ${dispatchNumbers.length} número(s): ${name} [${level}]`);
  } catch (err) {
    console.error('[dispatch] Erro ao enviar alerta de escalação:', err);
  }
}

module.exports = { dailyCheckinDispatch, sendEscalationAlert };
