'use strict';

/**
 * torres-webhook — entry point
 *
 * Responsibilities:
 *   - Boot Express server
 *   - Register WhatsApp webhook routes (GET verify + POST receive)
 *
 * NOT responsible for:
 *   - Business logic (see handlers/whatsapp.js)
 *   - Daily dispatch (see services/dispatch.js — trigger via cron, not boot)
 *
 * Bug fixed: removed `dailyCheckinDispatch().catch(console.error)` that was
 * firing on every server restart (original line at bottom of monolith).
 */

const express    = require('express');
const bodyParser = require('body-parser');

const { PORT, VERIFY_TOKEN } = require('./config');
const { handleIncoming }    = require('./handlers/whatsapp');

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
  // Acknowledge immediately so Meta doesn't retry
  res.status(200).send({ status: 'received' });
  try {
    await handleIncoming(req.body);
  } catch (err) {
    console.error('Failed to handle webhook payload', err);
  }
});

// ---- start ----------------------------------------------------------------
const server = app.listen(PORT, () => {
  console.log(`WhatsApp webhook server listening on port ${PORT}`);
});

server.on('close', () => console.log('Webhook server closed'));
server.on('error', (err) => console.error('Webhook server error:', err));
