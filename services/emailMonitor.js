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
const { sendCheckinTemplate, sendWelcomeKit, sendCancellationRetention } = require('./whatsapp');

// ââ Stays.net reservation parsing + MongoDB storage ââ
const { isStaysEmail, parseStaysReservationEmail, isCancellationEmail, displayOtaName } = require('./reservationParser');
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

  // Resolve tenant pelo nome da acomodação (multi-tenant routing)
  // Email Stays só traz "Acomodação: 1607", não o listingStaysId. Reverse-lookup
  // no listingNamesJson de cada tenant ativo via CRM API.
  if (reservationData.accommodation) {
    try {
      const { resolveTenantByAccommodation } = require('./tenant');
      const owner = await resolveTenantByAccommodation(reservationData.accommodation);
      if (owner) {
        reservationData.tenantId = owner.tenant.tenantId;
        reservationData.listingStaysId = owner.listingStaysId;
        console.log(`[email][tenant] accommodation=${reservationData.accommodation} → tenant=${owner.tenant.tenantId} listing=${owner.listingStaysId}`);
      } else {
        console.log(`[email][tenant] accommodation=${reservationData.accommodation} sem match — caindo em torres default`);
        reservationData.tenantId = 'torres';
      }
    } catch (e) { console.warn('[email][tenant] resolve falhou:', e.message); }
  }

  // Symmetry: confirmationCode = staysReservationId (consistência entre flows)
  if (reservationData.staysReservationId && !reservationData.confirmationCode) {
    reservationData.confirmationCode = reservationData.staysReservationId;
  }

  // Save to MongoDB
  let saved = null;
  if (Reservation && isDBConnected()) {
    try {
      saved = await Reservation.upsertReservation(reservationData);
      console.log('[email] Reservation saved to MongoDB:', saved._id, 'tenant:', saved.tenantId || '(none)');
    } catch (err) {
      console.error('[email] Failed to save reservation to MongoDB:', err.message);
    }
  } else {
    console.log('[email] MongoDB not available — reservation data NOT persisted');
    console.log('[email] Reservation data (in-memory):', JSON.stringify(reservationData, null, 2));
  }

  // Route: cancellation email → retention flow; otherwise → check-in flow
  if (isCancellationEmail({ subject, text, html })) {
    console.log('[email] Stays email classified as CANCELLATION — routing to retention flow');
    await maybeSendCancellationRetention(saved, reservationData);
  } else {
    // Auto-send check-in template via WhatsApp (realtime, beats the VPS cron)
    await maybeSendCheckinTemplate(saved, reservationData);
  }
}

/**
 * Send the cancellation retention template when a Stays cancellation email
 * arrives — only if:
 *   1. phone is present (Booking-masked phones skip, same guard as check-in)
 *   2. retention not already sent for this reservation
 *   3. WA_CANCEL_RETENTION_AUTO_SEND !== 'false' (default ON, consistent with check-in flag)
 *
 * On success, marks cancellationReason='pending' + cancellationRetentionSentAt
 * + cancellationOta. Guards against duplicates via the 'pending' sentinel.
 * If the guest had already been dispatched a check-in template, the retention
 * still fires — the check-in is obsolete now.
 */
