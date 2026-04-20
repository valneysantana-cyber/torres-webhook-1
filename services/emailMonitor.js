'use strict';

/**
 * emailMonitor.js — IMAP listener for OTA guest emails
 *
 * Connects to Gmail via IMAP (imapflow), polls for new emails from OTAs
 * (Booking.com, Airbnb, Expedia), and routes them to the parser + responder.
 *
 * Reuses the SAME response rules as WhatsApp (responses/strings.js + utils/matchers.js).
 *
 * v2 — 19/04/2026: Fixed connection lifecycle, reconnection, and email processing.
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
    'guest.booking.com',
    'airbnb.com',
    'expedia.com',
    'messages.airbnb.com',
  ];

// Track processed message IDs to avoid duplicates
const processedMessageIds = new Set();
const MAX_PROCESSED_CACHE = 500;

// Module-level state for connection lifecycle
let pollingInterval = null;
let imapClient = null;
let isChecking = false; // Prevent concurrent checkNewEmails

/**
 * Classify OTA source from the sender email domain.
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
 */
async function processEmail(parsed) {
    const messageId = parsed.messageId;

  if (processedMessageIds.has(messageId)) {
        console.log('[email] Skipping duplicate:', messageId);
        return;
  }
    processedMessageIds.add(messageId);
    if (processedMessageIds.size > MAX_PROCESSED_CACHE) {
          const first = processedMessageIds.values().next().value;
          processedMessageIds.delete(first);
    }

  const fromAddress = parsed.from?.value?.[0]?.address || '';
    const fromName = parsed.from?.value?.[0]?.name || '';
    const replyTo = parsed.replyTo?.value?.[0]?.address || fromAddress;
    const subject = parsed.subject || '';

  console.log('[email] Processing message:', { from: fromAddress, subject, replyTo });

  const ota = classifyOta(fromAddress);
    if (!ota) {
          console.log('[email] Not an OTA email, skipping:', fromAddress);
          return;
    }

  console.log(`[email] OTA detected: ${ota}`);

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

  await handleEmailResponse(otaData);
}

/**
 * Check and process new unseen emails.
 * Guarded against concurrent execution and dead connections.
 */
async function checkNewEmails(client) {
    if (isChecking) return;
    if (!client || !client.usable) {
          console.log('[email] Connection not usable, skipping check');
          return;
    }

  isChecking = true;
    try {
          const uids = await client.search({ seen: false }, { uid: true });
          if (!uids || !uids.length) {
                  isChecking = false;
                  return;
          }

      console.log(`[email] Found ${uids.length} unseen message(s)`);

      for (const uid of uids) {
              try {
                        if (!client.usable) {
                                    console.log('[email] Connection lost during processing, stopping');
                                    break;
                        }

                const raw = await client.download(uid.toString(), undefined, { uid: true });
                        if (!raw?.content) continue;

                const chunks = [];
                        for await (const chunk of raw.content) {
                                    chunks.push(chunk);
                        }
                        const buffer = Buffer.concat(chunks);
                        const parsed = await simpleParser(buffer);

                const fromAddress = parsed.from?.value?.[0]?.address || '';
                        if (classifyOta(fromAddress)) {
                                    await processEmail(parsed);
                                    // Mark as seen after processing
                          if (client.usable) {
                                        await client.messageFlagsAdd(uid.toString(), ['\\Seen'], { uid: true });
                                        console.log(`[email] Marked UID ${uid} as seen`);
                          }
                        } else {
                                    console.log(`[email] Non-OTA email from ${fromAddress}, skipping`);
                        }
              } catch (err) {
                        console.error(`[email] Error processing UID ${uid}:`, err.message);
              }
      }
    } catch (err) {
          console.error('[email] Error checking new emails:', err.message);
    } finally {
          isChecking = false;
    }
}

/**
 * Clean up existing connection and polling.
 */
function cleanup() {
    if (pollingInterval) {
          clearInterval(pollingInterval);
          pollingInterval = null;
    }
    if (imapClient) {
          try { imapClient.close(); } catch (e) { /* ignore */ }
          imapClient = null;
    }
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

  // Clean up any previous connection
  cleanup();

  console.log(`[email] Starting IMAP monitor for ${GMAIL_IMAP_USER}...`);
    console.log(`[email] Password length: ${GMAIL_IMAP_PASSWORD?.length || 0} chars`);

  const client = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: {
                user: GMAIL_IMAP_USER,
                pass: GMAIL_IMAP_PASSWORD,
        },
        logger: false,
        emitLogs: false,
        greetingTimeout: 30000,
        socketTimeout: 300000, // 5 min socket timeout
  });

  imapClient = client;

  try {
        await client.connect();
        console.log('[email] IMAP connected successfully');

      const mailbox = await client.mailboxOpen('INBOX');
        console.log(`[email] INBOX opened — ${mailbox.exists} messages`);

      // Initial check
      await checkNewEmails(client);

      // Listen for new messages via IDLE
      client.on('exists', async (data) => {
              console.log(`[email] New message notification (exists: ${data.count || data.path || 'unknown'})`);
              await checkNewEmails(client);
      });

      // Polling fallback every 60 seconds
      pollingInterval = setInterval(async () => {
              if (!client.usable) {
                        console.log('[email] Client no longer usable, stopping polling and reconnecting...');
                        cleanup();
                        setTimeout(() => startEmailMonitor(), 10_000);
                        return;
              }
              await checkNewEmails(client);
      }, 60_000);

      // Handle disconnects with auto-reconnect
      client.on('close', () => {
              console.log('[email] IMAP connection closed, reconnecting in 15s...');
              cleanup();
              setTimeout(() => startEmailMonitor(), 15_000);
      });

      client.on('error', (err) => {
              console.error('[email] IMAP error:', err.message);
      });

  } catch (err) {
        console.error('[email] Failed to start IMAP monitor:', err.message);
        console.error('[email] Error details:', JSON.stringify({
                code: err.code,
                responseStatus: err.responseStatus,
                responseText: err.responseText,
                authenticationFailed: err.authenticationFailed,
                command: err.command,
        }));
        console.error('[email] Stack:', err.stack?.split('\n').slice(0, 5).join('\n'));
        cleanup();
        console.log('[email] Retrying in 60 seconds...');
        setTimeout(() => startEmailMonitor(), 60_000);
  }
}

module.exports = { startEmailMonitor };
