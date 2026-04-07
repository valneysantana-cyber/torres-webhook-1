'use strict';

/**
 * services/instagram.js Ã¢ÂÂ Fase 4: Instagram Integration
 *
 * Funcionalidades
 * - Publicar fotos/imagens no Instagram Business (@torresguest)
 * - Enviar e receber Direct Messages (DMs) do Instagram
 * - Verificar disponibilidade de quartos (via Stays.net) antes depostar
 * - Gerar conteÃÂºdo automÃÂ¡tico via GPT-4o-mini + DALL-E 3
 * - Trocar/renovar token de acesso (long-lived, 60 dias)
 *
 * Env vars necessÃÂ¡rias no Render:
 *   IG_ACCESS_TOKEN           Ã¢ÂÂ token gerado no portal Meta (Instagram Business Login)
 *   IG_APP_ID                 Ã¢ÂÂ ID do app OpenClaw-IG (padrÃÂ£o: 1667526337778117)
 *   IG_APP_SECRET             Ã¢ÂÂ Chave secreta do OpenClaw-IG (do portal Meta)
 *   IG_BUSINESS_ACCOUNT_ID    Ã¢ÂÂ ID da conta IG (@torresguest, padrÃÂ£o: 26082124804742800)
 */

const { OPENAI_API_KEY } = require('../config');
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

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
  if (!IG_APP_SECRET) throw new Error('[instagram] IG_APP_SECRET nÃÂ£o configurado');
  const url = `${IG_BASE}/access_token?grant_type=ig_exchange_token&client_id=${IG_APP_ID}&client_secret=${IG_APP_SECRET}&access_token=${shortToken}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`[instagram] Token exchange falhou: ${JSON.stringify(data.error)}`);
  console.log(`[instagram] Token trocado Ã¢ÂÂ expira em ${Math.round(data.expires_in / 86400)} dias`);
  return { access_token: data.access_token, expires_in: data.expires_in };
}

async function refreshLongLivedToken(token) {
  const url = `${IG_BASE}/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`[instagram] Token refresh falhou: ${JSON.stringify(data.error)}`);
  console.log(`[instagram] Token renovado Ã¢ÂÂ expira em ${Math.round(data.expires_in / 86400)} dias`);
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
    console.log(`[instagram] Container ${containerId} status: ${data.status_code} Ã¢ÂÂ aguardando...`);
    await new Promise(r => setTimeout(r, 4000));
  }
  throw new Error(`[instagram] Container ${containerId} timeout apÃÂ³s ${maxAttempts} tentativas`);
}

async function publishPost(imageUrl, caption) {
  const token = IG_ACCESS_TOKEN;
  if (!token) throw new Error('[instagram] IG_ACCESS_TOKEN nÃÂ£o configurado');

  console.log('[instagram] Criando container de mÃÂ­dia...');
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
  if (!publishData.id) throw new Error(`[instagram] PublicaÃÂ§ÃÂ£o falhou: ${JSON.stringify(publishData)}`);

  console.log(`[instagram] Ã¢ÂÂ Post publicado! ID: ${publishData.id}`);
  return publishData.id;
}

// ---------------------------------------------------------------------------
// Direct Messages
// ---------------------------------------------------------------------------