async function maybeSendCancellationRetention(saved, reservationData) {
  if (process.env.WA_CANCEL_RETENTION_AUTO_SEND === 'false') {
    console.log('[email][retention] disabled via WA_CANCEL_RETENTION_AUTO_SEND=false');
    return;
  }
  if (!saved) return;
  if (saved.cancellationRetentionSentAt) {
    console.log('[email][retention] already sent for reservation', saved._id);
    return;
  }
  const phone = saved.guestPhoneClean || reservationData.guestPhoneClean;
  if (!phone || phone.length < 12) {
    console.log('[email][retention] no real phone, skipping');
    return;
  }
  const firstName = (saved.guestName || reservationData.guestName || '').split(' ')[0] || 'Hospede';
  const ota = displayOtaName(saved.channel || reservationData.channel || saved.ota);

  console.log(`[email][retention] sending cancellation retention template to ${firstName} (${phone}) ota=${ota}`);
  const result = await sendCancellationRetention(phone, { firstName, ota });
  if (!result.ok) {
    if (result.skipped) console.log('[email][retention] skipped:', result.reason);
    else console.error('[email][retention] FAIL:', JSON.stringify(result.error).slice(0, 300));
    return;
  }
  // Mark pending — WhatsApp handler will intercept the guest's next message
  // within 72h and record it as the reason.
  saved.cancellationRetentionSentAt = new Date();
  saved.cancellationReason = 'pending';
  saved.cancellationOta = ota;
  saved.status = 'cancelado';
  try { await saved.save(); }
  catch (e) { console.warn('[email][retention] save flags failed:', e.message); }
  console.log(`[email][retention] template OK messageId=${result.messageId}`);
}

/**
 * Send the pre-checkin WhatsApp template when we captured a real phone from a
 * Stays reservation email — but only if:
 *   1. phone is present and cleaned (not a placeholder / OTA proxy)
 *   2. check-in is still in the future
 *   3. we haven't already auto-sent for this reservation (autoCheckinSentAt null)
 *   4. WA_CHECKIN_AUTO_SEND is not explicitly set to 'false' (default is ON)
 *
 * Marks autoCheckinSentAt on success so the VPS stays_sync doesn't duplicate.
 */
