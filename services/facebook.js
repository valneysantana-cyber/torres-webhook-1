'use strict';

/**
 * services/facebook.js — Fase 4: Facebook Page Integration
 *
 * Funcionalidades:
 * - Publicar posts no Facebook Page do TorresGuest
 * - Enviar e receber mensagens via Facebook Messenger
 * - Responder DMs com GPT-4o-mini
 *
 * Env vars necessárias no Render:
 *   FB_PAGE_ACCESS_TOKEN  — Page Access Token (gerado no Meta Business Suite)
 *   FB_PAGE_ID            — ID numérico da Página do Facebook do TorresGuest
 *
 * Como obter o Page Access Token:
 *   1. Acesse business.facebook.com → Configurações → Contas → Páginas
 *   2. Clique na Página → "Exibir token de acesso da Página"
 *   Ou via Graph API Explorer: graph.facebook.com/v25.0/{PAGE_ID}?fields=access_token
 */

const { OPENAI_API_KEY } = require('../config');

const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const FB_PAGE_ID           = process.env.FB_PAGE_ID;
const FB_API_VERSION       = 'v25.0';
const FB_BASE              = `https://graph.facebook.com/${FB_API_VERSION}`;

// ---------------------------------------------------------------------------
// Facebook Page posts
// ---------------------------------------------------------------------------

/**
 * Publica um post de texto no Facebook Page do TorresGuest.
 */
async function postTextToPage(message) {
  if (!FB_PAGE_ACCESS_TOKEN || !FB_PAGE_ID) {
    console.warn('[facebook] FB_PAGE_ACCESS_TOKEN ou FB_PAGE_ID não configurados — post ignorado');
    return null;
  }

  const res = await fetch(`${FB_BASE}/${FB_PAGE_ID}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, access_token: FB_PAGE_ACCESS_TOKEN })
  });
  const data = await res.json();
  if (data.error) throw new Error(`[facebook] Post falhou: ${JSON.stringify(data.error)}`);

  console.log(`[facebook] ✅ Post publicado na Página. ID: ${data.id}`);
  return data.id;
}

/**
 * Publica uma foto com legenda no Facebook Page.
 * imageUrl deve ser uma URL pública acessível.
 */
async function postPhotoToPage(imageUrl, caption) {
  if (!FB_PAGE_ACCESS_TOKEN || !FB_PAGE_ID) {
    console.warn('[facebook] FB_PAGE_ACCESS_TOKEN ou FB_PAGE_ID não configurados — post ignorado');
    return null;
  }

  const res = await fetch(`${FB_BASE}/${FB_PAGE_ID}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: imageUrl,
      caption,
      access_token: FB_PAGE_ACCESS_TOKEN
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(`[facebook] Foto falhou: ${JSON.stringify(data.error)}`);

  console.log(`[facebook] ✅ Foto publicada na Página. ID: ${data.id}`);
  return data.id;
}

// ---------------------------------------------------------------------------
// Messenger DMs
// ---------------------------------------------------------------------------

/**
 * Envia mensagem via Messenger para um usuário que interagiu com a Página.
 * recipientId = PSID (Page-Scoped User ID), vem no webhook como sender.id.
 */
async function sendMessengerMessage(recipientId, text) {
  if (!FB_PAGE_ACCESS_TOKEN) {
    console.warn('[facebook] FB_PAGE_ACCESS_TOKEN não configurado — mensagem não enviada');
    return null;
  }

  const res = await fetch(`${FB_BASE}/me/messages?access_token=${FB_PAGE_ACCESS_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(`[facebook] Messenger falhou: ${JSON.stringify(data.error)}`);

  console.log(`[facebook] Messenger enviada para ${recipientId}`);
  return data;
}

/**
 * Processa eventos de webhook do Messenger (Facebook Page Messaging).
 * Chamado pela rota POST /messenger-webhook no index.js.
 */
async function handleMessengerWebhook(body) {
  if (body.object !== 'page') {
    console.log('[facebook] Webhook ignorado — object não é page:', body.object);
    return;
  }

  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) {
      const senderId = event.sender?.id;
      const text = event.message?.text;

      // Ignorar echo (mensagens enviadas pela própria página)
      if (event.message?.is_echo) continue;
      if (!senderId || !text) continue;

      console.log(`[facebook] Messenger de ${senderId}: "${text}"`);

      try {
        const reply = await generateMessengerReply(text, senderId);
        await sendMessengerMessage(senderId, reply);
      } catch (err) {
        console.error('[facebook] Erro ao responder Messenger:', err.message);
        await sendMessengerMessage(senderId,
          '🏨 Olá! Obrigado por entrar em contato com o TorresGuest. ' +
          'Para reservas e informações rápidas, nos chame no WhatsApp: +55 11 99907-3135'
        ).catch(() => {});
      }
    }
  }
}

// ---------------------------------------------------------------------------
// GPT helpers
// ---------------------------------------------------------------------------

/**
 * Gera resposta de Messenger via GPT-4o-mini.
 */
async function generateMessengerReply(userMessage, senderId) {
  const { OpenAI } = require('openai');
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  const systemPrompt = `Você é o assistente virtual do TorresGuest, hotel boutique em São Paulo (SP), Brasil.
Responda perguntas sobre reservas, localização, preços e comodidades de forma simpática e profissional.
Para reservas ou dúvidas complexas, direcione para o WhatsApp: +55 11 99907-3135
Respostas curtas (máx 3 linhas), em português.`;

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    max_tokens: 200
  });

  return response.choices[0].message.content.trim();
}

/**
 * Gera legenda para post no Facebook (similar ao Instagram, mas pode ser mais longa).
 */
async function generateFBCaption(eventHint, availableRooms) {
  const { OpenAI } = require('openai');
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  const roomsText = availableRooms !== null
    ? `Temos ${availableRooms} quarto${availableRooms !== 1 ? 's' : ''} disponível${availableRooms !== 1 ? 'is' : ''} agora!`
    : 'Consulte disponibilidade!';

  const prompt = `Crie um post para o Facebook da página TorresGuest hotel boutique em São Paulo sobre: ${eventHint}.
${roomsText}
Regras:
- Tom amigável e convidativo, em português brasileiro
- Pode ser um pouco mais longo que Instagram (máx 400 caracteres)
- Inclua call-to-action para contato via WhatsApp ou mensagem na página
- 3-5 hashtags no final`;

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 350
  });

  return response.choices[0].message.content.trim();
}

// ---------------------------------------------------------------------------
// Auto-post Facebook (espelha o post do Instagram)
// ---------------------------------------------------------------------------

/**
 * Publica automaticamente no Facebook Page.
 * Normalmente chamado após autoPost() do instagram.js para espelhar o conteúdo.
 * imageUrl = mesma URL usada no Instagram (DALL-E URL, válida por 1h).
 */
async function autoPostToPage(imageUrl, caption) {
  try {
    const postId = await postPhotoToPage(imageUrl, caption);
    console.log(`[facebook] ✅ Auto-post espelhado no Facebook. ID: ${postId}`);
    return postId;
  } catch (err) {
    console.error('[facebook] ❌ Erro no auto-post do Facebook:', err.message);
    // Não relança — falha no FB não deve impedir post no IG
    return null;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  postTextToPage,
  postPhotoToPage,
  sendMessengerMessage,
  handleMessengerWebhook,
  generateFBCaption,
  autoPostToPage
};
