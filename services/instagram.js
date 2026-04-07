'use strict';
/**
 * services/instagram.js — Fase 4: Instagram Integration
 *
 * Funcionalidades:
 * - Publicar fotos/imagens no Instagram Business (@torresguest)
 * - Usar fotos reais do hotel (GitHub) + pontos turísticos de SP (Wikipedia API)
 * - Enviar e receber Direct Messages (DMs) do Instagram
 * - Verificar disponibilidade de quartos (via Stays.net) antes de postar
 * - Gerar conteúdo automático via GPT-4o-mini (legenda) + DALL-E 3 (fallback)
 * - Trocar/renovar token de acesso (long-lived, 60 dias)
 *
 * Env vars necessárias no Render:
 *   IG_ACCESS_TOKEN            — token gerado no portal Meta (Instagram Business Login)
 *   IG_APP_ID                  — ID do app OpenClaw-IG (padrão: 1667526337778117)
 *   IG_APP_SECRET              — Chave secreta do OpenClaw-IG (do portal Meta)
 *   IG_BUSINESS_ACCOUNT_ID     — ID da conta IG (@torresguest, padrão: 26082124804742800)
 */

const { OPENAI_API_KEY } = require('../config');

const IG_ACCESS_TOKEN        = process.env.IG_ACCESS_TOKEN;
const IG_APP_ID              = process.env.IG_APP_ID || '1667526337778117';
const IG_APP_SECRET          = process.env.IG_APP_SECRET;
const IG_BUSINESS_ACCOUNT_ID = process.env.IG_BUSINESS_ACCOUNT_ID || '26082124804742800';
const IG_API_VERSION         = 'v25.0';
const IG_BASE                = `https://graph.instagram.com/${IG_API_VERSION}`;
const FR_BASE                = `https://graph.facebook.com/${IG_API_VERSION}`;

// ---------------------------------------------------------------------------
// SP Landmarks — pontos turísticos próximos ao TorresGuest
// Imagens obtidas dinamicamente via Wikipedia API (gratuito, sem key)
// ---------------------------------------------------------------------------
const SP_LANDMARKS = [
  { article: 'Museu de Arte de São Paulo',              desc: 'MASP na Avenida Paulista, São Paulo' },
  { article: 'Avenida Paulista',                        desc: 'Avenida Paulista, coração cultural e financeiro de SP' },
  { article: 'Parque do Ibirapuera',                    desc: 'Parque Ibirapuera, pulmão verde de São Paulo' },
  { article: 'Theatro Municipal de São Paulo',          desc: 'Theatro Municipal de São Paulo no centro histórico' },
  { article: 'Mercado Municipal de São Paulo',          desc: 'Mercadão de São Paulo, gastronomia e cultura' },
  { article: 'Pinacoteca do Estado de São Paulo',       desc: 'Pinacoteca do Estado de São Paulo' },
  { article: 'Allianz Parque',                          desc: 'Allianz Parque, a poucos minutos do TorresGuest' },
  { article: 'Liberdade (São Paulo)',                   desc: 'Bairro da Liberdade — gastronomia japonesa e cultura oriental' },
  { article: 'Museu do Ipiranga',                       desc: 'Museu do Ipiranga — símbolo histórico de São Paulo' },
  { article: 'Consolação (distrito de São Paulo)',      desc: 'Consolação, bairro do TorresGuest em São Paulo' },
];

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------
/** Troca token de curta duração (1h) por token de longa duração (60 dias). */
async function exchangeForLongLivedToken(shortToken) {
  if (!IG_APP_SECRET) throw new Error('[instagram] IG_APP_SECRET não configurado — necessário para troca de token');
  const url = `${IG_BASE}/access_token?grant_type=ig_exchange_token&client_id=${IG_APP_ID}&client_secret=${IG_APP_SECRET}&access_token=${shortToken}`;
  const res  = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`[instagram] Token exchange falhou: ${JSON.stringify(data.error)}`);
  console.log(`[instagram] Token trocado — expira em ${Math.round(data.expires_in / 86400)} dias`);
  return { access_token: data.access_token, expires_in: data.expires_in };
}

/** Renova token de longa duração antes de expirar. */
async function refreshLongLivedToken(token) {
  const url  = `${IG_BASE}/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`;
  const res  = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`[instagram] Token refresh falhou: ${JSON.stringify(data.error)}`);
  console.log(`[instagram] Token renovado — expira em ${Math.round(data.expires_in / 86400)} dias`);
  return { access_token: data.access_token, expires_in: data.expires_in };
}