async function maybeSendCheckinTemplate(saved, reservationData) {
  if (process.env.WA_CHECKIN_AUTO_SEND === 'false') {
    console.log('[email][autosend] disabled via WA_CHECKIN_AUTO_SEND=false');
    return;
  }
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
    // Bug fix 29/05/2026 — caso Patrícia HA09J (Glauco Flat 1704):
    // Stays.net reenviou emails de reservas antigas (backfill). `new Date("27 fev 2026")`
    // retorna Invalid Date (Node só entende abreviações EN), então o gate passou
    // e mandou welcome-kit pra reserva de fev/2026 (3 meses atrás). Patrícia
    // respondeu "A data está incorreta" e bot caiu como concierge da reserva.
    // Meses PT que quebram: fev, abr, mai, ago, set, out, dez.
    // Usar parseDateOnly (services/whatsapp.js) que cobre PT short + long + ISO.
    const { parseDateOnly } = require('./whatsapp');
    const ci = parseDateOnly(saved.checkin || reservationData.checkin);
    if (ci && !isNaN(ci) && ci.getTime() < Date.now() - 24 * 3600 * 1000) {
      console.log('[email][autosend] check-in already past, skipping (parsed=' + ci.toISOString().slice(0,10) + ')');
      return;
    }
  } catch (e) { console.warn('[email][autosend] date parse warn:', e.message); }

  const firstName   = (saved.guestName || '').split(' ')[0] || 'Hospede';
  const listingName = saved.accommodation || saved.property || '-';
  const staysId     = saved.staysReservationId || reservationData.staysReservationId || '';
  const checkInDate = saved.checkin || reservationData.checkin;

  // Resolve tenant pra pegar settings.checkInPolicy (default: mandatory = sem nota extra)
  let tenantSettings = {};
  try {
    if (saved.tenantId) {
      const { fetchTenantById } = require('./tenant');
      const t = await fetchTenantById(saved.tenantId);
      tenantSettings = (t && t.settings) || {};
    }
  } catch (e) { console.warn('[email][autosend] tenant fetch warn:', e.message); }

  console.log(`[email][autosend] sending checkin template to ${firstName} (${phone}) tenant=${saved.tenantId||'?'} policy=${tenantSettings.checkInPolicy||'mandatory'}`);
  const result = await sendCheckinTemplate(phone, firstName, listingName, checkInDate, staysId, tenantSettings);
  if (!result.ok) {
    if (result.skipped) console.log('[email][autosend] skipped:', result.reason);
    else console.error('[email][autosend] FAIL:', JSON.stringify(result.error).slice(0, 300));
    return;
  }
  saved.autoCheckinSentAt = new Date();
  // Welcome kit is NOT sent here anymore. First-contact guests have a closed
  // Meta 24h service window — free-text is silently dropped despite HTTP 200
  // (observed with Wandress on 24/04). Instead, mark it pending so the
  // WhatsApp handler sends it as soon as the guest opens the window with any
  // inbound message. See project_meta_service_window.md.
  saved.welcomeKitPending = true;
  saved.welcomeKitTemplateSentAt = saved.autoCheckinSentAt;
  saved.welcomeKitContext = {
    firstName,
    listingName: saved.property || listingName,
    checkInDate: saved.checkin || reservationData.checkin,
    nights: saved.numNights,
    totalValue: saved.totalValue,
  };
  try { await saved.save(); } catch (e) { console.warn('[email][autosend] save flag failed:', e.message); }
  console.log(`[email][autosend] template OK (${result.variant || 'v1'}) messageId=${result.messageId} — welcome kit queued (will send on first inbound msg)`);
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

  // GUARD 12/05/2026: SMM (Central de Mensagens Stays) agora responde
  // diretamente no canal de origem (Booking/Airbnb/Expedia). Pipeline
  // legacy email->WhatsApp foi desativado pra evitar resposta duplicada
  // (conflito identificado: hospede recebia BREAKFAST_RESPONSE no WA E
  // resposta paralela no canal). Email continua sendo monitorado pra
  // route 1 (Stays new-reservation -> pre-checkin) que e desacoplada.
  const { OTA_GUEST_MESSAGE_DISABLED } = require('../config');
  if (OTA_GUEST_MESSAGE_DISABLED === 'true') {
    console.log(`[email] OTA guest message handling DISABLED (env OTA_GUEST_MESSAGE_DISABLED=true) - ${ota} skipped. SMM responde no canal.`);
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

  const autoSend = process.env.WA_CHECKIN_AUTO_SEND === 'false' ? 'OFF' : 'ON';
  const tplName  = process.env.WA_CHECKIN_TEMPLATE_NAME || 'checkin_link_pt (default)';
  const pubUrl   = process.env.PUBLIC_URL || 'https://conciergecloud.com.br (default)';
  console.log(`[email][autosend config] auto_send=${autoSend} template=${tplName} public_url=${pubUrl}`);

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

  // Robust lifecycle state — closure is re-created on each startEmailMonitor() call,
  // so reconnect always starts with a clean slate.
  let pollingTimer = null;
  let watchdogTimer = null;
  let circuitBreakerTimer = null;
  let reconnectScheduled = false;
  let checking = false;
  let checkingStartedAt = 0;
  let lastProgressAt = Date.now();

  const PROCESS_TIMEOUT_MS   = 45_000;   // processEmail (Mongo + Meta + OpenAI)
  const DOWNLOAD_TIMEOUT_MS  = 15_000;   // client.download + simpleParser
  const MARKSEEN_TIMEOUT_MS  = 10_000;   // client.messageFlagsAdd — the hang point observed 23/04
  const SEARCH_TIMEOUT_MS    = 20_000;   // client.search
  const CHECKING_STUCK_MS    = 150_000;  // 2.5min: one checkNewEmails shouldn't take this long
  const PROGRESS_STALE_MS    = 180_000;  // 3min no progress = probably zombie
  const CIRCUIT_BREAKER_MS   = 30 * 60_000; // 30min preventive reconnect
  const WATCHDOG_TICK_MS     = 30_000;

  const clearAllTimers = () => {
    if (pollingTimer)        { clearInterval(pollingTimer); pollingTimer = null; }
    if (watchdogTimer)       { clearInterval(watchdogTimer); watchdogTimer = null; }
    if (circuitBreakerTimer) { clearTimeout(circuitBreakerTimer); circuitBreakerTimer = null; }
  };

  const scheduleReconnect = (reason, delayMs = 30_000) => {
    if (reconnectScheduled) return;
    reconnectScheduled = true;
    clearAllTimers();
    console.log(`[email] scheduling reconnect in ${delayMs}ms (reason: ${reason})`);
    try { client.close(); } catch {}
    setTimeout(() => startEmailMonitor(), delayMs);
  };

  const forceExit = (reason) => {
    console.error(`[email][FATAL] ${reason} — forcing process.exit(1) for Render auto-restart`);
    clearAllTimers();
    setTimeout(() => process.exit(1), 500); // brief flush
  };

  const withTimeout = (promise, ms, label) => {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout ${ms}ms (${label})`)), ms); }),
    ]).finally(() => clearTimeout(timer));
  };

  // FIX 11/06: ImapFlow é EventEmitter — um 'error' emitido SEM listener
  // (ex.: Socket timeout fora de um await, crash-loop de 11/06 no Render)
  // derruba o processo inteiro ("Unhandled 'error' event" → exit 1).
  // Com o listener, o erro vira reconexão controlada.
  client.on('error', (err) => {
    console.error(`[email] ImapFlow error event: ${err?.message || err}`);
    scheduleReconnect(`imap error event: ${String(err?.message || 'unknown').slice(0, 80)}`, 60_000);
  });
  client.on('close', () => { console.log('[email] IMAP connection closed'); });

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
    lastProgressAt = Date.now();

    async function checkNewEmails() {
      if (!client.usable) {
        console.warn('[email] client.usable=false — scheduling reconnect (was silent-killed in previous code path)');
        scheduleReconnect('client.usable=false at check entry');
        return;
      }
      if (checking) {
        const stuckMs = Date.now() - checkingStartedAt;
        console.log(`[email] previous checkNewEmails still running (${stuckMs}ms), skipping this tick`);
        return;
      }
      checking = true;
      checkingStartedAt = Date.now();
      lastProgressAt = Date.now();
      try {
        // CRITICAL: pass { uid: true } so search returns real UIDs (3654, 3655),
        // not sequence numbers (1, 2). Without this, markSeen/download/messageFlagsAdd
        // below — which all pass { uid: true } — target UIDs that don't exist,
        // are silently no-op'd by IMAP, and the same seq-numbered "UIDs" keep
        // coming back on every poll. Observed bug 24/04.
        const uids = await withTimeout(client.search({ seen: false }, { uid: true }), SEARCH_TIMEOUT_MS, 'search unseen');
        if (!uids || !uids.length) return;

        console.log(`[email] Found ${uids.length} unseen message(s): [${uids.join(',')}]`);
        lastProgressAt = Date.now();

        for (const uid of uids) {
          lastProgressAt = Date.now();
          console.log(`[email] UID=${uid} download start`);
          let parsed = null;
          let fromAddress = '';
          let subject = '';
          let markedSeen = false;
          const markSeen = async () => {
            if (markedSeen) return;
            try {
              await withTimeout(
                client.messageFlagsAdd(uid.toString(), ['\\Seen'], { uid: true }),
                MARKSEEN_TIMEOUT_MS,
                `markSeen UID ${uid}`
              );
              markedSeen = true;
              console.log(`[email] UID=${uid} markSeen OK`);
            } catch (e) {
              console.warn(`[email] UID=${uid} markSeen failed: ${e.message}`);
            }
          };

          try {
            // 1) Download + parse with a TIGHT timeout
            const prefetch = await withTimeout((async () => {
              const raw = await client.download(uid.toString(), undefined, { uid: true });
              if (!raw?.content) return null;
              const chunks = [];
              for await (const chunk of raw.content) chunks.push(chunk);
              return simpleParser(Buffer.concat(chunks));
            })(), DOWNLOAD_TIMEOUT_MS, `download+parse UID ${uid}`);

            console.log(`[email] UID=${uid} download+parse OK`);
            lastProgressAt = Date.now();

            if (!prefetch) { await markSeen(); continue; }
            parsed = prefetch;
            fromAddress = parsed.from?.value?.[0]?.address || '';
            subject = parsed.subject || '';

            const ota  = classifyOta(fromAddress);
            const stay = isStaysEmail(fromAddress);
            if (!ota && !stay) {
              console.log(`[email] UID=${uid} not OTA/Stays, marking seen + skip`);
              await markSeen();
              continue;
            }

            // 2) Commit Seen BEFORE heavy processing
            await markSeen();
            lastProgressAt = Date.now();

            // 3) Heavy processing with its own timeout
            await withTimeout(processEmail(parsed), PROCESS_TIMEOUT_MS, `processEmail UID ${uid} ${fromAddress}`);
            console.log(`[email] UID=${uid} processEmail done`);
            lastProgressAt = Date.now();
          } catch (err) {
            console.error(`[email] Error UID=${uid} from=${fromAddress} subj="${subject.slice(0, 80)}":`, err.message);
            if (err.stack) console.error('[email] stack:', err.stack.split('\n').slice(0, 6).join(' | '));
            await markSeen();
          }
        }
      } catch (err) {
        console.error('[email] Error checking new emails:', err.message);
        if (/Connection not available|not connected|closed|timeout/i.test(err.message)) {
          scheduleReconnect(`checkNewEmails error: ${err.message}`);
        }
      } finally {
        checking = false;
        checkingStartedAt = 0;
      }
    }

    // Initial check
    await checkNewEmails();

    // Listen for new messages via IDLE
    client.on('exists', async (data) => {
      console.log(`[email] New message notification (exists: ${data.count})`);
      try { await checkNewEmails(); } catch (e) { console.error('[email] exists handler error:', e.message); }
    });

    // Keep connection alive with periodic polling (fallback for IDLE issues)
    pollingTimer = setInterval(async () => {
      try { await checkNewEmails(); }
      catch (err) { console.error('[email] Polling error:', err.message); }
    }, 60_000);

    // Watchdog: force process.exit(1) if stuck; Render auto-restarts the service
    watchdogTimer = setInterval(() => {
      const now = Date.now();
      if (checking) {
        const stuckMs = now - checkingStartedAt;
        if (stuckMs > CHECKING_STUCK_MS) {
          forceExit(`checkNewEmails hung for ${stuckMs}ms (>${CHECKING_STUCK_MS}ms)`);
          return;
        }
      } else {
        const staleMs = now - lastProgressAt;
        if (staleMs > PROGRESS_STALE_MS) {
          console.warn(`[email] no progress for ${staleMs}ms, client.usable=${client.usable}`);
          if (!client.usable) {
            scheduleReconnect('watchdog !client.usable + stale progress');
          } else {
            // Connection claims usable but no progress — proactively reconnect
            scheduleReconnect('watchdog: progress stale despite client.usable=true');
          }
        }
      }
    }, WATCHDOG_TICK_MS);

    // Circuit breaker: force reconnect every 30min regardless (preventive)
    circuitBreakerTimer = setTimeout(() => {
      console.log('[email] circuit breaker: 30min preventive reconnect');
      scheduleReconnect('circuit breaker 30min', 5_000);
    }, CIRCUIT_BREAKER_MS);

    client.on('close', () => {
      console.log('[email] IMAP close event fired');
      scheduleReconnect('close event', 30_000);
    });

    client.on('error', (err) => {
      console.error('[email] IMAP error:', err.message);
    });

  } catch (err) {
    console.error('[email] Failed to start IMAP monitor:', err.message);
    console.log('[email] Retrying in 60 seconds...');
    clearAllTimers();
    setTimeout(() => startEmailMonitor(), 60_000);
  }
}

module.exports = { startEmailMonitor };
