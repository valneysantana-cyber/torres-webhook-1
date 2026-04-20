'use strict';

/**
 * reservationParser.js — Parse Stays.net reservation notification emails
 *
 * Extracts guest contact info, reservation details, and financial data from
 * Stays.net emails that arrive in the Gmail "Atualizações" (Updates) tab.
 *
 * Email format (from noreply@stays.net):
 *   Subject: "Stays.net | Atualização sobre a Reserva LU02J | Valney Santana"
 *   Body contains:
 *     - Nome do Hóspede: Valney Santana
 *     - Contatos do Hóspede: vsanta.531255@guest.booking.com - +55 11 99907 3135
 *     - Número de Hóspedes: 2
 *     - Período da Estadia: de 01 jul 2026 a 02 jul 2026
 *     - Número de Noites: 1
 *     - Valor Total da Reserva: R$ 519,35
 *     - Acomodação: 404
 *     - Canal de Venda: API booking.com
 *     - Comissão do Canal: R$ 67,52
 *     - Status: reservado
 *
 * Also extracts from the Booking.com-style section (if present in same email thread):
 *     - Número de reserva: 6776863725
 *     - Check-in / Check-out dates
 *     - Nome da propriedade: Hotel em Perdizes - FLAT404 - By TorresGuest
 */

/**
 * Clean phone number for WhatsApp API (digits only, with country code).
 * @param {string} phone - Raw phone like "+55 11 99907 3135" or "11999073135"
 * @returns {string} Clean number like "5511999073135"
 */
function cleanPhone(phone) {
  if (!phone) return null;
  // Remove all non-digits
  let digits = phone.replace(/\D/g, '');
  // Add Brazil country code if missing
  if (digits.length === 11) digits = '55' + digits;
  if (digits.length === 10) digits = '55' + digits; // landline
  return digits.length >= 12 ? digits : null;
}

/**
 * Parse a Stays.net reservation notification email.
 * @param {Object} email - Email data { from, subject, text, html }
 * @returns {Object|null} Parsed reservation data or null if not a Stays.net reservation email
 */
