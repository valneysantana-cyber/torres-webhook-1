'use strict';

/**
 * emailResponder.js — AI response + email reply + WhatsApp notification
 *
 * CORE PRINCIPLE: Reuses the EXACT SAME response rules as WhatsApp.
 * The guest message goes through the same matchers (shouldSendParking,
 * shouldSendWifi, etc.) and gets the same canned responses (PARKING_RESPONSE,
 * WIFI_RESPONSE, etc.). For unmatched messages, falls back to GPT with the
 * same SYSTEM_PROMPT used in WhatsApp.
 */

const nodemailer = require('nodemailer');
const { normalizeText } = require('../utils/formatters');
const { getChatGptFallbackReply } = require('../services/openai');
const { sendWhatsAppText } = require('../services/whatsapp');

// ── Import the EXACT SAME matchers and responses from WhatsApp ──
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
} = require('../config');

// EMAIL DISPATCH TABLE (mirrors PT_DISPATCH from handlers/whatsapp.js)
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

/**
 * Adapt a WhatsApp response for email format.
 * Removes WhatsApp bold markers *text* but keeps the text.
 */
function adaptForEmail(text) {
  return text.replace(/\*([^*]+)\*/g, '$1');
}

// SMTP Transport (Gmail)
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

/**
 * Send an email reply to the OTA relay address.
 */
async function sendEmailReply(replyTo, responseText, guestName) {
  const smtp = getTransporter();

  const mailOptions = {
    from: `"TorresGuest Concierge" <${GMAIL_SMTP_USER}>`,
    to: replyTo,
    subject: `Re: Mensagem de ${guestName}`,
    text: responseText,
    html: `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333;">
      <p>${responseText.replace(/\n/g, '<br>')}</p>
      <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
      <p style="font-size: 12px; color: #999;">TorresGuest Concierge<br>
      Hotel em Perdizes — São Paulo/SP</p>
    </div>`,
  };

  const info = await smtp.sendMail(mailOptions);
  console.log(`[email] Reply sent to ${replyTo} — messageId: ${info.messageId}`);
  return info;
}

/**
 * Send a WhatsApp notification to the property owner about the email interaction.
 */
async function notifyOwner(otaData, response, autoReplied) {
  const status = autoReplied ? '✅ RESPONDIDO AUTOMATICAMENTE' : '⏳ AGUARDANDO SUA RESPOSTA';
  const reservaInfo = otaData.bookingNumber
    ? `\n📋 Reserva: ${otaData.bookingNumber}`
    : '';
  const dates = otaData.reservation?.checkin
    ? `\n📅 ${otaData.reservation.checkin} → ${otaData.reservation.checkout}`
    : '';
  const property = otaData.reservation?.property
    ? `\n🏨 ${otaData.reservation.property}`
    : '';

  const message = `📧 *MENSAGEM VIA ${otaData.ota.toUpperCase()}*\n` +
    `${status}\n\n` +
    `👤 Hóspede: ${otaData.guestName}${reservaInfo}${dates}${property}\n\n` +
    `💬 Pergunta:\n"${otaData.guestMessage}"\n\n` +
    `📤 Resposta:\n"${response}"`;

  try {
    const ownerPhone = HUMAN_NUMBER_PRIMARY?.replace(/\D/g, '') || '';
    if (ownerPhone) {
      await sendWhatsAppText(`55${ownerPhone}`, message);
      console.log('[email] Owner notified via WhatsApp');
    }
  } catch (err) {
    console.error('[email] Failed to notify owner via WhatsApp:', err.message);
  }
}

/**
 * Handle an incoming OTA email using the SAME rules as WhatsApp.
 * @param {Object} otaData - Parsed OTA data from emailParser
 */
async function handleEmailResponse(otaData) {
  const { guestMessage, replyTo, guestName, ota } = otaData;

  if (!guestMessage) {
    console.log('[email] No guest message to respond to');
    return;
  }

  // Step 1: Normalize (same as WhatsApp handler)
  const normalized = normalizeText(guestMessage);
  console.log(`[email] Processing: "${guestMessage}" → normalized: "${normalized}"`);

  // Step 2: Check canned responses (SAME matchers as WhatsApp)
  let response = null;
  let matchedRule = null;

  for (const entry of EMAIL_DISPATCH) {
    if (entry.check(normalized)) {
      response = entry.reply();
      matchedRule = entry.check.name;
      break;
    }
  }

  // Step 3: GPT fallback if no match (SAME prompt as WhatsApp)
  if (!response) {
    console.log('[email] No canned match, using GPT fallback...');
    response = await getChatGptFallbackReply(guestMessage, `email-${ota}`, [], null);
    matchedRule = 'gpt-fallback';
  }

  if (!response) {
    console.log('[email] No response generated (GPT also failed)');
    response = 'Obrigado pela sua mensagem! Nossa equipe irá responder em breve.';
    matchedRule = 'default-fallback';
  }

  // Adapt for email format
  const emailResponse = adaptForEmail(response);

  console.log(`[email] Response generated (${matchedRule}):`, emailResponse.substring(0, 100));

  // Step 4: Auto-reply or just notify
  const autoReplyEnabled = EMAIL_AUTO_REPLY === 'true';

  if (autoReplyEnabled && replyTo) {
    try {
      await sendEmailReply(replyTo, emailResponse, guestName);
      console.log(`[email] ✅ Auto-reply sent to ${replyTo}`);
    } catch (err) {
      console.error('[email] ❌ Failed to send auto-reply:', err.message);
    }
  } else {
    console.log('[email] Auto-reply DISABLED — notification only');
  }

  // Step 5: Notify owner via WhatsApp
  await notifyOwner(otaData, emailResponse, autoReplyEnabled);

  // Step 6: Log interaction
  console.log('[email] Interaction logged:', {
    ota,
    guestName,
    rule: matchedRule,
    autoReplied: autoReplyEnabled,
    timestamp: new Date().toISOString(),
  });
}

module.exports = { handleEmailResponse, sendEmailReply };
