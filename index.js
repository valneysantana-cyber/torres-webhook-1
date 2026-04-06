'use strict';

/**
 * torres-webhook — entry point
 *
 * Responsibilities:
 * - Boot Express server
 * - Register WhatsApp webhook routes (GET verify + POST receive)
 * - Register Instagram webhook routes (GET verify + POST receive)
 * - Register Messenger webhook routes (GET verify + POST receive)
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

// Verificação de secret para endpoints internos
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

// ---- manual social media post trigger (Instagram + Facebook) --------------
app.post('/internal/social-post', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { eventHint } = req.body;
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
 * Fluxo completo de post automático no Instagram + Facebook.
 * 1. Verifica disponibilidade (cancela se hotel lotado)
 * 2. Gera imagem via DALL-E 3
 * 3. Gera legenda via GPT para IG e FB
 * 4. Publica em ambas as plataformas
 */
async function runSocialMediaPost(eventHint) {
  const hint = eventHint || getSPEventHint();
  console.log(`[social] Iniciando post automático: "${hint}"`);

  const available = await getAvailableRooms();
  if (available === 0) {
    console.log('[social] Hotel lotado — post cancelado');
    return;
  }

  try {
    // Gera imagem + legendas em paralelo
    const [imageUrl, igCaption, fbCaption] = await Promise.all([
      generatePostImage(hint),
      generatePostCaption(hint, available),
      generateFBCaption(hint, available)
    ]);

    // Publica no Instagram (primário) + Facebook (espelho)
    const [igPostId, fbPostId] = await Promise.all([
      require('./services/instagram').publishPost(imageUrl, igCaption),
      autoPostToPage(imageUrl, fbCaption)
    ]);

    console.log(`[social] ✅ Posts publicados — IG: ${igPostId} | FB: ${fbPostId || 'n/a'}`);
  } catch (err) {
    console.error('[social] ❌ Erro no post automático:', err.message);
    throw err;
  }
}

/**
 * Retorna um hint de evento/tema para posts automáticos.
 * Baseado na época do ano (sazonalidade em São Paulo).
 */
function getSPEventHint() {
  const month = new Date().getMonth() + 1; // 1-12
  const dayOfWeek = new Date().getDay(); // 0=Dom, 5=Sex

  const seasonalHints = {
    1:  'verão em São Paulo — piscina, praças e cultura',
    2:  'Carnaval em São Paulo — festas, blocos e agitação',
    3:  'outono chegando em SP — cultura e gastronomia',
    4:  'São Paulo em abril — museus, teatro e Semana Santa',
    5:  'Dia das Mães em São Paulo — fim de semana especial',
    6:  'inverno paulistano — conforto, gastronomia e cultura',
    7:  'férias de julho em São Paulo — shows e eventos culturais',
    8:  'agosto em SP — Virada Cultural e eventos na cidade',
    9:  'primavera em São Paulo — parques e vida ao ar livre',
    10: 'outubro em SP — festivais gastronômicos e eventos',
    11: 'Black Friday e novembro em SP — compras e passeios',
    12: 'Natal e Réveillon em São Paulo — decorações e festas'
  };

  return seasonalHints[month] || 'fim de semana em São Paulo — explore a cidade';
}

// ===========================================================================
// SCHEDULERS
// ===========================================================================

/** Agenda relatório diário às 08:00 BRT */
function scheduleDailyDispatch() {
  const now  = new Date();
  const next = new Date();
  next.setHours(8, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delayMs = next - now;

  console.log(
    `[dispatch] Próxima execução agendada: ${
      next.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    } (em ${Math.round(delayMs / 60000)} min)`
  );

  setTimeout(async () => {
    try {
      console.log('[dispatch] Executando relatório diário...');
      await dailyCheckinDispatch();
    } catch (err) {
      console.error('[dispatch] Erro na execução agendada', err);
    } finally {
      scheduleDailyDispatch();
    }
  }, delayMs);
}

/** Agenda sincronização de checkouts às 10:00 BRT */
function scheduleCheckoutSync() {
  const now  = new Date();
  const next = new Date();
  next.setHours(10, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delayMs = next - now;

  console.log(
    `[checkout] Próxima sincronização agendada: ${
      next.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    } (em ${Math.round(delayMs / 60000)} min)`
  );

  setTimeout(async () => {
    try {
      await dailyCheckoutSync();
    } catch (err) {
      console.error('[checkout] Erro na sincronização agendada', err);
    } finally {
      scheduleCheckoutSync();
    }
  }, delayMs);
}

/**
 * Agenda posts automáticos nas redes sociais às 11:00 BRT, toda sexta-feira.
 * Publica sobre eventos/temas de fim de semana em São Paulo.
 */
function scheduleSocialMediaPost() {
  const now    = new Date();
  const next   = new Date();
  const dayOfWeek = next.getDay(); // 0=Dom ... 5=Sex ... 6=Sáb

  // Próxima sexta-feira às 11:00
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7; // 0 = hoje é sexta → próxima semana
  next.setDate(next.getDate() + daysUntilFriday);
  next.setHours(11, 0, 0, 0);

  // Se for sexta e ainda não passou das 11h, agendar para hoje
  if (dayOfWeek === 5 && now.getHours() < 11) {
    next.setDate(now.getDate());
    next.setHours(11, 0, 0, 0);
  }

  const delayMs = next - now;

  console.log(
    `[social] Próximo post agendado: ${
      next.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    } (em ${Math.round(delayMs / 60000)} min)`
  );

  setTimeout(async () => {
    try {
      console.log('[social] Executando post automático de fim de semana...');
      await runSocialMediaPost();
    } catch (err) {
      console.error('[social] Erro no post agendado', err);
    } finally {
      scheduleSocialMediaPost(); // reagenda para a próxima sexta
    }
  }, delayMs);
}

// ===========================================================================
// START
// ===========================================================================

const server = app.listen(PORT, () => {
  console.log(`WhatsApp webhook server listening on port ${PORT}`);
  scheduleDailyDispatch();
  scheduleCheckoutSync();
  scheduleSocialMediaPost();
});

server.on('close', () => console.log('Webhook server closed'));
server.on('error', (err) => console.error('Webhook server error:', err));