function parseStaysReservationEmail(email) {
  const { subject, text, html } = email;

  // Verify this is a Stays.net reservation email
  if (!subject || !subject.includes('Stays.net')) return null;

  // Use text version preferably, fall back to stripping HTML
  let body = text || '';
  if (!body && html) {
    body = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/td>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .trim();
  }

  if (!body) return null;

  const data = {};

  // ── Extract from Subject ──
  // "Stays.net | Atualização sobre a Reserva LU02J | Valney Santana"
  const subjectMatch = subject.match(/Reserva\s+(\S+)\s*\|\s*(.+)/i);
  if (subjectMatch) {
    data.staysReservationId = subjectMatch[1].trim();
    data.guestName = subjectMatch[2].trim();
  }

  // ── Extract from Body ──

  // Guest name
  const nameMatch = body.match(/Nome\s+do\s+H[oó]spede:\s*(.+)/i);
  if (nameMatch) data.guestName = nameMatch[1].trim();

  // Guest contacts (email + phone on same line)
  // "Contatos do Hóspede: vsanta.531255@guest.booking.com - +55 11 99907 3135"
  const contactMatch = body.match(/Contatos?\s+do\s+H[oó]spede:\s*(.+)/i);
  if (contactMatch) {
    const contactLine = contactMatch[1].trim();

    // Extract email
    const emailMatch = contactLine.match(/([\w.+-]+@[\w.-]+\.\w+)/);
    if (emailMatch) data.guestEmail = emailMatch[1].toLowerCase();

    // Extract phone (after the email, usually separated by " - ")
    const phoneMatch = contactLine.match(/[\s-]+(\+?\d[\d\s()-]{8,})/);
    if (phoneMatch) {
      data.guestPhone = phoneMatch[1].trim();
      data.guestPhoneClean = cleanPhone(phoneMatch[1]);
    }
  }

  // Number of guests
  const guestsMatch = body.match(/N[uú]mero\s+de\s+H[oó]spedes:\s*(\d+)/i);
  if (guestsMatch) data.numGuests = parseInt(guestsMatch[1]);

  // Stay period
  // "Período da Estadia: de 01 jul 2026 a 02 jul 2026"
  const periodMatch = body.match(/Per[ií]odo\s+da\s+Estadia:\s*de\s+(.+?)\s+a\s+(.+?)(?:\n|$)/i);
  if (periodMatch) {
    data.checkin = periodMatch[1].trim();
    data.checkout = periodMatch[2].trim();
  }

  // Number of nights
  const nightsMatch = body.match(/N[uú]mero\s+de\s+Noites?:\s*(\d+)/i);
  if (nightsMatch) data.numNights = parseInt(nightsMatch[1]);

  // Total value
  const valueMatch = body.match(/Valor\s+Total\s+da\s+Reserva:\s*(R\$\s*[\d.,]+)/i);
  if (valueMatch) data.totalValue = valueMatch[1].trim();

  // Accommodation
  const accomMatch = body.match(/Acomoda[çc][ãa]o:\s*(.+?)(?:\n|$)/i);
  if (accomMatch) data.accommodation = accomMatch[1].trim();

  // Sales channel
  const channelMatch = body.match(/Canal\s+de\s+Venda:\s*(.+?)(?:\n|$)/i);
  if (channelMatch) {
    data.channel = channelMatch[1].trim();
    // Detect OTA from channel
    const ch = data.channel.toLowerCase();
    if (ch.includes('booking')) data.ota = 'booking';
    else if (ch.includes('airbnb')) data.ota = 'airbnb';
    else if (ch.includes('expedia')) data.ota = 'expedia';
    else data.ota = 'direct';
  }

  // Commission
  const commMatch = body.match(/Comiss[ãa]o\s+do\s+Canal:\s*(R\$\s*[\d.,]+)/i);
  if (commMatch) data.commission = commMatch[1].trim();

  // Status ("reservado", "confirmado", etc.)
  const statusMatch = body.match(/status\s+(\w+)\s+atualmente/i);
  if (statusMatch) data.status = statusMatch[1].toLowerCase();

  // ── Extract from Booking.com section (if present in the same email thread) ──

  // Booking number: 6776863725
  const bookingNumMatch = body.match(/N[uú]mero\s+da\s+reserva:\s*(\d+)/i);
  if (bookingNumMatch) data.bookingNumber = bookingNumMatch[1];

  // Property name
  const propMatch = body.match(/Nome\s+da\s+propriedade:\s*(.+?)(?:\n|$)/i);
  if (propMatch) data.property = propMatch[1].trim();

  // Check-in / Check-out from Booking.com section (more precise dates)
  // "Check-in: qua., 1 de jul. de 2026"
  const checkinBooking = body.match(/Check-in:\s*(?:\w+\.\s*,?\s*)?(\d+\s+de\s+\w+\.?\s+de\s+\d{4})/i);
  if (checkinBooking && !data.checkin) data.checkin = checkinBooking[1].trim();

  const checkoutBooking = body.match(/Check-out:\s*(?:\w+\.\s*,?\s*)?(\d+\s+de\s+\w+\.?\s+de\s+\d{4})/i);
  if (checkoutBooking && !data.checkout) data.checkout = checkoutBooking[1].trim();

  // Total guests from Booking section
  const totalGuestsBooking = body.match(/Total\s+de\s+h[oó]spedes:\s*(\d+)/i);
  if (totalGuestsBooking) data.numGuests = parseInt(totalGuestsBooking[1]);

  // Total rooms
  const totalRooms = body.match(/Total\s+de\s+quartos?:\s*(\d+)/i);
  if (totalRooms) data.numRooms = parseInt(totalRooms[1]);

  // Validate: at minimum we need a guest name
  if (!data.guestName) return null;

  console.log('[reservation] Parsed Stays.net data:', {
    guest: data.guestName,
    phone: data.guestPhoneClean,
    email: data.guestEmail,
    booking: data.bookingNumber,
    staysId: data.staysReservationId,
    checkin: data.checkin,
    checkout: data.checkout,
    property: data.property,
    ota: data.ota,
  });

  return data;
}

/**
 * Check if an email is from Stays.net notification system.
 * @param {string} fromAddress - Sender email address
 * @returns {boolean}
 */
function isStaysEmail(fromAddress) {
  if (!fromAddress) return false;
  const addr = fromAddress.toLowerCase();
  return addr.includes('@stays.net') || addr.includes('stays.net');
}

module.exports = { parseStaysReservationEmail, isStaysEmail, cleanPhone };
