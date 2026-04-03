'use strict';

// Resolve _idlisting (MongoDB ObjectId) → nome do apartamento via env var
const _LISTING_NAMES = (() => {
  try { return JSON.parse(process.env.LISTING_NAMES_JSON || '{}'); }
  catch (e) { return {}; }
})();

function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^0-9a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDateBRT(dateStr) {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  }
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function getCurrentDateBRT() {
  return new Date().toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  });
}

function getCurrentTimeBRT() {
  return new Date().toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getCurrentISODateBRT() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
  }).format(new Date());
}

/**
 * Resolves the primary guest name from a Stays.net reservation object.
 *
 * The list endpoint returns only IDs (_idclient, _idlisting).
 * Full details (via /booking/reservations/:id) populate client.name.
 *
 * Field priority:
 *  1. client.name          ← present in full-detail response
 *  2. guest_name           ← some channels populate this
 *  3. guestsDetails.list   ← array with name/primary flags
 *  4. guests (array)       ← alternative guests array
 *  5. contact.name         ← contact info block
 *  6. agent.name           ← last resort (usually property manager name)
 */
function resolveGuestName(reservation) {
  // 1. Nested client object (from full-detail endpoint)
  if (reservation.client?.name) return reservation.client.name;

  // 2. Flat guest_name field
  if (reservation.guest_name) return reservation.guest_name;

  // 3+4. Guest arrays
  const lists = [
    reservation.guestsDetails?.list,
    reservation.guests?.list,
    Array.isArray(reservation.guests) ? reservation.guests : null,
  ];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    const primary =
      list.find((item) => item?.primary) ||
      list.find(
        (item) =>
          item?.name && !item.name.toLowerCase().startsWith('adult_')
      ) ||
      list[0];
    if (primary?.name) return primary.name;
  }

  // 5. Contact block
  if (reservation.contact?.name) return reservation.contact.name;

  // 6. Agent name (last resort — usually the property manager, shown when
  //    no guest data is available, e.g. direct owner blocks)
  if (reservation.agent?.name) return reservation.agent.name;

  return null;
}

function formatReservationStatus(type) {
  const mapping = {
    booked:      'confirmada \u2705',
    reserved:    'pendente de confirma\u00e7\u00e3o',
    contract:    'em contrato',
    canceled:    'cancelada \u274c',
    maintenance: 'bloqueada para manuten\u00e7\u00e3o',
    blocked:     'bloqueada',
  };
  return mapping[type] || 'em andamento';
}

function formatReservationMessage(reservation) {
  const guest   = resolveGuestName(reservation);
  const listing =
    reservation.listing?.internalName ||
    reservation.listing?.name ||
    _LISTING_NAMES[String(reservation._idlisting || '')] ||
    reservation.listing?.id ||
    String(reservation._idlisting || '');
  const partner  = reservation.partnerName || reservation.partner?.name || 'canal direto';
  const status   = formatReservationStatus(reservation.type);
  const checkin  = formatDateBRT(reservation.checkInDate || reservation.checkin);
  const checkout = formatDateBRT(reservation.checkOutDate || reservation.checkout);
  const guests   = reservation.guestTotalCount || reservation.persons || 1;
  const nights   = reservation.nightCount || reservation.nights || '';

  const parts = [
    `Confirmei aqui: a reserva ${reservation.id} (${partner}) est\u00e1 ${status}.`,
    guest ? `H\u00f3spede: ${guest}.` : '',
    checkin && checkout
      ? `Per\u00edodo: ${checkin} at\u00e9 ${checkout}${nights ? ` \u00b7 ${nights} noite(s)` : ''}.`
      : '',
    guests
      ? `${guests} h\u00f3spede(s)${listing ? ` \u00b7 Flat ${listing}` : ''}.`
      : listing ? `Flat ${listing}.` : '',
    'Qualquer ajuste, me avisa que eu cuido por aqui. \ud83c\udf34',
  ].filter(Boolean);

  return parts.join('\n');
}

function shortenForAudio(text) {
  if (!text) return text;
  return text
    .replace(/\n+/g, ' ')
    .replace(/\.\s+/g, '. ')
    .replace(/:\s+/g, ', ')
    .replace('Se quiser voltar ao menu, \u00e9 s\u00f3 digitar "menu".', '')
    .replace(
      'Qualquer coisa que precisar, estou por aqui para te ajudar. \ud83c\udf34',
      'Qualquer coisa, estou por aqui.'
    )
    .trim();
}

module.exports = {
  normalizeText,
  formatDateBRT,
  getCurrentDateBRT,
  getCurrentTimeBRT,
  getCurrentISODateBRT,
  resolveGuestName,
  formatReservationStatus,
  formatReservationMessage,
  shortenForAudio,
};