// ---------------------------------------------------------------------------
// Content Publishing API (dois passos: container → publish)
// ---------------------------------------------------------------------------
/** Aguarda processamento do container de mídia (polling status). */
async function waitForContainer(containerId, token, maxAttempts = 15) {
  for (let i = 0; i < maxAttempts; i++) {
    const res  = await fetch(`${IG_BASE}/${containerId}?fields=status_code,status&access_token=${token}`);
    const data = await res.json();
    if (data.status_code === 'FINISHED') { console.log(`[instagram] Container ${containerId} pronto`); return true; }
    if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') throw new Error(`[instagram] Container ${containerId} com erro: ${data.status}`);
    console.log(`[instagram] Container ${containerId} status: ${data.status_code} — aguardando...`);
    await new Promise(r => setTimeout(r, 4000));
  }
  throw new Error(`[instagram] Container ${containerId} timeout após ${maxAttempts} tentativas`);
}

/**
 * Publica uma imagem no Instagram Business (@torresguest).
 * imageUrl deve ser uma URL pública HTTPS acessível pelo Meta.
 */
async function publishPost(imageUrl, caption) {
  const token = IG_ACCESS_TOKEN;
  if (!token) throw new Error('[instagram] IG_ACCESS_TOKEN não configurado');

  console.log('[instagram] Criando container de mídia...');
  const containerRes  = await fetch(`${IG_BASE}/${IG_BUSINESS_ACCOUNT_ID}/media`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({ image_url: imageUrl, caption, access_token: token })
  });
  const containerData = await containerRes.json();
  if (!containerData.id) throw new Error(`[instagram] Container falhou: ${JSON.stringify(containerData)}`);
  const containerId = containerData.id;
  console.log(`[instagram] Container criado: ${containerId}`);

  await waitForContainer(containerId, token);

  console.log('[instagram] Publicando post...');
  const publishRes  = await fetch(`${IG_BASE}/${IG_BUSINESS_ACCOUNT_ID}/media_publish`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({ creation_id: containerId, access_token: token })
  });
  const publishData = await publishRes.json();
  if (!publishData.id) throw new Error(`[instagram] Publicação falhou: ${JSON.stringify(publishData)}`);
  console.log(`[instagram] ✅ Post publicado! ID: ${publishData.id}`);
  return publishData.id;
}

// ---------------------------------------------------------------------------
// Direct Messages
// ---------------------------------------------------------------------------
/** Envia resposta de DM para um usuário do Instagram. */
async function sendDM(recipientIgsid, text) {
  const token = IG_ACCESS_TOKEN;
  if (!token) throw new Error('[instagram] IG_ACCESS_TOKEN não configurado');
  const res  = await fetch(`${IG_BASE}/me/messages`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ recipient: { id: recipientIgsid }, message: { text }, access_token: token })
  });
  const data = await res.json();
  if (data.error) throw new Error(`[instagram] DM falhou: ${JSON.stringify(data.error)}`);
  console.log(`[instagram] DM enviada para ${recipientIgsid}`);
  return data;
}

/** Processa eventos de webhook do Instagram (mensagens + stories + comentários). */
async function handleInstagramWebhook(body) {
  if (body.object !== 'instagram') { console.log('[instagram] Webhook ignorado — object não é instagram:', body.object); return; }
  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) {
      const senderId = event.sender?.id;
      const text     = event.message?.text;
      if (!senderId || !text) continue;
      console.log(`[instagram] DM de ${senderId}: "${text}"`);
      try {
        const reply = await generateDMReply(text, senderId);
        await sendDM(senderId, reply);
      } catch (err) {
        console.error('[instagram] Erro ao responder DM:', err.message);
        await sendDM(senderId, '👋 Olá! Obrigado por entrar em contato com o TorresGuest. Para informações e reservas, também pode nos chamar no WhatsApp: +55 11 99907-3135').catch(() => {});
      }
    }
    for (const change of entry.changes || []) {
      if (change.field === 'comments') console.log('[instagram] Comentário novo:', JSON.stringify(change.value).substring(0, 100));
    }
  }
}

