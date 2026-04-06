'use strict';

/**
 * torres-webhook — entry point
 *
 * Responsibilities:
 * - Boot Express server
 * - Register WhatsApp webhook routes (GET verify + POST receive)
 * - Schedule dailyCheckinDispatch at 08:00 BRT every day
 * - Schedule dailyCheckoutSync at 10:00 BRT every day
 * - Expose POST /internal/dispatch for manual triggers (protected by DISPATCH_SECRET)
 */

const express    = require('express');
const bodyParser = require('body-parser');

const { PORT, VERIFY_TOKEN, DISPATCH_SECRET } = require('./config');
const { handleIncoming }       = require('./handlers/whatsapp');
const { dailyCheckinDispatch } = require('./services/dispatch');
const { dailyCheckoutSync }    = require('./services/checkout');
const { sendWhatsAppText }      = require('./services/whatsapp');

const app = express();
app.use(bodyParser.json());

// ---- health check ---------------------------------------------------------
app.get('/', (_req, res) => {
  res.status(200).send('torres-webhook online');
});

// ---- webhook verification -------------------------------------------------
app.get('/whatsapp-webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified');
    res.status(200).send(challenge);
  } else {
    console.log('Verification failed', { mode, token });
    res.sendStatus(403);
  }
});

// ---- incoming messages ----------------------------------------------------
app.post('/whatsapp-webhook', async (req, res) => {
  res.status(200).send({ status: 'received' });
  try {
    await handleIncoming(req.body);
  } catch (err) {
    console.error('Failed to handle webhook payload', err);
  }
});

// ---- manual dispatch trigger (protected) ----------------------------------
app.post('/internal/dispatch', async (req, res) => {
  const secret = req.headers['x-dispatch-secret'] || req.query.secret;
  if (DISPATCH_SECRET && secret !== DISPATCH_SECRET) {
    return res.sendStatus(401);
  }
  res.status(200).send({ status: 'dispatch started' });
  try {
    await dailyCheckinDispatch();
  } catch (err) {
    console.error('[dispatch] Manual trigger error', err);
  }
});

// ---- campaign send endpoint (called by VPS campaigns.js) ----------------
app.post('/internal/send-campaign', async (req, res) => {
    const secret = req.headers['x-dispatch-secret'] || req.query.secret;
    if (DISPATCH_SECRET && secret !== DISPATCH_SECRET) {
          return res.sendStatus(401);
    }
    const { to, message } = req.body;
    if (!to || !message) {
          return res.status(400).json({ error: 'to e message obrigatorios' });
    }
    res.status(200).json({ status: 'sending' });
    try {
          await sendWhatsAppText(to, message);
          console.log('[campaign] Mensagem enviada para ' + to);
    } catch (err) {
          console.error('[campaign] Erro ao enviar mensagem', err);
    }
});

// ---- daily cron scheduler (pure Node — no extra deps) ---------------------
function scheduleDailyDispatch() {
  const now  = new Date();
  // next 08:00 BRT (process.env.TZ is set to America/Sao_Paulo in config)
  const next = new Date();
  next.setHours(8, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  const delayMs = next - now;
  console.log(
    `[dispatch] Pr\u00f3xima execu\u00e7\u00e3o agendada: ${
      next.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    } (em ${Math.round(delayMs / 60000)} min)`
  );

  setTimeout(async () => {
    try {
      console.log('[dispatch] Executando relat\u00f3rio di\u00e1rio...');
      await dailyCheckinDispatch();
    } catch (err) {
      console.error('[dispatch] Erro na execu\u00e7\u00e3o agendada', err);
    } finally {
      // Reschedule for next day regardless of success/failure
      scheduleDailyDispatch();
    }
  }, delayMs);
}

function scheduleCheckoutSync() {
  const now  = new Date();
  // next 10:00 BRT — runs after checkin dispatch so stays data is fresh
  const next = new Date();
  next.setHours(10, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  const delayMs = next - now;
  console.log(
    `[checkout] Pr\u00f3xima sincroniza\u00e7\u00e3o agendada: ${
      next.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    } (em ${Math.round(delayMs / 60000)} min)`
  );

  setTimeout(async () => {
    try {
      await dailyCheckoutSync();
    } catch (err) {
      console.error('[checkout] Erro na sincroniza\u00e7\u00e3o agendada', err);
    } finally {
      scheduleCheckoutSync();
    }
  }, delayMs);
}

// ---- start ----------------------------------------------------------------
const server = app.listen(PORT, () => {
  console.log(`WhatsApp webhook server listening on port ${PORT}`);
  scheduleDailyDispatch();
  scheduleCheckoutSync();
});

server.on('close', () => console.log('Webhook server closed'));
server.on('error', (err) => console.error('Webhook server error:', err));
