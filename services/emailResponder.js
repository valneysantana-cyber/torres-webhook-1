'use strict';

/**
 * emailResponder.js â AI response + email reply + WhatsApp notification
 *
 * CORE PRINCIPLE: Reuses the EXACT SAME response rules as WhatsApp.
 * The guest message goes through the same matchers (shouldSendParking,
 * shouldSendWifi, etc.) and gets the same canned responses (PARKING_RESPONSE,
 * WIFI_RESPONSE, etc.). For unmatched messages, falls back to GPT with the
 * same SYSTEM_PROMPT used in WhatsApp.
 *
 * Flow:
 * 1. Normalize guest message (same as WhatsApp)
 * 2. Run through PT_DISPATCH matchers (same as WhatsApp)
 * 3. If no match â GPT fallback (same prompt as WhatsApp)
 * 4. Send reply email via SMTP to OTA relay address
 * 5. Send WhatsApp directly to guest (if phone available from Stays.net data)
 * 6. Notify owner via WhatsApp
 * 7. Log to MongoDB
 */

const nodemailer = require('nodemailer');
const { normalizeText } = require('../utils/formatters');
const { getChatGptFallbackReply } = require('../services/openai');
const { sendWhatsAppText } = require('../services/whatsapp');

// ââ Import the EXACT SAME matchers and responses from WhatsApp ââ
const {
  shouldSendWifi,
  shouldSendBreakfast,
  shouldSendPool,
  shouldSendParking,
  shouldSendSnacks,
  shouldSendTowels,
  shouldSendRestaurant,
  shouldSendCheckin,
  shouldSendSecurity,
  shouldSendTransfer,
  shouldSendLocation,
  shouldSendLongStay,
  shouldSendCleaning,
  shouldSendInternet,
  shouldSendLuggage,
  shouldSendFrigobarPix,
} = require('../utils/matchers');

const {
  WIFI_RESPONSE,
  BREAKFAST_RESPONSE,
  POOL_RESPONSE,
  PARKING_RESPONSE,
  SNACKS_RESPONSE,
  TOWELS_RESPONSE,
  RESTAURANT_RESPONSE,
  CHECKIN_RESPONSE,
  SECURITY_RESPONSE,
  TRANSFER_RESPONSE,
  LONG_STAY_RESPONSE,
  CLEANING_RESPONSE,
  INTERNET_RESPONSE,
  LUGGAGE_RESPONSE,
  FRIGOBAR_PIX_RESPONSE,
  getLocationResponse,
} = require('../responses/strings');

const {
  GMAIL_SMTP_USER,
  GMAIL_SMTP_PASSWORD,
  EMAIL_AUTO_REPLY,
  HUMAN_NUMBER_PRIMARY,
  WHATSAPP_GUEST_REPLY,
} = require('../config');

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// EMAIL DISPATCH TABLE (mirrors PT_DISPATCH from handlers/whatsapp.js)
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const EMAIL_DISPATCH = [
  { check: shouldSendWifi,       reply: () => WIFI_RESPONSE },
  { check: shouldSendBreakfast,  reply: () => BREAKFAST_RESPONSE },
  { check: shouldSendPool,       reply: () => POOL_RESPONSE },
  { check: shouldSendParking,    reply: () => PARKING_RESPONSE },
  { check: shouldSendSnacks,     reply: () => SNACKS_RESPONSE },
  { check: shouldSendTowels,     reply: () => TOWELS_RESPONSE },
  { check: shouldSendRestaurant, reply: () => RESTAURANT_RESPONSE },
  { check: shouldSendCheckin,    reply: () => CHECKIN_RESPONSE },
  { check: shouldSendSecurity,   reply: () => SECURITY_RESPONSE },
  { check: shouldSendTransfer,   reply: () => TRANSFER_RESPONSE },
  { check: shouldSendLocation,   reply: () => getLocationResponse('pt') },
  { check: shouldSendLongStay,   reply: () => LONG_STAY_RESPONSE },
  { check: shouldSendCleaning,   reply: () => CLEANING_RESPONSE },
  { check: shouldSendInternet,   reply: () => INTERNET_RESPONSE },
  { check: shouldSendLuggage,    reply: () => LUGGAGE_RESPONSE },
  { check: shouldSendFrigobarPix, reply: () => FRIGOBAR_PIX_RESPONSE },
];

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// Clean response for email (remove WhatsApp-specific emojis/formatting)
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

/**
 * Adapt a WhatsApp response for email format.
 * Removes WhatsApp-specific bold markers (*text*) and keeps emojis.
 * @param {string} text - WhatsApp response text
 * @returns {string} Email-ready text
 */
function adaptForEmail(text) {
  // Remove WhatsApp bold markers *text* but keep the text
  return text.replace(/\*([^*]+)\*/g, '$1');
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// SMTP Transport (Gmail)
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: GMAIL_SMTP_USER,
        pass: GMAIL_SMTP_PASSWORD,
      },
    });
  }
  return transporter;
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// Send reply email to OTA relay
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