async function sendDM(recipientIgsid, text) {
  const token = IG_ACCESS_TOKEN;
  if (!token) throw new Error('[instagram] IG_ACCESS_TOKEN nÃÂ£o configurado');

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
    console.log('[instagram] Webhook ignorado Ã¢ÂÂ object nÃÂ£o ÃÂ© instagram:', body.object);
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
          'Ã°ÂÂÂ¨ OlÃÂ¡! Obrigado por entrar em contato com o TorresGuest. ' +
          'Para informaÃÂ§ÃÂµes e reservas, tambÃÂ©m pode nos chamar no WhatsApp: +55 11 99907-3135'
        ).catch(() => {});
      }
    }

    for (const change of entry.changes || []) {
      if (change.field === 'comments') {
        console.log(`[instagram] ComentÃÂ¡rio novo:`, JSON.stringify(change.value).substring(0, 100));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// GPT helpers
// ---------------------------------------------------------------------------

async function generateDMReply(userMessage, senderId) {

  const systemPrompt = `VocÃÂª ÃÂ© o assistente virtual do TorresGuest, um hotel boutique em SÃÂ£o Paulo (SP), Brasil.
Responda perguntas sobre reservas, localizaÃÂ§ÃÂ£o, preÃÂ§os e comodidades de forma simpÃÂ¡tica e profissional.
Se o hÃÂ³spede quiser reservar ou tiver dÃÂºvidas complexas, direcione para o WhatsApp: +55 11 99907-3135
Respostas devem ser curtas (mÃÂ¡x 3 linhas) e em portuguÃÂªs.`;

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

  const prompt = `Professional hotel promotional photo for TorresGuest, a modern boutique hotel in SÃÂ£o Paulo, Brazil.
Theme: ${eventHint}.
Style: warm lighting, elegant interior or SÃÂ£o Paulo cityscape, inviting atmosphere.
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

  const roomsText = availableRooms !== null
    ? `Temos ${availableRooms} quarto${availableRooms !== 1 ? 's' : ''} disponÃÂ­vel${availableRooms !== 1 ? 'is' : ''} agora!`
    : 'Consulte disponibilidade!';

  const prompt = `Crie uma legenda envolvente para o Instagram do @torresguest hotel boutique em SÃÂ£o Paulo sobre: ${eventHint}.
${roomsText}
Regras:
- Tom amigÃÂ¡vel e convidativo, em portuguÃÂªs brasileiro
- MÃÂ¡ximo 220 caracteres (sem contar hashtags)
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

async function autoPost(eventHint = 'weekend in SÃÂ£o Paulo, cultural events and gastronomy') {
  console.log('[instagram] Iniciando auto-post...');

  const available = await getAvailableRooms();
  if (available === 0) {
    console.log('[instagram] Hotel lotado hoje Ã¢ÂÂ post cancelado');
    return null;
  }

  try {
    const [imageUrl, caption] = await Promise.all([
      generatePostImage(eventHint),
      generatePostCaption(eventHint, available)
    ]);

    const postId = await publishPost(imageUrl, caption);
    console.log(`[instagram] Ã¢ÂÂ Auto-post concluÃÂ­do. ID: ${postId}`);
    return postId;
  } catch (err) {
    console.error('[instagram] Ã¢ÂÂ Erro no auto-post:', err.message);
    throw err;
  }
}


// ---------------------------------------------------------------------------
// Event hint for DALL-E / GPT social posts (Fase 4 — 2026-04-06)
// ---------------------------------------------------------------------------
function getSPEventHint() {
  const now = new Date();
  const brt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const year  = parseInt(brt.find(p => p.type === 'year').value);
  const month = parseInt(brt.find(p => p.type === 'month').value);
  const day   = parseInt(brt.find(p => p.type === 'day').value);
  const today = new Date(year, month - 1, day);

  const EVENTS_2026 = [
    { date: new Date(2026,0,31),  hint: "show de rock alternativo no Allianz Parque, proximidade do TorresGuest Perdizes" },
    { date: new Date(2026,1,5),   hint: "show de rock My Chemical Romance no Allianz Parque São Paulo, ao lado de Perdizes" },
    { date: new Date(2026,1,6),   hint: "segundo dia de My Chemical Romance no Allianz Parque Perdizes São Paulo" },
    { date: new Date(2026,1,13),  hint: "Carnaval em São Paulo, blocos de rua em Perdizes, festa e folia na cidade" },
    { date: new Date(2026,1,15),  hint: "domingo de Carnaval em São Paulo, celebração vibrante em Perdizes" },
    { date: new Date(2026,1,17),  hint: "encerramento do Carnaval em São Paulo, último dia de folia em Perdizes" },
    { date: new Date(2026,1,20),  hint: "show de Bad Bunny no Allianz Parque São Paulo, perto de Perdizes" },
    { date: new Date(2026,1,21),  hint: "segundo show de Bad Bunny no Allianz Parque Perdizes São Paulo" },
    { date: new Date(2026,2,14),  hint: "show de Luan Santana no Allianz Parque São Paulo" },
    { date: new Date(2026,2,28),  hint: "Gilberto Gil, última turnê no Allianz Parque São Paulo Perdizes" },
    { date: new Date(2026,3,4),   hint: "Monsters of Rock com Guns N Roses no Allianz Parque São Paulo" },
    { date: new Date(2026,3,5),   hint: "Páscoa em São Paulo, chocolate, família e hospitalidade em Perdizes" },
    { date: new Date(2026,3,9),   hint: "espetáculo de Ara Malikian no Teatro Bradesco Perdizes São Paulo" },
    { date: new Date(2026,3,11),  hint: "Gop Tun Festival na Arena Pacaembu próximo a Perdizes São Paulo" },
    { date: new Date(2026,3,15),  hint: "peça O Céu da Língua com Gregório Duvivier no Teatro Bradesco São Paulo" },
    { date: new Date(2026,3,25),  hint: "show de João Gomes, Jota.pê e Mestrinho no Allianz Parque São Paulo" },
    { date: new Date(2026,3,30),  hint: "Shen Yun Performing Arts no Teatro Bradesco São Paulo Perdizes" },
    { date: new Date(2026,4,9),   hint: "show de Djavan no Allianz Parque São Paulo próximo ao hotel TorresGuest Perdizes" },
    { date: new Date(2026,4,10),  hint: "Dia das Mães em São Paulo, hospitalidade, amor e aconchego no TorresGuest Perdizes" },
    { date: new Date(2026,4,13),  hint: "Jonas Brothers JONAS20 tour no Allianz Parque São Paulo" },
    { date: new Date(2026,4,16),  hint: "show de Korn e Spiritbox no Allianz Parque São Paulo Perdizes" },
    { date: new Date(2026,4,24),  hint: "Meli Music 3 festival na Arena Pacaembu São Paulo próximo a Perdizes" },
    { date: new Date(2026,5,12),  hint: "Dia dos Namorados em São Paulo, romance e charme em Perdizes" },
    { date: new Date(2026,5,20),  hint: "Festa Junina em São Paulo, forró, comidas típicas e clima de interior em Perdizes" },
    { date: new Date(2026,6,11),  hint: "show de Liniker no Allianz Parque São Paulo" },
    { date: new Date(2026,6,25),  hint: "Xuxa – O Último Voo da Nave no Allianz Parque São Paulo" },
    { date: new Date(2026,7,1),   hint: "Manifesto Musical festival na Arena Pacaembu São Paulo próximo a Perdizes" },
    { date: new Date(2026,7,9),   hint: "Dia dos Pais em São Paulo, viagem em família e aconchego no TorresGuest Perdizes" },
    { date: new Date(2026,8,7),   hint: "feriado nacional, turismo em São Paulo, Perdizes e região central da cidade" },
    { date: new Date(2026,8,22),  hint: "início da primavera em São Paulo, flores, passeios ao ar livre em Perdizes" },
    { date: new Date(2026,9,10),  hint: "show de Zayn no Allianz Parque São Paulo Perdizes" },
    { date: new Date(2026,9,25),  hint: "Iron Maiden – Run For Your Lives World Tour no Allianz Parque São Paulo" },
    { date: new Date(2026,9,27),  hint: "segundo show de Iron Maiden no Allianz Parque São Paulo" },
    { date: new Date(2026,10,27), hint: "Black Friday em São Paulo, compras, turismo e hospedagem especial no TorresGuest" },
    { date: new Date(2026,10,28), hint: "show no Allianz Parque São Paulo em novembro, hospede-se no TorresGuest Perdizes" },
    { date: new Date(2026,11,25), hint: "Natal em São Paulo, decoração de Perdizes, hospitalidade e calor humano no TorresGuest" },
    { date: new Date(2026,11,31), hint: "Réveillon e virada de ano em São Paulo, festa, fogos e celebração em Perdizes" },
  ];

  const MONTHLY_THEMES = [
    "verão em São Paulo, praia urbana e hospedagem executiva em Perdizes",
    "fevereiro agitado em SP com shows e Carnaval na vizinhança de Perdizes",
    "outono chegando a São Paulo, cultura e shows no Allianz Parque Perdizes",
    "abril em SP: Páscoa, shows e temperatura agradável em Perdizes",
    "maio em SP: Dia das Mães, Jonas Brothers e eventos culturais em Perdizes",
    "festa junina e inverno chegando em São Paulo, aconchego no TorresGuest",
    "julho: férias escolares e shows no Allianz Parque, hospede-se em Perdizes",
    "agosto: inverno paulistano, Dia dos Pais e eventos culturais em Perdizes",
    "primavera chegando a SP, passeios ao ar livre e gastronomia em Perdizes",
    "outubro: shows internacionais no Allianz, Outubro Rosa, SP em plena forma",
    "novembro: virada do ano se aproxima, shows e Black Friday em SP Perdizes",
    "dezembro: Natal, Réveillon e hospitalidade especial do TorresGuest Perdizes",
  ];

  let closestEvent = null;
  let closestDiff = Infinity;
  for (const ev of EVENTS_2026) {
    const diff = Math.round((ev.date - today) / (1000 * 60 * 60 * 24));
    if (diff >= -1 && diff <= 10) {
      if (Math.abs(diff) < Math.abs(closestDiff)) {
        closestDiff = diff;
        closestEvent = ev;
      }
    }
  }

  if (closestEvent) {
    const dayLabel = closestDiff === 0 ? 'hoje'
                   : closestDiff === 1 ? 'amanhã'
                   : closestDiff === -1 ? 'ontem'
                   : closestDiff > 0 ? `em ${closestDiff} dias`
                   : `há ${Math.abs(closestDiff)} dias`;
    return `${closestEvent.hint} (${dayLabel}, ${closestDiff <= 0 ? 'aproveite' : 'reserve já'})`;
  }
  return MONTHLY_THEMES[month - 1];
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
  refreshLongLivedToken,
  getSPEventHint
};