'use strict';

/**
 * emailParser.js — OTA-specific email parsers
 *
 * Extracts guest message, reservation data, and reply-to address
 * from OTA notification emails (Booking.com, Airbnb, Expedia).
 *
 * Each OTA has its own parser function since email formats differ.
 */

const cheerio = require('cheerio');

// ─────────────────────────────────────────────────────────────────────────────
// Booking.com Parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a Booking.com guest message email.
 *
 * Email structure (confirmed from real email analysis 18/04/2026):
 * - From: "[Name] através do Booking.com" <[booking]-[hash]@guest.booking.com>
 * - Subject: "Recebemos uma mensagem de [Guest Name]"
 * - Reply-To: [booking]-[hash]@guest.booking.com
 * - Body contains: "##- Por favor, escreva sua resposta acima desta linha -##"
 * - Guest message inside: "[Name] disse:" followed by message in <td>
 * - Reservation data: Número de confirmação, Check-in, Check-out, Propriedade, etc.
 *
 * @param {Object} email - { from, fromName, replyTo, subject, html, text }
 * @returns {Object} Parsed OTA data
 */
function parseBookingEmail(email) {
  const { fromName, replyTo, subject, html, text } = email;
  const $ = html ? cheerio.load(html) : null;

  // 1. Extract guest name from subject: "Recebemos uma mensagem de [Name]"
  const nameMatch = subject.match(/mensagem de (.+)/i);
  const guestName = nameMatch ? nameMatch[1].trim() : fromName || 'Hóspede';

  // 2. Extract guest message
  let guestMessage = '';

  if ($) {
    // Method 1: Find the message block after "[Name] disse:"
    const allTds = $('td');
    let foundDisse = false;
    allTds.each((i, td) => {
      const tdText = $(td).text().trim();
      if (foundDisse && !guestMessage) {
        const cleaned = tdText.replace(/\s+/g, ' ').trim();
        if (cleaned.length > 2 && !cleaned.includes('Dados da reserva')) {
          guestMessage = cleaned;
        }
      }
      if (tdText.includes('disse:')) {
        foundDisse = true;
      }
    });

    // Method 2: Fallback
    if (!guestMessage) {
      const fullText = $.text();
      const disseMatch = fullText.match(/disse:\s*([\s\S]*?)(?:Responder|Dados da reserva)/i);
      if (disseMatch) {
        guestMessage = disseMatch[1].replace(/\s+/g, ' ').trim();
      }
    }
  }

  // Method 3: Plain text fallback
  if (!guestMessage && text) {
    const textMatch = text.match(/disse:\s*([\s\S]*?)(?:Responder|Dados da reserva|--)/i);
    if (textMatch) {
      guestMessage = textMatch[1].replace(/\s+/g, ' ').trim();
    }
  }

  // 3. Extract booking number
  const confMatch = (html || text || '').match(/confirma[çc][aã]o:\s*(\d+)/i);
  const bookingNumber = confMatch ? confMatch[1] : null;

  // 4. Extract reservation data
  const bodyText = $ ? $.text() : text || '';

  const checkinMatch = bodyText.match(/Check-in:\s*([^\n]+)/i);
  const checkoutMatch = bodyText.match(/Check-out:\s*([^\n]+)/i);
  const propertyMatch = bodyText.match(/Nome da propriedade:\s*([^\n]+)/i);
  const guestsMatch = bodyText.match(/Total de h[oó]spedes:\s*(\d+)/i);
  const roomsMatch = bodyText.match(/Total de quartos:\s*(\d+)/i);

  return {
    ota: 'booking',
    guestName,
    guestMessage,
    replyTo,
    bookingNumber,
    reservation: {
      checkin: checkinMatch ? checkinMatch[1].trim() : null,
      checkout: checkoutMatch ? checkoutMatch[1].trim() : null,
      property: propertyMatch ? propertyMatch[1].trim() : null,
      guests: guestsMatch ? parseInt(guestsMatch[1]) : null,
      rooms: roomsMatch ? parseInt(roomsMatch[1]) : null,
    },
    subject,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Airbnb Parser (placeholder — awaiting real email sample)
// ─────────────────────────────────────────────────────────────────────────────

function parseAirbnbEmail(email) {
  console.log('[emailParser] Airbnb parser not yet implemented — awaiting email sample');
  return {
    ota: 'airbnb',
    guestName: email.fromName || 'Hóspede',
    guestMessage: email.text || '',
    replyTo: email.replyTo,
    bookingNumber: null,
    reservation: {},
    subject: email.subject,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Expedia Parser (placeholder — awaiting real email sample)
// ─────────────────────────────────────────────────────────────────────────────

function parseExpediaEmail(email) {
  console.log('[emailParser] Expedia parser not yet implemented — awaiting email sample');
  return {
    ota: 'expedia',
    guestName: email.fromName || 'Hóspede',
    guestMessage: email.text || '',
    replyTo: email.replyTo,
    bookingNumber: null,
    reservation: {},
    subject: email.subject,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse an OTA email by routing to the correct parser.
 * @param {string} ota - 'booking', 'airbnb', or 'expedia'
 * @param {Object} email - Raw email data
 * @returns {Object|null} Parsed OTA data
 */
function parseOtaEmail(ota, email) {
  switch (ota) {
    case 'booking':
      return parseBookingEmail(email);
    case 'airbnb':
      return parseAirbnbEmail(email);
    case 'expedia':
      return parseExpediaEmail(email);
    default:
      console.log(`[emailParser] Unknown OTA: ${ota}`);
      return null;
  }
}

module.exports = { parseOtaEmail };
