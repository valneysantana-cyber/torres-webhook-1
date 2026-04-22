'use strict';

/**
 * emailMonitor.js â IMAP listener for OTA guest emails + Stays.net reservations
 *
 * Connects to Gmail via IMAP (imapflow), polls for new emails from OTAs
 * (Booking.com, Airbnb, Expedia), and routes them to the parser + responder.
 *
 * ALSO monitors Stays.net reservation notification emails (Gmail "AtualizaÃ§Ãµes" tab)
 * to extract guest contact data (phone, email, dates) and store in MongoDB.
 *
 * Reuses the SAME response rules as WhatsApp (responses/strings.js + utils/matchers.js).
 */

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { parseOtaEmail } = require('./emailParser');
const { handleEmailResponse } = require('./emailResponder');

// ââ Stays.net reservation parsing + MongoDB storage ââ
const { isStaysEmail, parseStaysReservationEmail } = require('./reservationParser');
const { isDBConnected } = require('./db');
let Reservation;
try {
  Reservation = require('../models/Reservation');
} catch (e) {
  console.warn('[email] Reservation model not available:', e.message);
}

const {
  GMAIL_IMAP_USER,
  GMAIL_IMAP_PASSWORD,
  EMAIL_MONITOR_ENABLED,
} = require('../config');

// Domains we recognize as OTA relay emails
const OTA_DOMAINS = [
  'guest.booking.com',      // Booking.com relay
  'airbnb.com',             // Airbnb (TBD â awaiting sample)
  'expedia.com',            // Expedia (TBD â awaiting sample)
  'messages.airbnb.com',    // Airbnb alternate
];

// Track processed message IDs to avoid duplicates
const processedMessageIds = new Set();
const MAX_PROCESSED_CACHE = 500;

/**
 * Classify OTA source from the sender email domain.
 * @param {string} fromAddress - The From email address
 * @returns {string|null} - 'booking', 'airbnb', 'expedia', or null
 */
function classifyOta(fromAddress) {
  if (!fromAddress) return null;
  const addr = fromAddress.toLowerCase();
  if (addr.includes('@guest.booking.com')) return 'booking';
  if (addr.includes('@airbnb.com') || addr.includes('@messages.airbnb.com')) return 'airbnb';
  if (addr.includes('@expedia.com')) return 'expedia';
  return null;
}

/**
 * Process a Stays.net reservation notification email.
 * Extracts guest data and stores/updates in MongoDB.
 * @param {Object} parsed - Parsed email from mailparser
 */
async function processStaysEmail(parsed) {
  const subject = parsed.subject || '';
  const text = parsed.text || '';
  const html = parsed.html || '';

  console.log('[email] Processing Stays.net reservation email:', subject);

  const reservationData = parseStaysReservationEmail({ subject, text, html });

  if (!reservationData) {
    console.log('[email] Could not parse Stays.net reservation data');
    return;
  }

  console.log('[email] Stays.net reservation parsed:', {
    guest: reservationData.guestName,
    phone: reservationData.guestPhoneClean,
    email: reservationData.guestEmail,
    booking: reservationData.bookingNumber,
    staysId: reservationData.staysReservationId,
    checkin: reservationData.checkin,
    checkout: reservationData.checkout,
    accommodation: reservationData.accommodation,
    totalValue: reservationData.totalValue,
  });

  // Save to MongoDB
  if (Reservation && isDBConnected()) {
    try {
      const saved = await Reservation.upsertReservation(reservationData);
      console.log('[email] â Reservation saved to MongoDB:', saved._id);
    } catch (err) {
      console.error('[email] â Failed to save reservation to MongoDB:', err.message);
    }
  } else {
    console.log('[email] MongoDB not available â reservation data NOT persisted');
    console.log('[email] Reservation data (in-memory):', JSON.stringify(reservationData, null, 2));
  }
}

/**
 * Process a single email message.
 * Routes to either Stays.net handler or OTA guest message handler.
 * @param {Object} parsed - Parsed email from mailparser
 */
