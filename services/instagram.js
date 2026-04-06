'use strict';

/**
 * services/instagram.js — Fase 4: Instagram Integration
 *
 * Funcionalidades:
 * - Publicar fotos/imagens no Instagram Business (@torresguest)
 * - Enviar e receber Direct Messages (DMs) do Instagram
 * - Verificar disponibilidade de quartos (via Stays.net) antes de postar
 * - Gerar conteúdo automático via GPT-4o-mini + DALL-E 3
 * - Trocar/renovar token de acesso (long-lived, 60 dias)
 *
 * Env vars necessárias no Render:
 *   IG_ACCESS_TOKEN           — token gerado no portal Meta (Instagram Business Login)
 *   IG_APP_ID                 — ID do app OpenClaw-IG (padrão: 1667526337778117)
 *   IG_APP_SECRET             — Chave secreta do OpenClaw-IG (do portal Meta)
 *   IG_BUSINESS_ACCOUNT_ID    — ID da conta IG (@torresguest, padrão: 26082124804742800)
 */

const { OPENAI_API_KEY } = require('../config');

const IG_ACCESS_TOKEN         = process.env.IG_ACCESS_TOKEN;
const IG_APP_ID               = process.env.IG_APP_ID || '1667526337778117';
const IG_APP_SECRET           = process.env.IG_APP_SECRET;
const IG_BUSINESS_ACCOUNT_ID  = process.env.IG_BUSINESS_ACCOUNT_ID || '26082124804742800';
const IG_API_VERSION          = 'v25.0';
const IG_BASE                 = `https://graph.instagram.com/${IG_API_VERSION}`;
const FB_BASE                 = `https://graph.facebook.com/${IG_API_VERSION}`;

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

async function exchangeForLongLivedToken(shortToken) {
  if (!IG_APP_SECRET) throw new Error('[instagram] IG_APP_SECRET não configurado');
  const url = `${IG_BASE}/access_token?grant_type=ig_exchange_token&client_id=${IG_APP_ID}&client_secret=${IG_APP_SECRET}&access_token=${shortToken}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`[instagram] Token exchange falhou: ${JSON.stringify(data.error)}`);
  console.log(`[instagram] Token trocado — expira em ${Math.round(data.expires_in / 86400)} dias`);
  return { access_token: data.access_token, expires_in: data.expires_in };
}

async function refreshLongLivedToken(token) {
  const url = `${IG_BASE}/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`[instagram] Token refresh falhou: ${JSON.stringify(data.error)}`);
  console.log(`[instagram] Token renovado — expira em ${Math.round(data.expires_in / 86400)} dias`);
  return { access_token: data.access_token, expires_in: data.expires_in };
}

// ---------------------------------------------------------------------------
// Content Publishing API
// ---------------------------------------------------------------------------

async function waitForContainer(containerId, token, maxAttempts = 15) {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${IG_BASE}/${containerId}?fields=status_code,status&access_token=${token}`);
    const data = await res.json();
    if (data.status_code === 'FINISHED') {
      console.log(`[instagram] Container ${containerId} pronto`);
      return true;
    }
    if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') {
      throw new Error(`[instagram] Container ${containerId} com erro: ${data.status}`);
    }
    console.log(`[instagram] Container ${containerId} status: ${data.status_code} — aguardando...`);
    await new Promise(r => setTimeout(r, 4000));
  }
  throw new Error(`[instagram] Container ${containerId} timeout após ${maxAttempts} tentativas`);
}

async function publishPost(imageUrl, caption) {
  const token = IG_ACCESS_TOKEN;
  if (!token) throw new Error('[instagram] IG_ACCESS_TOKEN não configurado');

  console.log('[instagram] Criando container de mídia...');
  const containerRes = await fetch(`${IG_BASE}/${IG_BUSINESS_ACCOUNT_ID}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ image_url: imageUrl, caption, access_token: token })
  });
  const containerData = await containerRes.json();
  if (!containerData.id) throw new Error(`[instagram] Container falhou: ${JSON.stringify(containerData)}`);

  const containerId = containerData.id;
  console.log(`[instagram] Container criado: ${containerId}`);

  await waitForContainer(containerId, token);

  console.log('[instagram] Publicando post...');
  const publishRes = await fetch(`${IG_BASE}/${IG_BUSINESS_ACCOUNT_ID}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ creation_id: containerId, access_token: token })
  });
  const publishData = await publishRes.json();
  if (!publishData.id) throw new Error(`[instagram] Publicação falhou: ${JSON.stringify(publishData)}`);

  console.log(`[instagram] ✅ Post publicado! ID: ${publishData.id}`);
  return publishData.id;
}

// ---------------------------------------------------------------------------
// Direct Messages
// ---------------------------------------------------------------------------

async function sendDM(recipientIgsid, text) {
  const token = IG_ACCESS_TOKEN;
  if (!token) throw new Error('[instagram] IG_ACCESS_TOKEN não configurado');

  const res = await fetch(`${IG_BASE}/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientIgsid },
      message: { text },
      access_token: token
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(`[instagram] DM falhou: ${JSON.stringify(data.error)}`);
  console.log(`[instagram] DM enviada para ${recipientIgsid}`);
  return data;
}