/**
 * Send an email reply to the OTA relay address.
 *
 * For Booking.com to recognize the reply and display it in their messaging
 * system, the email MUST include proper threading headers:
 *   - Subject: "Re: [original subject]"
 *   - In-Reply-To: <original Message-ID>
 *   - References: <original Message-ID>
 *
 * @param {string} replyTo - The OTA relay email (e.g., xxx@guest.booking.com)
 * @param {string} responseText - The response text
 * @param {string} guestName - Guest name for display
 * @param {Object} [threading] - Email threading data
 * @param {string} [threading.originalMessageId] - Message-ID of the incoming email
 * @param {string} [threading.originalSubject] - Subject of the incoming email
 */
async function sendEmailReply(replyTo, responseText, guestName, threading = {}) {
  const smtp = getTransporter();

  const { originalMessageId, originalSubject } = threading;

  // Use original subject with Re: prefix for proper threading
  // Booking.com expects the reply to thread against the original email
  const subject = originalSubject
    ? (originalSubject.startsWith('Re:') ? originalSubject : `Re: ${originalSubject}`)
    : `Re: Mensagem de ${guestName}`;

  const mailOptions = {
    from: `"TorresGuest Concierge" <${GMAIL_SMTP_USER}>`,
    to: replyTo,
    subject,
    text: responseText,
    // HTML version with basic formatting
    html: `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333;">
      <p>${responseText.replace(/\n/g, '<br>')}</p>
      <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
      <p style="font-size: 12px; color: #999;">TorresGuest Concierge<br>
      Hotel em Perdizes - SÃ£o Paulo/SP</p>
    </div>`,
  };

  // Add threading headers so Booking.com associates this reply with the conversation
  if (originalMessageId) {
    mailOptions.inReplyTo = originalMessageId;
    mailOptions.references = originalMessageId;
    console.log(`[email] Threading headers set â In-Reply-To: ${originalMessageId}`);
  }

  const info = await smtp.sendMail(mailOptions);
  console.log(`[email] Reply sent to ${replyTo} â messageId: ${info.messageId}`);
  return info;
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// Send WhatsApp directly to guest (using phone from Stays.net reservation data)
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

/**
 * Send a WhatsApp message directly to the guest's phone number.
 * Phone number comes from Stays.net reservation data stored in MongoDB.
 *
 * @param {string} guestPhone - Clean phone number (e.g., "5511999073135")
 * @param {string} guestName - Guest name for logging
 * @param {string} responseText - The response to send
 * @returns {boolean} Whether the message was sent successfully
 */
async function sendWhatsAppToGuest(guestPhone, guestName, responseText) {
  if (!guestPhone) {
    console.log('[email] No guest phone available â WhatsApp to guest skipped');
    return false;
  }

  try {
    // Add greeting prefix for WhatsApp (more personal than email)
    const whatsappMessage = `OlÃ¡ ${guestName}! ð\n\n${responseText}\n\n` +
      `â TorresGuest Concierge\n` +
      `Hotel em Perdizes - SÃ£o Paulo/SP`;

    await sendWhatsAppText(guestPhone, whatsappMessage);
    console.log(`[email] â WhatsApp sent to guest ${guestName} (${guestPhone})`);
    return true;
  } catch (err) {
    console.error(`[email] â Failed to send WhatsApp to guest ${guestName}:`, err.message);
    return false;
  }
}
ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// Notify owner via WhatsApp
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

/**
 * Send a WhatsApp notification to the property owner about the email interaction.
 * @param {Object} otaData - Parsed OTA data
 * @param {string} response - The response that was (or would be) sent
 * @param {boolean} autoReplied - Whether the response was auto-sent
 * @param {boolean} whatsappSent - Whether WhatsApp was sent to guest
 */
async function notifyOwner(otaData, response, autoReplied, whatsappSent = false) {
  const statusParts = [];
  if (autoReplied) statusParts.push('ð§ Email respondido');
  if (whatsappSent) statusParts.push('ð± WhatsApp enviado');
  if (!autoReplied && !whatsappSent) statusParts.push('â³ AGUARDANDO SUA RESPOSTA');
  const status = statusParts.length > 0
    ? `â ${statusParts.join(' + ')}`
    : 'â³ AGUARDANDO SUA RESPOSTA';

  const reservaInfo = otaData.bookingNumber
    ? `\nð Reserva: ${otaData.bookingNumber}`
    : '';
  const dates = otaData.reservation?.checkin
    ? `\nð ${otaData.reservation.checkin} â ${otaData.reservation.checkout}`
    : '';
  const property = otaData.reservation?.property
    ? `\nð¨ ${otaData.reservation.property}`
    : '';
  const phoneInfo = otaData.reservation?.guestPhoneClean
    ? `\nð± WhatsApp: +${otaData.reservation.guestPhoneClean}`
    : '';

  const message = `ð§ *MENSAGEM VIA ${otaData.ota.toUpperCase()}*\n` +
    `${status}\n\n` +
    `ð¤ HÃ³spede: ${otaData.guestName}${reservaInfo}${dates}${property}${phoneInfo}\n\n` +
    `ð¬ Pergunta:\n"${otaData.guestMessage}"\n\n` +
    `ð¤ Resposta:\n"${response}"`;

  try {
    // Send to owner's WhatsApp (use HUMAN_NUMBER_PRIMARY without +55 prefix)
    const ownerPhone = HUMAN_NUMBER_PRIMARY?.replace(/\D/g, '') || '';
    if (ownerPhone) {
      await sendWhatsAppText(`55${ownerPhone}`, message);
      console.log('[email] Owner notified via WhatsApp');
    }
  } catch (err) {
    console.error('[email] Failed to notify owner via WhatsApp:', err.message);
  }
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// Main handler: process OTA email and generate response
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

/**
 * Handle an incoming OTA email using the SAME rules as WhatsApp.
 * Now also sends WhatsApp to guest if phone is available from reservation data.
 * @param {Object} otaData - Parsed OTA data from emailParser
 */
async function handleEmailResponse(otaData) {
  const { guestMessage, replyTo, guestName, ota, originalMessageId, originalSubject } = otaData;

  if (!guestMessage) {
    console.log('[email] No guest message to respond to');
    return;
  }

  // ââ Step 1: Normalize (same as WhatsApp handler) ââ
  const normalized = normalizeText(guestMessage);
  console.log(`[email] Processing: "${guestMessage}" â normalized: "${normalized}"`);

  // ââ Step 2: Check canned responses (SAME matchers as WhatsApp) ââ
  let response = null;
  let matchedRule = null;

  for (const entry of EMAIL_DISPATCH) {
    if (entry.check(normalized)) {
      response = entry.reply();
      matchedRule = entry.check.name;
      break;
    }
  }

  // ââ Step 3: GPT fallback if no match (SAME prompt as WhatsApp) ââ
  if (!response) {
    console.log('[email] No canned match, using GPT fallback...');
    // Pass reservation context to GPT for richer responses
    const reservationContext = otaData.reservation
      ? `\nContexto da reserva: HÃ³spede ${otaData.reservation.guestName}, ` +
        `check-in ${otaData.reservation.checkin}, check-out ${otaData.reservation.checkout}, ` +
        `acomodaÃ§Ã£o ${otaData.reservation.accommodation || 'N/A'}, ` +
        `${otaData.reservation.numGuests || 1} hÃ³spede(s).`
      : '';
    response = await getChatGptFallbackReply(
      guestMessage + reservationContext,
      `email-${ota}`,
      [],
      null
    );
    matchedRule = 'gpt-fallback';
  }

  if (!response) {
    console.log('[email] No response generated (GPT also failed)');
    response = 'Obrigado pela sua mensagem! Nossa equipe irÃ¡ responder em breve.';
    matchedRule = 'default-fallback';
  }

  // ââ Adapt for email format ââ
  const emailResponse = adaptForEmail(response);

  console.log(`[email] Response generated (${matchedRule}):`, emailResponse.substring(0, 100));

  // ââ Step 4: Auto-reply via email ââ
  const autoReplyEnabled = EMAIL_AUTO_REPLY === 'true';

  if (autoReplyEnabled && replyTo) {
    try {
      await sendEmailReply(replyTo, emailResponse, guestName, {
          originalMessageId,
          originalSubject,
        });
      console.log(`[email] â Auto-reply sent to ${replyTo}`);
    } catch (err) {
      console.error('[email] â Failed to send auto-reply:', err.message);
    }
  } else {
    console.log('[email] Auto-reply DISABLED â uotification only');
  }

  // ââ Step 5: Send WhatsApp directly to guest (NEW!) ââ
  let whatsappSent = false;
  const whatsappGuestEnabled = WHATSAPP_GUEST_REPLY !== 'false'; // enabled by default

  if (whatsappGuestEnabled && otaData.reservation?.guestPhoneClean) {
    whatsappSent = await sendWhatsAppToGuest(
      otaData.reservation.guestPhoneClean,
      guestName,
      response // Use original response (with WhatsApp formatting) for WhatsApp
    );
  } else if (!otaData.reservation?.guestPhoneClean) {
    console.log('[email] No guest phone in reservation data â WhatsApp to guest skipped');
  } else {
    console.log('[email] WhatsApp to guest DISABLED (WHATSAPP_GUEST_REPLY=false)');
  }

  // ââ Step 6: Notify owner via WhatsApp ââ
  await notifyOwner(otaData, emailResponse, autoReplyEnabled, whatsappSent);

  // ââ Step 7: Log interaction ââ
  console.log('[email] Interaction logged:', {
    ota,
    guestName,
    rule: matchedRule,
    autoReplied: autoReplyEnabled,
    whatsappSentToGuest: whatsappSent,
    guestPhone: otaData.reservation?.guestPhoneClean || 'N/A',
    timestamp: new Date().toISOString(),
  });
}

module.exports = { handleEmailResponse, sendEmailReply };