// ---------------------------------------------------------------------------
// GPT helpers
// ---------------------------------------------------------------------------
/** Gera resposta de DM via GPT-4o-mini. */
async function generateDMReply(userMessage, senderId) {
  const systemPrompt = `Você é o assistente virtual do TorresGuest, um hotel boutique em São Paulo (SP), Brasil.
Responda perguntas sobre reservas, localização, preços e comodidades de forma simpática e profissional.
Se o hóspede quiser reservar ou tiver dúvidas complexas, direcione para o WhatsApp: +55 11 99907-3135
Respostas devem ser curtas (máx 3 linhas) e em português.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body:    JSON.stringify({ model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }], max_tokens: 200 })
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`[instagram] GPT DM reply falhou: ${t}`); }
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

/**
 * Gera imagem via DALL-E 3 (fallback quando fotos reais não estão disponíveis).
 * Retorna URL temporária válida por ~1 hora.
 */
async function generatePostImage(eventHint) {
  const prompt = `Professional hotel promotional photo for TorresGuest, a modern boutique hotel in São Paulo, Brazil. Theme: ${eventHint}. Style: warm lighting, elegant interior or São Paulo cityscape, inviting atmosphere. No text overlays. Instagram square format. High quality photography style.`;
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body:    JSON.stringify({ model: 'dall-e-3', prompt, size: '1024x1024', quality: 'standard', n: 1 })
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`[instagram] DALL-E geração falhou: ${t}`); }
  const data = await res.json();
  console.log('[instagram] Imagem gerada pelo DALL-E (fallback)');
  return data.data[0].url;
}

/**
 * Gera legenda para post no Instagram via GPT.
 * photoDescription descreve o que aparece na foto para que a legenda seja coerente.
 */
async function generatePostCaption(eventHint, availableRooms, photoDescription = null) {
  const roomsText  = availableRooms !== null
    ? `Temos ${availableRooms} quarto${availableRooms !== 1 ? 's' : ''} disponível${availableRooms !== 1 ? 'is' : ''} agora!`
    : 'Consulte disponibilidade!';
  const photoCtx   = photoDescription ? `\nA foto mostra: ${photoDescription}.` : '';
  const prompt     = `Crie uma legenda envolvente para o Instagram do @torresguest hotel boutique em São Paulo sobre: ${eventHint}.${photoCtx} ${roomsText}
Regras:
- Tom amigável e convidativo, em português brasileiro
- A legenda deve ser coerente com o que aparece na foto
- Máximo 220 caracteres (sem contar hashtags)
- Inclua call-to-action (link na bio ou WhatsApp)
- Termine com 5-7 hashtags relevantes sobre SP e hospedagem
- Use 2-3 emojis adequados`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body:    JSON.stringify({ model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 300 })
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`[instagram] GPT caption falhou: ${t}`); }
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

// ---------------------------------------------------------------------------
// Foto seleção: fotos reais do hotel (GitHub) + pontos de SP (Wikipedia)
// ---------------------------------------------------------------------------

/**
 * Busca imagem principal de um artigo do Wikipedia via API pública.
 * Retorna URL HTTPS da imagem em 1200px ou null se não encontrar.
 */
async function getWikipediaImageUrl(articleTitle) {
  try {
    const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(articleTitle)}&prop=pageimages&format=json&pithumbsize=1200&pilicense=free&origin=*`;
    const res  = await fetch(apiUrl, { headers: { 'User-Agent': 'torres-webhook/1.0' } });
    if (!res.ok) return null;
    const data  = await res.json();
    const pages = Object.values(data.query?.pages || {});
    const imgUrl = pages[0]?.thumbnail?.source;
    if (!imgUrl || /\.svg$/i.test(imgUrl)) return null; // ignorar SVGs
    console.log(`[instagram] Foto SP via Wikipedia: ${articleTitle}`);
    return imgUrl;
  } catch (e) {
    console.error('[instagram] Wikipedia API erro:', e.message);
    return null;
  }
}

/**
 * Busca foto aleatória da pasta assets/hotel-photos no GitHub.
 * Retorna { url, desc } ou null se a pasta ainda não existir.
 *
 * Para adicionar fotos: faça push para assets/hotel-photos/<pasta>/<arquivo.jpg>
 * Exemplo: assets/hotel-photos/hotel/foto1.jpeg
 *          assets/hotel-photos/quarto-1204/IMG_8950.jpg
 */