async function handleInstagramWebhook(body) {
  if (body.object !== 'instagram') {
    console.log('[instagram] Webhook ignorado — object não é instagram:', body.object);
    return;
  }

  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) {
      const senderId = event.sender?.id;
      const text = event.message?.text;
      if (!senderId || !text) continue;

      console.log(`[instagram] DM de ${senderId}: "${text}"`);

      try {
        const reply = await generateDMReply(text, senderId);
        await sendDM(senderId, reply);
      } catch (err) {
        console.error('[instagram] Erro ao responder DM:', err.message);
        await sendDM(senderId,
          '🏨 Olá! Obrigado por entrar em contato com o TorresGuest. ' +
          'Para informações e reservas, também pode nos chamar no WhatsApp: +55 11 99907-3135'
        ).catch(() => {});
      }
    }

    for (const change of entry.changes || []) {
      if (change.field === 'comments') {
        console.log(`[instagram] Comentário novo:`, JSON.stringify(change.value).substring(0, 100));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// GPT helpers
// ---------------------------------------------------------------------------

async function generateDMReply(userMessage, senderId) {
  const { OpenAI } = require('openai');
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  const systemPrompt = `Você é o assistente virtual do TorresGuest, um hotel boutique em São Paulo (SP), Brasil.
Responda perguntas sobre reservas, localização, preços e comodidades de forma simpática e profissional.
Se o hóspede quiser reservar ou tiver dúvidas complexas, direcione para o WhatsApp: +55 11 99907-3135
Respostas devem ser curtas (máx 3 linhas) e em português.`;

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

async function generatePostImage(eventHint) {
  const { OpenAI } = require('openai');
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  const prompt = `Professional hotel promotional photo for TorresGuest, a modern boutique hotel in São Paulo, Brazil.
Theme: ${eventHint}.
Style: warm lighting, elegant interior or São Paulo cityscape, inviting atmosphere.
No text overlays. Instagram square format. High quality photography style.`;

  const response = await openai.images.generate({
    model: 'dall-e-3',
    prompt,
    size: '1024x1024',
    quality: 'standard',
    n: 1
  });

  const imageUrl = response.data[0].url;
  console.log(`[instagram] Imagem gerada pelo DALL-E`);
  return imageUrl;
}

async function generatePostCaption(eventHint, availableRooms) {
  const { OpenAI } = require('openai');
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  const roomsText = availableRooms !== null
    ? `Temos ${availableRooms} quarto${availableRooms !== 1 ? 's' : ''} disponível${availableRooms !== 1 ? 'is' : ''} agora!`
    : 'Consulte disponibilidade!';

  const prompt = `Crie uma legenda envolvente para o Instagram do @torresguest hotel boutique em São Paulo sobre: ${eventHint}.
${roomsText}
Regras:
- Tom amigável e convidativo, em português brasileiro
- Máximo 220 caracteres (sem contar hashtags)
- Inclua call-to-action (link na bio ou WhatsApp)
- Termine com 5-7 hashtags relevantes sobre SP e hospedagem
- Use 2-3 emojis adequados`;

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 300
  });

  return response.choices[0].message.content.trim();
}

// ---------------------------------------------------------------------------
// Disponibilidade de quartos
// ---------------------------------------------------------------------------

async function getAvailableRooms() {
  try {
    const { fetchTodayAllActiveGuests } = require('./stays');
    const { arrivals, midStay } = await fetchTodayAllActiveGuests();
    const occupied = (arrivals || []).length + (midStay || []).length;
    const available = Math.max(0, 8 - occupied);
    console.log(`[instagram] Disponibilidade: ${occupied} ocupados, ${available} livres`);
    return available;
  } catch (err) {
    console.error('[instagram] Erro ao verificar disponibilidade:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Auto-post
// ---------------------------------------------------------------------------

async function autoPost(eventHint = 'weekend in São Paulo, cultural events and gastronomy') {
  console.log('[instagram] Iniciando auto-post...');

  const available = await getAvailableRooms();
  if (available === 0) {
    console.log('[instagram] Hotel lotado hoje — post cancelado');
    return null;
  }

  try {
    const [imageUrl, caption] = await Promise.all([
      generatePostImage(eventHint),
      generatePostCaption(eventHint, available)
    ]);

    const postId = await publishPost(imageUrl, caption);
    console.log(`[instagram] ✅ Auto-post concluído. ID: ${postId}`);
    return postId;
  } catch (err) {
    console.error('[instagram] ❌ Erro no auto-post:', err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  publishPost,
  sendDM,
  handleInstagramWebhook,
  autoPost,
  generatePostImage,
  generatePostCaption,
  getAvailableRooms,
  exchangeForLongLivedToken,
  refreshLongLivedToken
};
