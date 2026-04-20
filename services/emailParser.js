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

// Reservation data exclusion patterns
// Lines matching these are metadata, NOT the guest message

const RESERVATION_DATA_PATTERNS = [
  /n[u\u00fa]mero de confirma/i,
  /^check-/i,
  /nome da propriedade/i,
  /total de h[o\u00f3]spedes/i,
  /total de quartos/i,
  /dados da reserva/i,
  /endere[c\u00e7]o/i,
  /pol[i\u00ed]tica de cancelamento/i,
  /pre[c\u00e7]o total/i,
  /condi[c\u00e7][o\u00f5]es/i,
  /responder$/i,
  /ver mensagem/i,
  /^\d{5,}$/,
];

function isReservationData(text) {
  return RESERVATION_DATA_PATTERNS.some((re) => re.test(text.trim()));
}

/**
 * Parse a Booking.com guest message email.
 *
 * Extraction priority (fixed 20/04/2026):
 *   1. fullText regex  — captures text between "disse:" and stop markers
 *   2. <td> iteration  — fallback, with isReservationData() filter
 *   3. plain text       — last resort
 *
 * @param {Object} email - { from, fromName, replyTo, subject, html, text }
 * @returns {Object} Parsed OTA data
 */
function parseBookingEmail(email) {
  const { fromName, replyTo, subject, html, text } = email;
  const $ = html ? cheerio.load(html) : null;

  // 1. Extract guest name from subject
  const nameMatch = subject.match(/mensagem de (.+)/i);
  const guestName = nameMatch ? nameMatch[1].trim() : fromName || 'H\u00f3spede';

  // 2. Extract guest message
  let guestMessage = '';
  let extractionMethod = 'none';

  if ($) {
    const fullText = $.text();

    // PRIMARY: Regex on full text — most reliable
    const disseMatch = fullText.match(
      /disse:\s*([\s\S]*?)(?:Responder|Dados da reserva|Ver mensagem|N[u\u00fa]mero de confirma)/i
    );
    if (disseMatch) {
      const candidate = disseMatch[1].replace(/\s+/g, ' ').trim();
      if (candidate.length > 2 && !isReservationData(candidate)) {
        guestMessage = candidate;
        extractionMethod = 'fullText regex';
      }
    }

    // FALLBACK: <td> iteration with reservation-data filter
    if (!guestMessage) {
      const allTds = $('td');
      let foundDisse = false;
      allTds.each((i, td) => {
        const tdText = $(td).text().trim();
        if (foundDisse && !guestMessage) {
          const cleaned = tdText.replace(/\s+/g, ' ').trim();
          if (
            cleaned.length > 2 &&
            !cleaned.includes('Dados da reserva') &&
            !isReservationData(cleaned)
          ) {
            guestMessage = cleaned;
            extractionMethod = 'td iteration (filtered)';
          }
        }
        if (tdText.includes('disse:')) {
          foundDisse = true;
        }
      });
    }
  }

  // LAST RESORT: Plain text fallback
  if (!guestMessage && text) {
    const textMatch = text.match(
      /disse:\s*([\s\S]*?)(?:Responder|Dados da reserva|Ver mensagem|N[u\u00fa]mero de confirma|--)/i
    );
    if (textMatch) {
      const candidate = textMatch[1].replace(/\s+/g, ' ').trim();
      if (!isReservationData(candidate)) {
        guestMessage = candidate;
        extractionMethod = 'plain text regex';
      }
    }
  }

  console.log(`[emailParser] Extraction method: ${extractionMethod}`);
  console.log(`[emailParser] Extracted message: "${guestMessage}"`);

  // 3. Extract booking number
  const confMatch = (html || text || '').match(/confirma[\u00e7c][\u00e3a]o:\s*(\d+)/i);
  const bookingNumber = confMatch ? confMatch[1] : null;

  // 4. Extract reservation data
  const bodyText = $ ? $.text() : text || '';

  const checkinMatch = bodyText.match(/Check-in:\s*([^\n]+)/i);
  const checkoutMatch = bodyText.match(/Check-out:\s*([^\n]+)/i);
  const propertyMatch = bodyText.match(/Nome da propriedade:\s*([^\n]+)/i);
  const guestsMatch = bodyText.match(/Total de h[o\u00f3]spedes:\s*(\d+)/i);
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

function parseAirbnbEmail(email) {
  console.log('[emailParser] Airbnb parser not yet implemented \u2014 awaiting email sample');
  return {
    ota: 'airbnb',
    guestName: email.fromName || 'H\u00f3spede',
    guestMessage: email.text || '',
    replyTo: email.replyTo,
    bookingNumber: null,
    reservation: {},
    subject: email.subject,
  };
}

function parseExpediaEmail(email) {
  console.log('[emailParser] Expedia parser not yet implemented \u2014 awaiting email sample');
  return {
    ota: 'expedia',
    guestName: email.fromName || 'H\u00f3spede',
    guestMessage: email.text || '',
    replyTo: email.replyTo,
    bookingNumber: null,
    reservation: {},
    subject: email.subject,
  };
}

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
