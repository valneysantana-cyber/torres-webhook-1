'use strict';

const { WHATSAPP_TOKEN, PHONE_NUMBER_ID } = require('../config');
const { shortenForAudio } = require('../utils/formatters');
const { synthesizeSpeechBuffer } = require('./openai');

// ─── markReadAndTyping ────────────────────────────────────────────────────────
// Chame fire-and-forget logo que a mensagem chega.
// 1. Marca como lida  → duplo visto azul para o hospede
// 2. Envia indicador de digitacao → "..." enquanto o bot processa
async function markReadAndTyping(to, messageId) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) return;

  const url     = `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${WHATSAPP_TOKEN}`,
  };

  // 1. Marca mensagem como lida (visto azul duplo)
  if (messageId) {
    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    }).catch(err => console.error('[read-receipt]', err.message));
  }

  // 2. Indicador de digitacao ("..." no chat do hospede)
  fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'typing',
      to,
    }),
  }).catch(err => console.error('[typing-indicator]', err.message));
}

async function downloadWhatsAppMedia(mediaId) {
  if (!WHATSAPP_TOKEN) throw new Error('Missing WhatsApp token');
  const metaRes = await fetch(`https://graph.facebook.com/v25.0/${mediaId}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
  });
  if (!metaRes.ok) {
    const text = await metaRes.text();
    throw new Error(`Failed to fetch media metadata: ${metaRes.status} ${text}`);
  }
  const meta = await metaRes.json();
  if (!meta?.url) throw new Error('Media URL not found');
  const fileRes = await fetch(meta.url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
  });
  if (!fileRes.ok) {
    const text = await fileRes.text();
    throw new Error(`Failed to download media: ${fileRes.status} ${text}`);
  }
  return Buffer.from(await fileRes.arrayBuffer());
}

async function uploadWhatsAppAudio(buffer, filename = 'reply.mp3', mimeType = 'audio/mpeg') {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) throw new Error('Missing WhatsApp credentials');
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  const response = await fetch(`https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    body: form,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WhatsApp media upload failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  if (!data?.id) throw new Error('WhatsApp media upload returned no media id');
  return data.id;
}

async function sendWhatsAppAudio(to, mediaId) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) throw new Error('Missing WhatsApp credentials');
  const response = await fetch(`https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'audio', audio: { id: mediaId } }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WhatsApp send audio failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  console.log('WhatsApp audio reply sent', JSON.stringify(data));
}

async function sendWhatsAppText(to, body) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) { console.error('Missing WhatsApp credentials'); return; }
  const response = await fetch(`https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body } }),
  });
  if (!response.ok) {
    const text = await response.text();
    console.error('Failed to send WhatsApp message', response.status, text);
  } else {
    const data = await response.json();
    console.log('WhatsApp reply sent', JSON.stringify(data));
  }
}

async function replyToGuest(to, text, options = {}) {
  const { alsoSendAudio = false } = options;
  if (alsoSendAudio) {
    try {
      const shortText = shortenForAudio(text);
      if (shortText.length > 600) { await sendWhatsAppText(to, text); return; }
      const audioBuffer = await synthesizeSpeechBuffer(shortText);
      const mediaId     = await uploadWhatsAppAudio(audioBuffer, 'reply.mp3', 'audio/mpeg');
      await sendWhatsAppAudio(to, mediaId);
      return;
    } catch (err) {
      console.error('Failed to send audio reply, falling back to text', err);
      await sendWhatsAppText(to, text);
      return;
    }
  }
  await sendWhatsAppText(to, text);
}

/**
 * Sends the pre-checkin template (Meta-approved UTILITY) followed by a free-text
 * link message. The template opens the 24h session window, so the follow-up
 * text lands in the same thread.
 *
 * Template name / language / vars are configurable via env:
 *   WA_CHECKIN_TEMPLATE_NAME (default: checkin_link_pt)
 *   PUBLIC_URL (default: https://conciergecloud.com.br)
 *
 * @param {string} phone        E.164 digits only, e.g. '5511999073135'
 * @param {string} firstName    Guest first name
 * @param {string} listingName  Apartment / property name, e.g. 'FLAT404'
 * @param {string|Date} checkInDate  Check-in date (parseable by Date)
 * @param {string} staysId      Stays.net reservation id (for portal URL)
 * @returns {Promise<{ok:boolean, skipped?:boolean, messageId?:string, error?:any}>}
 */
async function sendCheckinTemplate(phone, firstName, listingName, checkInDate, staysId) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) return { skipped: true, reason: 'missing credentials' };
  const templateName = process.env.WA_CHECKIN_TEMPLATE_NAME || 'checkin_link_pt';
  const publicUrl    = process.env.PUBLIC_URL || 'https://conciergecloud.com.br';
  try {
    const dateBR = new Date(checkInDate).toLocaleDateString('pt-BR', {
      day: '2-digit', month: 'long', year: 'numeric',
    });
    const templatePayload = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'pt_BR' },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: firstName || 'Hospede' },
            { type: 'text', text: listingName || '-' },
            { type: 'text', text: dateBR },
          ],
        }],
      },
    };
    const r = await fetch(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(templatePayload),
    });
    const data = await r.json();
    if (!r.ok) return { ok: false, error: data };

    // Segunda mensagem livre com link (janela 24h recem-aberta pelo template)
    await new Promise(res => setTimeout(res, 1500));
    await fetch(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: {
          preview_url: true,
          body: `Aqui esta o link do seu pre-check-in:\n\n${publicUrl}/checkin/${staysId}\n\nLeva menos de 2 minutos. Seus dados sao protegidos conforme a LGPD. 🙂`,
        },
      }),
    });
    return { ok: true, messageId: data.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  markReadAndTyping,
  downloadWhatsAppMedia,
  uploadWhatsAppAudio,
  sendWhatsAppAudio,
  sendWhatsAppText,
  replyToGuest,
  sendCheckinTemplate,
};