async function processEmail(parsed) {
  const messageId = parsed.messageId;

  // Deduplicate by Message-ID
  if (processedMessageIds.has(messageId)) {
    console.log('[email] Skipping duplicate:', messageId);
    return;
  }
  processedMessageIds.add(messageId);
  if (processedMessageIds.size > MAX_PROCESSED_CACHE) {
    const first = processedMessageIds.values().next().value;
    processedMessageIds.delete(first);
  }

  // Get sender address
  const fromAddress = parsed.from?.value?.[0]?.address || '';
  const fromName = parsed.from?.value?.[0]?.name || '';
  const replyTo = parsed.replyTo?.value?.[0]?.address || fromAddress;
  const subject = parsed.subject || '';

  console.log('[email] New message:', { from: fromAddress, subject, replyTo });

  // ââ Route 1: Stays.net reservation notification ââ
  if (isStaysEmail(fromAddress)) {
    console.log('[email] Stays.net email detected â routing to reservation parser');
    await processStaysEmail(parsed);
    return; // Don't process as OTA guest message
  }

  // ââ Route 2: OTA guest message (Booking, Airbnb, Expedia) ââ
  const ota = classifyOta(fromAddress);
  if (!ota) {
    console.log('[email] Not an OTA or Stays.net email, skipping:', fromAddress);
    return;
  }

  console.log(`[email] OTA detected: ${ota}`);

  // Parse the email content (extract guest message, reservation data, etc.)
  const otaData = parseOtaEmail(ota, {
    from: fromAddress,
    fromName,
    replyTo,
    subject,
    html: parsed.html || '',
    text: parsed.text || '',
  });

  if (!otaData || !otaData.guestMessage) {
    console.log('[email] Could not extract guest message from OTA email');
    return;
  }

  console.log('[email] Parsed OTA data:', {
    ota: otaData.ota,
    guestName: otaData.guestName,
    guestMessage: otaData.guestMessage.substring(0, 100),
    bookingNumber: otaData.bookingNumber,
    replyTo: otaData.replyTo,
  });

  // ââ Enrich OTA data with reservation info from MongoDB ââ
  if (Reservation && isDBConnected()) {
    try {
      let reservation = null;

      // Try lookup by guest email first (most reliable for Booking.com relay emails)
      if (otaData.replyTo) {
        reservation = await Reservation.findByGuestEmail(otaData.replyTo);
      }
      // Fallback: lookup by guest name
      if (!reservation && otaData.guestName) {
        reservation = await Reservation.findByGuestName(otaData.guestName);
      }
      // Fallback: lookup by booking number
      if (!reservation && otaData.bookingNumber) {
        reservation = await Reservation.findByBookingNumber(otaData.bookingNumber);
      }

      if (reservation) {
        console.log('[email] â Reservation found in MongoDB:', {
          guest: reservation.guestName,
          phone: reservation.guestPhoneClean,
          checkin: reservation.checkin,
          checkout: reservation.checkout,
          property: reservation.property,
        });
        // Attach reservation data to otaData for use in responder
        otaData.reservation = reservation;
      } else {
        console.log('[email] No reservation found in MongoDB for this guest');
      }
    } catch (err) {
      console.error('[email] Error looking up reservation:', err.message);
    }
  }

  // Attach original email threading data for proper reply headers
  otaData.originalMessageId = parsed.messageId || null;
  otaData.originalSubject = parsed.subject || '';

  // Route to responder (same rules as WhatsApp!)
  await handleEmailResponse(otaData);
}

/**
 * Start the IMAP email monitor.
 * Uses IMAP IDLE for real-time notifications with polling fallback.
 */
async function startEmailMonitor() {
  if (EMAIL_MONITOR_ENABLED !== 'true') {
    console.log('[email] Email monitor DISABLED (EMAIL_MONITOR_ENABLED != true)');
    return;
  }

  if (!GMAIL_IMAP_USER || !GMAIL_IMAP_PASSWORD) {
    console.error('[email] Missing GMAIL_IMAP_USER or GMAIL_IMAP_PASSWORD');
    return;
  }

  console.log(`[email] Starting IMAP monitor for ${GMAIL_IMAP_USER}...`);

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: GMAIL_IMAP_USER,
      pass: GMAIL_IMAP_PASSWORD,
    },
    logger: false, // Quiet logging in production
  });

  try {
    await client.connect();
    console.log('[email] IMAP connected successfully');

    // Open INBOX
    const mailbox = await client.mailboxOpen('INBOX');
    console.log(`[email] INBOX opened â ${mailbox.exists} messages`);

    // Track the polling timer so we can cancel it on disconnect
    let pollingTimer = null;

    // Process new emails function
    async function checkNewEmails() {
      if (!client.usable) {
        // Connection dropped — stop polling; the 'close' handler will reconnect
        if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; }
        return;
      }
      try {
        // Search for UNSEEN messages
        const uids = await client.search({ seen: false });
        if (!uids.length) return;

        console.log(`[email] Found ${uids.length} unseen message(s)`);

        for (const uid of uids) {
          try {
            const raw = await client.download(uid.toString(), undefined, { uid: true });
            if (!raw?.content) continue;

            // Collect stream chunks
            const chunks = [];
            for await (const chunk of raw.content) {
              chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);
            const parsed = await simpleParser(buffer);

            // Process OTA emails AND Stays.net reservation emails
            const fromAddress = parsed.from?.value?.[0]?.address || '';
            if (classifyOta(fromAddress) || isStaysEmail(fromAddress)) {
              await processEmail(parsed);
              // Mark as seen after processing
              await client.messageFlagsAdd(uid.toString(), ['\\Seen'], { uid: true });
            }
          } catch (err) {
            console.error('[email] Error processing message:', err.message);
          }
        }
      } catch (err) {
        console.error('[email] Error checking new emails:', err.message);
      }
    }

    // Initial check
    await checkNewEmails();

    // Listen for new messages via IDLE
    client.on('exists', async (data) => {
      console.log(`[email] New message notification (exists: ${data.count})`);
      await checkNewEmails();
    });

    // Keep connection alive with periodic polling (fallback for IDLE issues)
    pollingTimer = setInterval(async () => {
      try {
        await checkNewEmails();
      } catch (err) {
        console.error('[email] Polling error:', err.message);
      }
    }, 60_000); // Check every 60 seconds

    // Handle disconnects with auto-reconnect
    client.on('close', () => {
      if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; }
      console.log('[email] IMAP connection closed, reconnecting in 30s...');
      setTimeout(() => startEmailMonitor(), 30_000);
    });

    client.on('error', (err) => {
      console.error('[email] IMAP error:', err.message);
    });

  } catch (err) {
    console.error('[email] Failed to start IMAP monitor:', err.message);
    console.log('[email] Retrying in 60 seconds...');
    setTimeout(() => startEmailMonitor(), 60_000);
  }
}

module.exports = { startEmailMonitor };
