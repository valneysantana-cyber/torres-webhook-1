'use strict';

/**
 * torres-webhook Ã¢ÂÂ entry point
 *
 * Responsibilities:
 * - Boot Express server
 * - Register WhatsApp webhook routes (GET verify + POST receive)
 * - Register Instagram webhook routes (GET verify + POST receive)
 * - Register Messenger webhook routes (GET verify + POST receive
 * - Schedule dailyCheckinDispatch at 08:00 BRT every day
 * - Schedule dailyCheckoutSync at 10:00 BRT every day
 * - Schedule socialMediaPost at 11:00 BRT on Fridays (when rooms available)
 * - Expose POST /internal/dispatch for manual triggers (protected by DISPATCH_SECRET)
 * - Expose POST /internal/send-campaign for VPS campaign triggers
 * - Expose POST /internal/social-post for manual social media post trigger
 */

const express    = require('express');
const bodyParser = require('body-parser');

const { PORT, VERIFY_TOKEN, DISPATCH_SECRET } = require('./config');
const { handleIncoming }       = require('./handlers/whatsapp');
const { dailyCheckinDispatch } = require('./services/dispatch');
const { dailyCheckoutSync }    = require('./services/checkout');
const { sendWhatsAppText }     = require('./services/whatsapp');
const { handleInstagramWebhook, autoPost, getAvailableRooms } = require('./services/instagram');
const { handleMessengerWebhook, generateFBCaption, autoPostToPage } = require('./services/facebook');
const { generatePostImage, generatePostCaption } = require('./services/instagram');
const { startEmailMonitor } = require('./services/emailMonitor');
const { connectDB } = require('./services/db');

const app = express();
app.use(bodyParser.json());

// ---- health check ---------------------------------------------------------
app.get('/', (_req, res) => {
  res.status(200).send('torres-webhook online');
});

// ===========================================================================
// WHATSAPP WEBHOOK
// ===========================================================================

app.get('/whatsapp-webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    console.log('WhatsApp verification failed', { mode, token });
    res.sendStatus(403);
  }
});

app.post('/whatsapp-webhook', async (req, res) => {
  res.status(200).send({ status: 'received' });
  try {
    await handleIncoming(req.body);
  } catch (err) {
    console.error('Failed to handle WhatsApp webhook payload', err);
  }
});

// ===========================================================================
// INSTAGRAM WEBHOOK
// ===========================================================================

app.get('/instagram-webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Instagram webhook verified');
    res.status(200).send(challenge);
  } else {
    console.log('Instagram verification failed', { mode, token });
    res.sendStatus(403);
  }
});

app.post('/instagram-webhook', async (req, res) => {
  res.status(200).send({ status: 'received' });
  try {
    await handleInstagramWebhook(req.body);
  } catch (err) {
    console.error('[instagram] Failed to handle webhook payload', err);
  }
});

// ===========================================================================
// MESSENGER WEBHOOK (Facebook Page Messaging)
// ===========================================================================

app.get('/messenger-webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Messenger webhook verified');
    res.status(200).send(challenge);
  } else {
    console.log('Messenger verification failed', { mode, token });
    res.sendStatus(403);
  }
});

app.post('/messenger-webhook', async (req, res) => {
  res.status(200).send({ status: 'received' });
  try {
    await handleMessengerWebhook(req.body);
  } catch (err) {
    console.error('[facebook] Failed to handle Messenger webhook payload', err);
  }
});

// ===========================================================================
// INTERNAL ENDPOINTS (protected)
// ===========================================================================

// VerificaÃÂ§ÃÂ£o de secret para endpoints internos
function checkSecret(req, res) {
  const secret = req.headers['x-dispatch-secret'] || req.query.secret;
  if (DISPATCH_SECRET && secret !== DISPATCH_SECRET) {
    res.sendStatus(401);
    return false;
  }
  return true;
}

// ---- manual dispatch trigger (WhatsApp daily report) ----------------------
app.post('/internal/dispatch', async (req, res) => {
  if (!checkSecret(req, res)) return;
  res.status(200).send({ status: 'dispatch started' });
  try {
    await dailyCheckinDispatch();
  } catch (err) {
    console.error('[dispatch] Manual trigger error', err);
  }
});

