'use strict';

/**
 * emailMonitor.js — IMAP listener for OTA guest emails
 *
 * Connects to Gmail via IMAP (imapflow), polls for new emails from OTAs
 * (Booking.com, Airbnb, Expedia), and routes them to the parser + responder.
 *
 * Reuses the SAME response rules as WhatsApp (responses/strings.js + utils/matchers.js).
 */

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { parseOtaEmail } = require('./emailParser');
const { handleEmailResponse } = require('./emailResponder');

const {
  GMAIL_IMAP_USER,
  GMAIL_IMAP_PASSWORD,
  EMAIL_MONITOR_ENABLED,
} = require('../config');

// Domains we recognize as OTA relay emails
const OTA_DOMAINS = [
  'guest.booking.com',      // Booking.com relay
  'airbnb.com',             // Airbnb (TBD)
  'expedia.com',            // Expedia (TBD)
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
 * Process a single email message.
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

  // Classify OTA
  const ota = classifyOta(fromAddress);
  if (!ota) {
    console.log('[email] Not an OTA email, skipping:', fromAddress);
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
    console.log(`[email] INBOX opened — ${mailbox.exists} messages`);

    // Process new emails function
    async function checkNewEmails() {
      try {
        // Search for UNSEEN messages from OTA domains
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

            // Only process OTA emails
            const fromAddress = parsed.from?.value?.[0]?.address || '';
            if (classifyOta(fromAddress)) {
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
    setInterval(async () => {
      try {
        await checkNewEmails();
      } catch (err) {
        console.error('[email] Polling error:', err.message);
      }
    }, 60_000); // Check every 60 seconds

    // Handle disconnects with auto-reconnect
    client.on('close', () => {
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
