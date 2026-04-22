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
 * Sends the pre-checkin template (Meta-approved UTILITY).
 *
 * Works with two template shapes:
 * - v1 (`checkin_link_pt`): body has 3 text vars (nome, apto, data). A separate
 *   free-text message with the portal URL is sent 1.5s later.
 * - v2 (`checkin_link_pt_v2` or any name matching /_v2$/): body has the same 3
 *   vars PLUS a URL button whose dynamic suffix is the `staysId`. No follow-up
 *   free-text is needed since the link is *inside* the template (survives the
 *   "first-contact filter" of WhatsApp on the guest side).
 *
 * Env:
 *   WA_CHECKIN_TEMPLATE_NAME (default: checkin_link_pt)
 *   PUBLIC_URL               (default: https://conciergecloud.com.br)
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
  const isV2         = /_v2$|v2_|V2/.test(templateName);

  try {
    const dateBR = new Date(checkInDate).toLocaleDateString('pt-BR', {
      day: '2-digit', month: 'long', year: 'numeric',
    });
    const components = [{
      type: 'body',
      parameters: [
        { type: 'text', text: firstName || 'Hospede' },
        { type: 'text', text: listingName || '-' },
        { type: 'text', text: dateBR },
      ],
    }];
    if (isV2) {
      // v2 template has a URL button with a dynamic suffix (staysId)
      components.push({
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: staysId || '' }],
      });
    }

    const r = await fetch(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: { name: templateName, language: { code: 'pt_BR' }, components },
      }),
    });
    const data = await r.json();
    if (!r.ok) return { ok: false, error: data };

    // v1: precisa da mensagem livre subsequente porque o link nao esta no template
    if (!isV2) {
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
    }
    return { ok: true, messageId: data.messages?.[0]?.id, variant: isV2 ? 'v2' : 'v1' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Sends the long welcome message right after the check-in template — services,
 * house rules, amenities, 24/7 concierge reminder. Uses the free-text window
 * opened by the preceding template.
 *
 * This is the WhatsApp version of the OTA welcome text the host pastes into
 * Booking / Airbnb / Expedia / Decolar chats.
 *
 * @param {string} phone
 * @param {{firstName:string, listingName:string, checkInDate?:string|Date, nights?:number, totalValue?:string}} data
 * @returns {Promise<{ok:boolean, messageId?:string, error?:any, skipped?:boolean}>}
 */
async function sendWelcomeKit(phone, data = {}) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) return { skipped: true, reason: 'missing credentials' };
  const firstName   = data.firstName || 'Hospede';
  const listingName = data.listingName || 'nosso flat';
  const dateBR = data.checkInDate
    ? new Date(data.checkInDate).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '';
  const nightsLine = data.nights ? ` por ${data.nights} dia${data.nights > 1 ? 's' : ''}` : '';
  const valueLine  = data.totalValue ? `, no valor de ${data.totalValue}` : '';

  const body = [
    `Olá, ${firstName}! 😊`,
    '',
    `📲 Apresentamos nosso Concierge TorresGuest 24 horas e 7 dias da semana: para qualquer dúvida a qualquer hora, fale direto aqui no WhatsApp. Você também pode digitar *MENU* para respostas rápidas.`,
    '',
    `Sua hospedagem no ${listingName} está confirmada${dateBR ? ` para ${dateBR}` : ''}${valueLine}${nightsLine}.`,
    'O flat foi preparado com carinho e conta com cama de casal confortável + sofá, pensado para o seu descanso.',
    '',
    'Somos uma propriedade particular integrada ao Hotel Transamerica Executive Perdizes, mantendo os mesmos padrões de cuidado, conservação e manutenção.',
    '',
    '✅ Estacionamento gratuito (valet): ao chegar, informe "Flat Condomínio".',
    '✅ Café da manhã incluso: restaurante do hotel, 06h30–10h00.',
    '✅ Limpeza: realizada pela Governança do hotel.',
    '✅ Internet e TV a cabo: disponibilizadas pelo hotel e ativadas no check-in.',
    '',
    '🛠️ Aviso rápido de melhorias: nas próximas semanas pode ocorrer limpeza de fachada e troca de carpetes nos corredores, eventualmente em horário comercial — plano do hotel para te receber com mais conforto.',
    '',
    '🍫 Frigobar: prontinho e abastecido. Pagamento via PIX pelo QR Code na plaquinha sob a pia (reposição feita pela nossa equipe, não pelo hotel).',
    '',
    'Se precisar de qualquer suporte, conte conosco — estou disponível 24/7 por aqui.',
    '',
    'Muito obrigado por escolher o nosso flat! 🌟',
    '',
    'Com carinho,',
    'Sofia · Administração TorresGuest',
  ].join('\n');

  try {
    const r = await fetch(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { preview_url: false, body },
      }),
    });
    const data2 = await r.json();
    if (!r.ok) return { ok: false, error: data2 };
    return { ok: true, messageId: data2.messages?.[0]?.id };
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
  sendWelcomeKit,
};