// ---- campaign send endpoint (called by VPS campaigns.js) ------------------
app.post('/internal/send-campaign', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { to, message } = req.body;
  if (!to || !message) return res.status(400).json({ error: 'to e message obrigatorios' });
  res.status(200).json({ status: 'sending' });
  try {
    await sendWhatsAppText(to, message);
    console.log('[campaign] Mensagem enviada para ' + to);
  } catch (err) {
    console.error('[campaign] Erro ao enviar mensagem', err);
  }
});

// ---- SMM classifier (Central de Mensagens Stays) --------------------------
// Recebe texto + canal + contexto, retorna {reply, source}.
// Usado pelo cron /root/smm_sync.js no VPS pra responder Booking/Airbnb/Expedia
// reaproveitando os MESMOS matchers + AI fallback do bot WhatsApp.
// Adicionado 13/05/2026.
app.post('/internal/smm-classify', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const { classifyAndRespond } = require('./services/smmClassifier');
    const { text, channel, guestName, tenant, history, lang, allowAi } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text obrigatorio' });
    }
    const result = await classifyAndRespond({
      text,
      channel: channel || 'unknown',
      guestName: guestName || '',
      tenant: tenant || null,
      history: Array.isArray(history) ? history : [],
      lang: lang || 'pt',
      allowAi: allowAi === true || allowAi === 'true',
    });
    res.json(result);
  } catch (err) {
    console.error('[smm-classify]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---- manual social media post trigger (Instagram + Facebook) --------------
app.post('/internal/social-post', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { eventHint } = req.body || {};
  res.status(200).json({ status: 'social post started' });
  try {
    await runSocialMediaPost(eventHint);
  } catch (err) {
    console.error('[social] Erro no post manual', err);
  }
});

// ===========================================================================
// SOCIAL MEDIA AUTO-POST LOGIC
// ===========================================================================

/**
 * Fluxo completo de post automÃÂ¡tico no Instagram + Facebook.
 * 1. Verifica disponibilidade (cancela se hotel lotado)
 * 2. Gera imagem via DALL-E 3
 * 3. Gera legenda via GPT para IG e FB
 * 4. Publica em ambas as plataformas
 */
async function runSocialMediaPost(eventHint) {
  const hint = eventHint || getSPEventHint();
  console.log(`[social] Iniciando post automÃÂ¡tico: "${hint}"`);

  const available = await getAvailableRooms();

  try {
    // Gera imagem + legendas em paralelo
    const [imageUrl, igCaption, fbCaption] = await Promise.all([
      generatePostImage(hint),
      generatePostCaption(hint, available),
      generateFBCaption(hint, available)
    ]);

    // Publica no Instagram (primÃÂ¡rio) + Facebook (espelho)
    const [igPostId, fbPostId] = await Promise.all([
      require('./services/instagram').publishPost(imageUrl, igCaption),
      autoPostToPage(imageUrl, fbCaption)
    ]);

    console.log(`[social] Ã¢ÂÂ Posts publicados Ã¢ÂÂ IG: ${igPostId} | FB: ${fbPostId || 'n/a'}`);
  } catch (err) {
    console.error('[social] Ã¢ÂÂ Erro no post automÃÂ¡tico:', err.message);
    throw err;
  }
}

/**
 * Retorna um hint de evento/tema para posts automÃÂ¡ticos.
 * Baseado na ÃÂ©poca do ano (sazonalidade em SÃÂ£o Paulo).
 */
function getSPEventHint() {
  const month = new Date().getMonth() + 1; // 1-12
  const dayOfWeek = new Date().getDay(); // 0=Dom, 5=Sex

  const seasonalHints = {
    1:  'verÃÂ£o em SÃÂ£o Paulo Ã¢ÂÂ piscina, praÃÂ§as e cultura',
    2:  'Carnaval em SÃÂ£o Paulo Ã¢ÂÂ festas, blocos e agitaÃÂ§ÃÂ£o',
    3:  'outono chegando em SP Ã¢ÂÂ cultura e gastronomia',
    4:  'SÃÂ£o Paulo em abril Ã¢ÂÂ museus, teatro e Semana Santa',
    5:  'Dia das MÃÂ£es em SÃÂ£o Paulo Ã¢ÂÂ fim de semana especial',
    6:  'inverno paulistano Ã¢ÂÂ conforto, gastronomia e cultura',
    7:  'fÃÂ©rias de julho em SÃÂ£o Paulo Ã¢ÂÂ shows e eventos culturais',
    8:  'agosto em SP Ã¢ÂÂ Virada Cultural e eventos na cidade',
    9:  'primavera em SÃÂ£o Paulo Ã¢ÂÂ parques e vida ao ar livre',
    10: 'outubro em SP Ã¢ÂÂ festivais gastronÃÂ´micos e eventos',
    11: 'Black Friday e novembro em SP Ã¢ÂÂ compras e passeios',
    12: 'Natal e RÃÂ©veillon em SÃÂ£o Paulo Ã¢ÂÂ decoraÃÂ§ÃÂµes e festas'
  };

  return seasonalHints[month] || 'fim de semana em SÃÂ£o Paulo Ã¢ÂÂ explore a cidade';
}

// ===========================================================================
// SCHEDULERS
// ===========================================================================

/** Agenda relatÃÂ³rio diÃÂ¡rio ÃÂ s 08:00 BRT */
function scheduleDailyDispatch() {
  const now  = new Date();
  const next = new Date();
  next.setHours(8, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delayMs = next - now;

  console.log(
    `[dispatch] PrÃÂ³xima execuÃÂ§ÃÂ£o agendada: ${
      next.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    } (em ${Math.round(delayMs / 60000)} min)`
  );

  setTimeout(async () => {
    try {
      console.log('[dispatch] Executando relatÃÂ³rio diÃÂ¡rio...');
      await dailyCheckinDispatch();
    } catch (err) {
      console.error('[dispatch] Erro na execuÃÂ§ÃÂ£o agendada', err);
    } finally {
      scheduleDailyDispatch();
    }
  }, delayMs);
}

/** Agenda sincronizaÃÂ§ÃÂ£o de checkouts ÃÂ s 10:00 BRT */
function scheduleCheckoutSync() {
  const now  = new Date();
  const next = new Date();
  next.setHours(10, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delayMs = next - now;

  console.log(
    `[checkout] PrÃÂ³xima sincronizaÃÂ§ÃÂ£o agendada: ${
      next.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    } (em ${Math.round(delayMs / 60000)} min)`
  );

  setTimeout(async () => {
    try {
      await dailyCheckoutSync();
    } catch (err) {
      console.error('[checkout] Erro na sincronizaÃÂ§ÃÂ£o agendada', err);
    } finally {
      scheduleCheckoutSync();
    }
  }, delayMs);
}

/**
 * Agenda posts automÃÂ¡ticos nas redes sociais ÃÂ s 11:00 BRT, toda sexta-feira.
 * Publica sobre eventos/temas de fim de semana em SÃÂ£o Paulo.
 */
function scheduleSocialMediaPost() {
  const now    = new Date();
  const next   = new Date();
  const dayOfWeek = next.getDay(); // 0=Dom ... 5=Sex ... 6=SÃÂ¡b

  // PrÃÂ³xima sexta-feira ÃÂ s 11:00
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7; // 0 = hoje ÃÂ© sexta Ã¢ÂÂ prÃÂ³xima semana
  next.setDate(next.getDate() + daysUntilFriday);
  next.setHours(11, 0, 0, 0);

  // Se for sexta e ainda nÃÂ£o passou das 11h, agendar para hoje
  if (dayOfWeek === 5 && now.getHours() < 11) {
    next.setDate(now.getDate());
    next.setHours(11, 0, 0, 0);
  }

  const delayMs = next - now;

  console.log(
    `[social] PrÃÂ³ximo post agendado: ${
      next.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    } (em ${Math.round(delayMs / 60000)} min)`
  );

  setTimeout(async () => {
    try {
      console.log('[social] Executando post automÃÂ¡tico de fim de semana...');
      await runSocialMediaPost();
    } catch (err) {
      console.error('[social] Erro no post agendado', err);
    } finally {
      scheduleSocialMediaPost(); // reagenda para a prÃÂ³xima sexta
    }
  }, delayMs);
}

// ===========================================================================
// START
// ===========================================================================

const server = app.listen(PORT, () => {
  console.log(`WhatsApp webhook server listening on port ${PORT}`);
  connectDB();
  startEmailMonitor();
  scheduleDailyDispatch();
  scheduleCheckoutSync();
  scheduleSocialMediaPost();
});

server.on('close', () => console.log('Webhook server closed'));
server.on('error', (err) => console.error('Webhook server error:', err));
