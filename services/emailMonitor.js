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
const { sendCheckinTemplate, sendWelcomeKit } = require('./whatsapp');

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
  let saved = null;
  if (Reservation && isDBConnected()) {
    try {
      saved = await Reservation.upsertReservation(reservationData);
      console.log('[email] Reservation saved to MongoDB:', saved._id);
    } catch (err) {
      console.error('[email] Failed to save reservation to MongoDB:', err.message);
    }
  } else {
    console.log('[email] MongoDB not available — reservation data NOT persisted');
    console.log('[email] Reservation data (in-memory):', JSON.stringify(reservationData, null, 2));
  }

  // Auto-send check-in template via WhatsApp (realtime, beats the VPS cron)
  await maybeSendCheckinTemplate(saved, reservationData);
}

/**
 * Send the pre-checkin WhatsApp template when we captured a real phone from a
 * Stays reservation email — but only if:
 *   1. phone is present and cleaned (not a placeholder / OTA proxy)
 *   2. check-in is still in the future
 *   3. we haven't already auto-sent for this reservation (autoCheckinSentAt null)
 *   4. WA_CHECKIN_AUTO_SEND env flag is enabled
 *
 * Marks autoCheckinSentAt on success so the VPS stays_sync doesn't duplicate.
 */
async function maybeSendCheckinTemplate(saved, reservationData) {
  if (process.env.WA_CHECKIN_AUTO_SEND !== 'true') return;
  if (!saved) return;
  if (saved.autoCheckinSentAt) {
    console.log('[email][autosend] already sent previously, skipping');
    return;
  }
  const phone = saved.guestPhoneClean || reservationData.guestPhoneClean;
  if (!phone || phone.length < 12) {
    console.log('[email][autosend] no real phone yet, skipping');
    return;
  }
  try {
    const ci = new Date(saved.checkin || reservationData.checkin);
    if (!isNaN(ci) && ci.getTime() < Date.now() - 24 * 3600 * 1000) {
      console.log('[email][autosend] check-in already past, skipping');
      return;
    }
  } catch {}

  const firstName   = (saved.guestName || '').split(' ')[0] || 'Hospede';
  const listingName = saved.accommodation || saved.property || '-';
  const staysId     = saved.staysReservationId || reservationData.staysReservationId || '';
  const checkInDate = saved.checkin || reservationData.checkin;

  console.log(`[email][autosend] sending checkin template to ${firstName} (${phone})`);
  const result = await sendCheckinTemplate(phone, firstName, listingName, checkInDate, staysId);
  if (!result.ok) {
    if (result.skipped) console.log('[email][autosend] skipped:', result.reason);
    else console.error('[email][autosend] FAIL:', JSON.stringify(result.error).slice(0, 300));
    return;
  }
  saved.autoCheckinSentAt = new Date();
  try { await saved.save(); } catch (e) { console.warn('[email][autosend] save flag failed:', e.message); }
  console.log(`[email][autosend] template OK (${result.variant || 'v1'}) messageId=${result.messageId}`);

  // Welcome kit: long free-text with services, house rules, 24/7 concierge.
  // The template just opened the service window, so the free-text is delivered
  // in the same thread (no filtering risk).
  await new Promise(res => setTimeout(res, 1500));
  const welcome = await sendWelcomeKit(phone, {
    firstName,
    listingName: saved.property || listingName,
    checkInDate: saved.checkin || reservationData.checkin,
    nights: saved.numNights,
    totalValue: saved.totalValue,
  });
  if (welcome.ok) {
    console.log(`[email][autosend] welcome kit OK messageId=${welcome.messageId}`);
  } else if (!welcome.skipped) {
    console.error('[email][autosend] welcome kit FAIL:', JSON.stringify(welcome.error).slice(0, 300));
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
    // Gmail filters often route incoming mail straight to user-defined labels,
    // skipping INBOX. Monitor the actual destination via GMAIL_IMAP_MAILBOX
    // (default: INBOX). For a "catch-all" setup, use '[Gmail]/All Mail' or the
    // localized equivalent ('[Gmail]/Todos os e-mails').
    const mailboxPath = process.env.GMAIL_IMAP_MAILBOX || 'INBOX';
    const mailbox = await client.mailboxOpen(mailboxPath);
    console.log(`[email] mailbox '${mailboxPath}' opened — ${mailbox.exists} messages`);

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
          let parsed = null;
          let fromAddress = '';
          let subject = '';
          try {
            const raw = await client.download(uid.toString(), undefined, { uid: true });
            if (!raw?.content) {
              // No content — still mark seen to avoid reprocessing forever
              try { await client.messageFlagsAdd(uid.toString(), ['\\Seen'], { uid: true }); } catch {}
              continue;
            }

            const chunks = [];
            for await (const chunk of raw.content) chunks.push(chunk);
            parsed = await simpleParser(Buffer.concat(chunks));
            fromAddress = parsed.from?.value?.[0]?.address || '';
            subject = parsed.subject || '';

            const ota  = classifyOta(fromAddress);
            const stay = isStaysEmail(fromAddress);
            if (!ota && !stay) {
              // Not a message we respond to. Mark seen so we never revisit.
              await client.messageFlagsAdd(uid.toString(), ['\\Seen'], { uid: true });
              continue;
            }

            await processEmail(parsed);
            await client.messageFlagsAdd(uid.toString(), ['\\Seen'], { uid: true });
          } catch (err) {
            // Critical: log full stack + from/subject context so we can diagnose
            // silent parse/dispatch failures. ALWAYS mark seen afterwards so a
            // poison-pill message can't trap the monitor in an infinite poll loop.
            console.error(`[email] Error processing UID=${uid} from=${fromAddress} subj="${subject.slice(0, 80)}":`, err.message);
            if (err.stack) console.error('[email] stack:', err.stack.split('\n').slice(0, 6).join(' | '));
            try { await client.messageFlagsAdd(uid.toString(), ['\\Seen'], { uid: true }); } catch {}
          }
        }
      } catch (err) {
        console.error('[email] Error checking new emails:', err.message);
        // Zombie connection: imapflow sometimes keeps client.usable=true after
        // Gmail silently drops the socket. Force-close so the 'close' handler
        // can trigger a fresh reconnect.
        if (/Connection not available|not connected|closed/i.test(err.message)) {
          console.warn('[email] zombie connection detected, forcing close + reconnect');
          if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; }
          try { await client.logout(); } catch {}
          try { await client.close(); } catch {}
        }
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
