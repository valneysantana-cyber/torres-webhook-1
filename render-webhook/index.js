require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PORT = process.env.PORT || 3000;

// Endpoint para validação do webhook pelo Meta
app.get('/whatsapp-webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// Função para enviar mensagens via API WhatsApp Cloud
async function sendWhatsAppMessage(to, message) {
  const url = 'https://graph.facebook.com/v17.0/me/messages';

  const data = {
    messaging_product: 'whatsapp',
    to: to,
    text: { body: message }
  };

  try {
    await axios.post(url, data, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Erro ao enviar mensagem WhatsApp:', error.response ? error.response.data : error.message);
  }
}

// Função para detectar saudação e responder conforme horário
function getGreetingResponse(message) {
  const text = message.toLowerCase();
  const now = new Date();
  const hour = now.getHours();

  if (['oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite'].some(greet => text.includes(greet))) {
    if (hour >= 6 && hour < 12) return 'Bom dia! Como posso ajudar você hoje?';
    if (hour >= 12 && hour < 18) return 'Boa tarde! Em que posso ser útil?';
    if (hour >= 18 || hour < 6) return 'Boa noite! Precisa de alguma coisa?';
  }
  if (['como vai', 'tudo bem', 'tudo certo', 'como está'].some(phrase => text.includes(phrase))) {
    return 'Estou bem, obrigado por perguntar! Como posso ajudar?';
  }
  return null;
}

// Endpoint para receber as mensagens e processar respostas
app.post('/whatsapp-webhook', async (req, res) => {
  const body = req.body;

  if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0]) {
    const changes = body.entry[0].changes[0];
    if (changes.value.messages) {
      for (const message of changes.value.messages) {
        const from = message.from;
        const text = message.text?.body || '';

        const response = getGreetingResponse(text);
        if (response) {
          await sendWhatsAppMessage(from, response);
        }
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

app.listen(PORT, () => console.log(`Webhook rodando na porta ${PORT}`));