async function getRandomHotelPhoto() {
  try {
    const API = 'https://api.github.com/repos/valneysantana-cyber/torres-webhook/contents/assets/hotel-photos';
    const res  = await fetch(API, { headers: { 'User-Agent': 'torres-webhook/1.0' } });
    if (!res.ok) return null;
    const entries = await res.json();
    const dirs    = entries.filter(e => e.type === 'dir');
    if (dirs.length === 0) return null;

    const folder = dirs[Math.floor(Math.random() * dirs.length)];
    const res2   = await fetch(folder.url, { headers: { 'User-Agent': 'torres-webhook/1.0' } });
    if (!res2.ok) return null;
    const files  = await res2.json();
    const images = files.filter(f => f.type === 'file' && /\.(jpg|jpeg|png|webp)$/i.test(f.name));
    if (images.length === 0) return null;

    const file   = images[Math.floor(Math.random() * images.length)];
    const rawUrl = `https://raw.githubusercontent.com/valneysantana-cyber/torres-webhook/master/assets/hotel-photos/${folder.name}/${encodeURIComponent(file.name)}`;
    const desc   = folder.name === 'hotel'
      ? 'área comum do Hotel TorresGuest em São Paulo'
      : `quarto ${folder.name.replace('quarto-', '')} do Hotel TorresGuest`;

    console.log(`[instagram] Foto do hotel: ${rawUrl}`);
    return { url: rawUrl, desc };
  } catch (e) {
    console.error('[instagram] Erro ao buscar foto do hotel no GitHub:', e.message);
    return null;
  }
}

/**
 * Seleciona a melhor foto para o post:
 *   60% → foto real do hotel (pasta assets/hotel-photos no GitHub)
 *   40% → ponto turístico de SP via Wikipedia API
 *   fallback → DALL-E 3 (se ambos falharem)
 *
 * Retorna { url, desc, source } onde source = 'hotel' | 'landmark' | 'dalle'
 */
async function getPhotoForPost(eventHint) {
  // Tentar foto do hotel (60%)
  if (Math.random() < 0.6) {
    const hotel = await getRandomHotelPhoto();
    if (hotel) return { ...hotel, source: 'hotel' };
  }

  // Tentar landmark de SP
  const landmark = SP_LANDMARKS[Math.floor(Math.random() * SP_LANDMARKS.length)];
  const imgUrl   = await getWikipediaImageUrl(landmark.article);
  if (imgUrl) return { url: imgUrl, desc: landmark.desc, source: 'landmark' };

  // Fallback: DALL-E 3
  console.log('[instagram] Fotos reais indisponíveis — gerando com DALL-E...');
  const dalleUrl = await generatePostImage(eventHint);
  return { url: dalleUrl, desc: `hotel boutique TorresGuest em São Paulo — ${eventHint}`, source: 'dalle' };
}

// ---------------------------------------------------------------------------
// Disponibilidade de quartos
// ---------------------------------------------------------------------------
/** Verifica quantos quartos estão disponíveis hoje. Retorna 0-8 ou null. */
async function getAvailableRooms() {
  try {
    const { fetchTodayAllActiveGuests } = require('./stays');
    const { arrivals, midStay } = await fetchTodayAllActiveGuests();
    const occupied  = (arrivals || []).length + (midStay || []).length;
    const available = Math.max(0, 8 - occupied);
    console.log(`[instagram] Disponibilidade: ${occupied} ocupados, ${available} livres`);
    return available;
  } catch (err) {
    console.error('[instagram] Erro ao verificar disponibilidade:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Auto-post: fluxo completo (cron sexta 11:00 BRT ou trigger manual)
// ---------------------------------------------------------------------------
/**
 * Fluxo completo de post automático:
 *   1. Verifica disponibilidade
 *   2. Seleciona foto real (hotel ou SP) — DALL-E como fallback
 *   3. Gera legenda coerente com a foto via GPT
 *   4. Publica no Instagram
 * Retorna ID do post ou null se cancelado/erro.
 */
async function autoPost(eventHint = 'fim de semana em São Paulo, eventos culturais e gastronomia') {
  console.log('[instagram] Iniciando auto-post...');
  const available = await getAvailableRooms();

  try {
    const photo   = await getPhotoForPost(eventHint);
    const caption = await generatePostCaption(eventHint, available, photo.desc);

    console.log(`[instagram] Foto selecionada: ${photo.source} — ${photo.desc}`);
    const postId = await publishPost(photo.url, caption);
    console.log(`[instagram] ✅ Auto-post concluído. ID: ${postId} (fonte: ${photo.source})`);
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
  getPhotoForPost,
  getRandomHotelPhoto,
  getWikipediaImageUrl,
  exchangeForLongLivedToken,
  refreshLongLivedToken
};
