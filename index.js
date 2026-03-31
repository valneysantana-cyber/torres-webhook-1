  
const express = require('express');
const bodyParser = require('body-parser');

process.env.TZ = 'America/Sao_Paulo';

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'torres-webhook-2026';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const PORT = process.env.PORT || 8000;

const STAYS_BASE_URL = process.env.STAYS_API_BASE_URL || 'https://valney.stays.net/external/v1';
const STAYS_USERNAME = process.env.STAYS_API_LOGIN || process.env.STAYS_API_USER;
const STAYS_PASSWORD = process.env.STAYS_API_PASSWORD || process.env.STAYS_API_PASS;

const HUMAN_NUMBER_PRIMARY = '+55 11 99907-3135';
const HUMAN_NUMBER_SECONDARY = '+55 13 99615-5505';

const CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const pendingConfirmations = new Map();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';

const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE || 'alloy';

const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-5.4-mini';

const FIXED_ADDRESS = 'TorresGuest Hospedagem - Rua Monte Alegre, 835 - Perdizes, São Paulo - SP';

const MENU_RESPONSE = `Olá! Seja muito bem-vindo(a) à TorresGuest 😊

Estou aqui para te ajudar com tudo da sua hospedagem. Escolha uma opção ou digite o tema direto:

1️⃣ Wi-Fi
2️⃣ Café da manhã
3️⃣ Piscina e academia
4️⃣ Estacionamento
5️⃣ Snacks no apartamento
6️⃣ Troca de toalhas
7️⃣ Restaurante
8️⃣ Check-in / Check-out
9️⃣ Transfer aeroporto
🔟 Falar com atendimento humano
1️⃣1️⃣ Confirmar minha reserva

É só responder com o número ou escrever o assunto. Sempre que precisar, estou por aqui! 🌴`;

const HUMAN_ESCALATION_RESPONSE = `Neste caso favor entrar em contato com a Sofia que atende no WhatsApp ${HUMAN_NUMBER_SECONDARY}. Cuidaremos para responder melhor suas duvidas. 😊`;

const CONFIRMATION_PROMPT = `Claro! Me envia o código da sua reserva com 5 digitos (letras e números) que foi confirmada por e-mail (exemplo: IC09J) para eu confirmar no sistema.`;

const WIFI_RESPONSE = `O Acesso ao Wi-Fi é através da rede do hotel. Ao abrir o portal Captiva, basta informar o Nome + CPF (os mesmos do check-in).
Se tiver qualquer dificuldade, me chama aqui que eu ajudo. 🌴`;

const BREAKFAST_RESPONSE = `☕ O Café da Manhã está incluso na sua reserva, servido no restaurante do lobby (em frente à recepção).
🕒 Todos os dias, das 06h30 às 10h00.
Aproveite para começar o dia muito bem! 🌴`;

const POOL_RESPONSE = `🏊‍♀️ Piscina & Academia estão disponíveis dentro da infraestrutura do hotel acessível todos os dias, das 08h00 às 21h00.
Aproveite a piscina para relaxar e a academia para manter a rotina! 🌴`;

const PARKING_RESPONSE = `🚗 O estacionamento incluso em sua reserva é dentro do prédio, com manobrista.
Basta informar que está hospedado em flat do condomínio.
✔️ Sem custo adicional para hóspedes. Qualquer dúvida, me avisa! 🌴`;

const SNACKS_RESPONSE = `🍫 Os Snacks e Conveniência
Deixamos no apartamento para sua comodidade.
💳 Pagamento via PIX 62.169.624/0001-94.
📋 A tabela está na bancada; se preferir, te envio aqui.
Curta com vontade! 🌴`;

const TOWELS_RESPONSE = `🧺 A Troca de Toalhas para estadias acima de dois dias, é feita a cada 48h.
Se precisar antes, é só me avisar que agilizo com a governança. 🌴`;

const RESTAURANT_RESPONSE = `🍽️ O Restaurante do Hotel com acesso pelo lobby oferece refeições à la carte ao longo do dia.
Perfeito para quem quer comer bem sem sair do prédio. Se quiser sugestões, me chama! 🌴`;

const CHECKIN_RESPONSE = `🕐 Check-in & Check-out possuem limites de horário, sobretudo o check-out, pois o time de governança do hotel pede uma hora para limpeza e higienização.
Check-in: a partir das 14h
Check-out: até 12h
A recepção funciona 24h com equipe de segurança para te receber em qualquer horário. 🌴`;

const SECURITY_RESPONSE = `🔐 Contamos com Segurança & Recepção 24h, controle de acesso e equipe no local o tempo todo.
Pode chegar tranquilo(a), estamos sempre por perto. 🌴`;

const TRANSFER_RESPONSE = `✈️ Transfer Aeroporto
Oferecemos apoio com transfer sob demanda e com custo adicional.
Me avise seu voo e horário que conecto você direto com nossa concierge no ${HUMAN_NUMBER_PRIMARY} ou ${HUMAN_NUMBER_SECONDARY} para finalizar os detalhes. 🌴`;

const LOCATION_RESPONSE = `📍 Diferenciais TorresGuest
• Flats dentro de um hotel completo (piscina, academia, restaurante)
• Localização excelente em Perdizes, São Paulo/SP
• Próximo ao Allianz Parque, PUC-SP e Shopping Bourbon
• Atendimento próximo e humanizado, estilo concierge

Ideal para lazer ou trabalho. Precisa de algo específico? Só chamar! 🌴`;

const LONG_STAY_RESPONSE = `💰 Estadias longas
Temos condições especiais para períodos estendidos.
Me conta quantas noites e datas que converso com a equipe no ${HUMAN_NUMBER_PRIMARY}/${HUMAN_NUMBER_SECONDARY} e já retorno com a proposta. 🌴`;

const CLEANING_RESPONSE = `🧹 Limpeza / Governança
A limpeza é realizada pela equipe do hotel.
Avise com 24h de antecedência o melhor horário e eu agendo pra você. 🌴`;

const INTERNET_RESPONSE = `📡 Internet
O Wi-Fi do hotel é fibra, ideal para trabalho remoto e streaming.
Se notar qualquer instabilidade, me chama que aciono o time técnico na hora. 🌴`;

const LUGGAGE_RESPONSE = `🧳 Guarda de malas
Precisando deixar bagagem antes do check-in ou depois do check-out?
Temos um acordo com o Sr. Alberto (chefe do restaurante) para guardar as malas de nossos hospedes conforme disponibilidade. 
Me informe horários que já deixo alinhado com ele. 🌴`;

const GREETING_RESPONSE = (name) => `Perfeito, ${name || 'tudo bem'} 😊

Me diga o que você precisa, ou digite *menu* para ver as opções. 🌴`;

const THANKS_RESPONSE = `Imagina! 😊

Qualquer coisa que precisar, estou por aqui para te ajudar. 🌴`;

const RESERVATION_SITE_RESPONSE = `As reservas são feitas exclusivamente pelo nosso site oficial:

🌐 www.torresguest.com.br

Por aqui no WhatsApp eu não realizo reservas nem consulto disponibilidade para novas hospedagens.`;

const FAQ_ENTRIES = [
  {
    patterns: [/(onde.*localizad|qual.*bairro|localizacao|onde voces estao|onde fica)/],
    response: 'Estamos no bairro de Perdizes, uma das regiões mais valorizadas e estratégicas de São Paulo. 😊',
  },
  {
    patterns: [/(perto.*allianz|allianz.*perto|allianz parque)/],
    response: 'Sim! Ficamos a poucos minutos do Allianz Parque, perfeito para shows e jogos. ⚽🎤',
  },
  {
    patterns: [/(ir a pe|caminha|andar).*allianz/],
    response: 'Dá para ir a pé até o Allianz Parque em cerca de 10 a 15 minutos, dependendo do ritmo. 🚶‍♂️',
  },
  {
    patterns: [/(regiao segura|area segura|seguro ai|seguro o bairro)/],
    response: 'Perdizes é um bairro residencial com boa segurança e movimento constante. Ainda assim, recomendamos os cuidados usuais de cidade grande.',
  },
  {
    patterns: [/(mercado|supermercado|padaria).*perto/],
    response: 'Temos mercados, padarias e farmácias muito próximos — dá pra resolver tudo a pé.',
  },
  {
    patterns: [/(restaurante|gastronomia).*perto/],
    response: 'Sim! A região é rica em restaurantes e bares, desde cafés charmosos até casas premiadas. 🍽️',
  },
  {
    patterns: [/(shopping|bourbon)/],
    response: 'O Shopping Bourbon fica pertinho e é ótima opção para compras, cinema e alimentação.',
  },
  {
    patterns: [/(puc|universidade)/],
    response: 'Estamos bem próximos da PUC-SP, perfeito para quem vem a eventos ou graduações. 🎓',
  },
  {
    patterns: [/(?:((?:uber|app).*facil)|facil pedir carro)/],
    response: 'O acesso a Uber e demais apps é bem rápido por aqui. 🚗',
  },
  {
    patterns: [/(longe).*centro/],
    response: 'Estamos a poucos minutos do centro — o acesso é rápido tanto de carro quanto de transporte público.',
  },
  {
    patterns: [/(avenida paulista|paulista)/],
    response: 'A Avenida Paulista fica a cerca de 10–15 minutos de carro, super prático.',
  },
  {
    patterns: [/(farmacia)/],
    response: 'Tem farmácias 24h e drograrias de rede muito perto. 💊',
  },
  {
    patterns: [/(padaria)/],
    response: 'Padarias ótimas na região — impossível não querer um café ali. ☕',
  },
  {
    patterns: [/(area movimentada|rua movimentada)/],
    response: 'É uma área movimentada e residencial, com bom fluxo mas mantendo tranquilidade.',
  },
  {
    patterns: [/(bares|barzinho)/],
    response: 'Sim, temos bares e pubs próximos para diversos estilos. 🍻',
  },
  {
    patterns: [/(transporte publico|onibus|metro)/],
    response: 'Temos acesso fácil a ônibus e metrô, facilitando deslocamentos pela cidade.',
  },
  {
    patterns: [/(?:aeroporto.*proximo|qual aeroporto)/],
    response: 'O aeroporto mais próximo é Congonhas, ideal para quem chega por voos domésticos. ✈️',
  },
  {
    patterns: [/(tempo).*aeroporto/],
    response: 'Congonhas fica a 20–40 minutos, variando conforme o trânsito.',
  },
  {
    patterns: [/(ciclovia|bike)/],
    response: 'Sim, há ciclovias e ciclofaixas próximas — o bairro é ótimo pra quem pedala. 🚴',
  },
  {
    patterns: [/(turismo|pontos turisticos)/],
    response: 'Perdizes é uma base excelente pra explorar São Paulo: fica perto de polos culturais, gastronômicos e de compras.',
  },
  {
    patterns: [/(?:hospede.*show|allianz parque|eventos)/],
    response: 'Recebemos muitos hóspedes que vêm para shows e eventos — a localização é perfeita pra isso. 🎶',
  },
  {
    patterns: [/(?:barulho.*show|movimento.*evento)/],
    response: 'Em dias de jogos ou shows a região fica mais movimentada, mas nada que comprometa o descanso dentro do flat.',
  },
  {
    patterns: [/(avisam).*eventos/],
    response: 'Sempre que possível avisamos sobre eventos na região pra você se organizar.',
  },
  {
    patterns: [/(?:ver.*estadio|vista.*allianz)/],
    response: 'Algumas unidades têm vista parcial do Allianz Parque — consulte a disponibilidade que eu verifico pra você. 👀',
  },
  {
    patterns: [/(restaurante).*estadio/],
    response: 'Os arredores do Allianz têm várias opções de bares e restaurantes pra antes ou depois dos eventos.',
  },
  {
    patterns: [/(cheio|lotado).*evento/],
    response: 'Nos dias de evento a região fica cheia, então recomendamos sair com antecedência.',
  },
  {
    patterns: [/(seguro).*voltar.*noite/],
    response: 'É seguro voltar, mas em dias de grande movimento sugerimos usar apps de transporte pra mais conforto.',
  },
  {
    patterns: [/(vale a pena|bom lugar).*show/],
    response: 'Vale muito! Você fica pertinho do Allianz e ainda conta com toda estrutura do flat/hotel.',
  },
  {
    patterns: [/(estacionamento).*jogo/],
    response: 'Mesmo em dias de jogos, mantemos o estacionamento com manobrista dentro do prédio.',
  },
  {
    patterns: [/(evitar).*transito/],
    response: 'Saindo antes dos horários de pico você evita trânsito pesado; posso te ajudar com dicas de trajeto.',
  },
  {
    patterns: [/(hotel ou airbnb|eh hotel)/],
    response: 'Somos flats particulares dentro de um hotel, unindo privacidade com toda a estrutura hoteleira. 😊',
  },
  {
    patterns: [/(?:usar.*estrutura|piscina academia restaurante)/],
    response: 'Os hóspedes podem usar toda a estrutura do hotel: piscina, academia, restaurante e serviços.',
  },
  {
    patterns: [/(piscina)/],
    response: 'Tem piscina das 08h às 21h para relaxar quando quiser. 🏊‍♀️',
  },
  {
    patterns: [/(academia|gym)/],
    response: 'Tem academia equipada aberta das 08h às 21h. 💪',
  },
  {
    patterns: [/(cafe da manha)/],
    response: 'O café da manhã está incluso e servido no restaurante do lobby, das 06h30 às 10h.',
  },
  {
    patterns: [/(wifi|internet)/],
    response: 'Temos Wi-Fi fibra com ótima estabilidade, ideal pra trabalho e streaming. 📶',
  },
  {
    patterns: [/(ar condicionado|ar-condicionado|climatizado)/],
    response: 'Todos os flats contam com ar-condicionado para seu conforto. ❄️',
  },
  {
    patterns: [/(tv)/],
    response: 'Tem TV com canais a cabo/streaming para você relaxar. 📺',
  },
  {
    patterns: [/(limpeza|faxina)/],
    response: 'A limpeza é feita pela governança do hotel; é só avisar com antecedência que agendamos.',
  },
  {
    patterns: [/(recepcao|24h)/],
    response: 'Temos recepção 24h pronta para apoiar em qualquer necessidade. 🛎️',
  },
  {
    patterns: [/(elevador)/],
    response: 'Sim, o prédio possui elevadores modernos e rápidos.',
  },
  {
    patterns: [/(vista)/],
    response: 'Algumas unidades têm vista linda da cidade; me fala sua preferência que escolho a melhor opção.',
  },
  {
    patterns: [/(secador)/],
    response: 'Disponibilizamos secador — se não estiver no flat é só solicitar que levamos.',
  },
  {
    patterns: [/(ferro)/],
    response: 'Podemos providenciar ferro e tábua sob demanda, sem custo.',
  },
  {
    patterns: [/(cozinha|cooktop|micro-ondas|microondas)/],
    response: 'Os flats têm mini cozinha funcional com itens básicos para refeições rápidas.',
  },
  {
    patterns: [/(frigobar|geladeira)/],
    response: 'Sim, cada unidade conta com frigobar abastecido.',
  },
  {
    patterns: [/(snack|snacks)/],
    response: 'Deixamos snacks no apartamento — se consumir, é só pagar via PIX 62.169.624/0001-94.',
  },
  {
    patterns: [/(trabalho|home office|notebook)/],
    response: 'Tem espaço confortável pra trabalhar, com internet rápida e tomadas acessíveis. 💻',
  },
  {
    patterns: [/(silencioso|barulho)/],
    response: 'O flat é silencioso; só em dias de grandes eventos pode haver mais movimento externo.',
  },
  {
    patterns: [/(visita|receber pessoas)/],
    response: 'Visitas são possíveis mediante aviso prévio para alinharmos com a recepção.',
  },
  {
    patterns: [/(festa|eventos no apartamento)/],
    response: 'Não permitimos festas no flat para garantir o conforto de todos os hóspedes. 🚫',
  },
  {
    patterns: [/(fumar|cigarro)/],
    response: 'Os flats são 100% não fumantes. Se precisar, temos áreas externas designadas.',
  },
  {
    patterns: [/(pet|animal)/],
    response: 'Pets podem ser aceitos mediante consulta — me avisa o porte e os dias pra eu confirmar. 🐾',
  },
  {
    patterns: [/(lavanderia)/],
    response: 'O hotel oferece serviço de lavanderia; posso ajudar a agendar.',
  },
  {
    patterns: [/(room service|servico de quarto)/],
    response: 'O restaurante atende o flat via room service em horários definidos.',
  },
  {
    patterns: [/(check-in facil|checkin facil)/],
    response: 'O check-in é simples: nos avise o horário e deixamos tudo pronto na recepção.',
  },
  {
    patterns: [/(suporte durante a estadia|ajuda durante a estadia)/],
    response: 'Ficamos disponíveis 24/7 no WhatsApp pra resolver qualquer necessidade durante a estadia. 😊',
  },
  {
    patterns: [/(pedir comida|delivery)/],
    response: 'Pode pedir delivery sem problema; avisamos a recepção pra autorizar a entrega.',
  },
  {
    patterns: [/(acessibilidade|cadeirante)/],
    response: 'Temos unidades com recursos de acessibilidade — me diz o que precisa que seleciono a melhor opção.',
  },
  {
    patterns: [/(blackout|cortina)/],
    response: 'As unidades têm cortinas blackout para garantir noites bem escuras.',
  },
  {
    patterns: [/(tomada|energia)/],
    response: 'Há diversas tomadas próximas da cama e da estação de trabalho.',
  },
  {
    patterns: [/(casal|romantico)/],
    response: 'Os flats acomodam casais com muito conforto — posso preparar mimos especiais se quiser.',
  },
  {
    patterns: [/(confortavel|conforto)/],
    response: 'Sim, montamos tudo para ser aconchegante e prático, com padrão de hotel boutique. 😊',
  },
];

const RESERVATION_NOT_FOUND = (code) => `Ainda não localizei a reserva ${code}. Você consegue confirmar se o código está correto ou me enviar o print do canal? Se preferir, nosso atendimento humano resolve rapidinho nos números ${HUMAN_NUMBER_PRIMARY} e ${HUMAN_NUMBER_SECONDARY}.`;

const app = express();
app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.status(200).send('torres-webhook online');
});

app.get('/whatsapp-webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified');
    res.status(200).send(challenge);
  } else {
    console.log('Verification failed', { mode, token });
    res.sendStatus(403);
  }
});

app.post('/whatsapp-webhook', async (req, res) => {
  console.log('Incoming webhook:', JSON.stringify(req.body, null, 2));
  res.status(200).send({ status: 'received' });

  try {
    await handleIncoming(req.body);
  } catch (err) {
    console.error('Failed to handle webhook payload', err);
  }
});

async function handleIncoming(payload) {
  if (!payload?.entry) return;

  for (const entry of payload.entry) {
    const changes = entry.changes || [];

    for (const change of changes) {
      if (change.field !== 'messages') continue;

      const value = change.value || {};
      const messages = value.messages || [];
      
      const contactName = value.contacts?.[0]?.profile?.name || '';
      
      for (const message of messages) {
        const from = message.from;
        if (!from) continue;

        let cameFromAudio = false;
        let body = '';

        if (message.type === 'text') {
          body = message.text?.body || '';
        } else if (message.type === 'audio') {
          cameFromAudio = true;

          try {
            const mediaId = message.audio?.id;

            if (!mediaId) {
              await replyToGuest(
                from,
                'Recebi seu áudio, mas não consegui identificar o arquivo. Pode tentar novamente? 🎙️',
                { alsoSendAudio: cameFromAudio }
              );
              continue;
            }

            const audioBuffer = await downloadWhatsAppMedia(mediaId);
            const transcript = await transcribeAudioBuffer(
              audioBuffer,
              message.audio?.mime_type || 'audio/ogg'
            );

            if (!transcript) {
              await replyToGuest(
                from,
                'Recebi seu áudio, mas não consegui entender bem. Pode me mandar novamente ou escrever por texto? 😊',
                { alsoSendAudio: cameFromAudio }
              );
              continue;
            }

            body = transcript;
            console.log('[audio transcript]', { from, transcript });
          } catch (err) {
            console.error('Failed to process audio message', err);
            await replyToGuest(
              from,
              'Recebi seu áudio, mas tive uma falha para processar agora. Pode tentar novamente ou me escrever por texto? 😊',
              { alsoSendAudio: cameFromAudio }
            );
            continue;
          }
        } else {
          continue;
        }

        const normalized = normalizeText(body);
        console.log('[incoming]', { from, body, normalized });
        
        if (shouldSendGreeting(normalized)) {
          await replyToGuest(from, GREETING_RESPONSE(contactName), { alsoSendAudio: cameFromAudio });
          continue;
        }

        if (shouldSendThanks(normalized)) {
          await replyToGuest(from, THANKS_RESPONSE, { alsoSendAudio: cameFromAudio });
          continue;
        }

        if (shouldSendMenu(normalized)) {
          console.log('[menu] sending menu response');
          await replyToGuest(from, MENU_RESPONSE, { alsoSendAudio: cameFromAudio });
          pendingConfirmations.delete(from);
          continue;
        }

        const confirmationHandled = await maybeHandleReservationConfirmation({
          rawText: body,
          normalizedText: normalized,
          from,
          cameFromAudio
        });

        if (confirmationHandled) {
          continue;
        }

        if (shouldRedirectToReservationSite(normalized) || /\b\d{1,2}[\/.-]\d{1,2}\b/.test(body) || /\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/.test(body)) {
  await replyToGuest(from, RESERVATION_SITE_RESPONSE, { alsoSendAudio: cameFromAudio });
  continue;
}
        
        if (shouldSendWifi(normalized)) {
          await replyToGuest(from, WIFI_RESPONSE, { alsoSendAudio: cameFromAudio });
        } else if (shouldSendBreakfast(normalized)) {
          await replyToGuest(from, BREAKFAST_RESPONSE, { alsoSendAudio: cameFromAudio });
        } else if (shouldSendPool(normalized)) {
          await replyToGuest(from, POOL_RESPONSE, { alsoSendAudio: cameFromAudio });
        } else if (shouldSendParking(normalized)) {
          await replyToGuest(from, PARKING_RESPONSE, { alsoSendAudio: cameFromAudio });
        } else if (shouldSendSnacks(normalized)) {
          await replyToGuest(from, SNACKS_RESPONSE, { alsoSendAudio: cameFromAudio });
        } else if (shouldSendTowels(normalized)) {
          await replyToGuest(from, TOWELS_RESPONSE, { alsoSendAudio: cameFromAudio });
        } else if (shouldSendRestaurant(normalized)) {
          await replyToGuest(from, RESTAURANT_RESPONSE, { alsoSendAudio: cameFromAudio });
        } else if (shouldSendCheckin(normalized)) {
          await replyToGuest(from, CHECKIN_RESPONSE, { alsoSendAudio: cameFromAudio });
        } else if (shouldSendSecurity(normalized)) {
          await replyToGuest(from, SECURITY_RESPONSE, { alsoSendAudio: cameFromAudio });
        } else if (shouldSendTransfer(normalized)) {
          await replyToGuest(from, TRANSFER_RESPONSE, { alsoSendAudio: cameFromAudio });
        } else if (shouldSendLocation(normalized)) {
          await replyToGuest(from, LOCATION_RESPONSE, { alsoSendAudio: cameFromAudio });
        } else if (shouldSendLongStay(normalized)) {
          await replyToGuest(from, LONG_STAY_RESPONSE, { alsoSendAudio: cameFromAudio });
        } else if (shouldSendCleaning(normalized)) {
          await replyToGuest(from, CLEANING_RESPONSE, { alsoSendAudio: cameFromAudio });
        } else if (shouldSendInternet(normalized)) {
          await replyToGuest(from, INTERNET_RESPONSE, { alsoSendAudio: cameFromAudio });
        } else if (shouldSendLuggage(normalized)) {
          await replyToGuest(from, LUGGAGE_RESPONSE, { alsoSendAudio: cameFromAudio });
        } else if (shouldSendCurrentDate(normalized)) {
          const currentDate = getCurrentDateBRT();
          await replyToGuest(from, `Hoje é ${currentDate}.`, { alsoSendAudio: cameFromAudio });
        } else if (shouldSendCurrentTime(normalized)) {
          const currentTime = getCurrentTimeBRT();
          await replyToGuest(from, `Agora são ${currentTime}, horário de Brasília.`, { alsoSendAudio: cameFromAudio });
        } else if (shouldSendHuman(normalized)) {
          await replyToGuest(from, HUMAN_ESCALATION_RESPONSE, { alsoSendAudio: cameFromAudio });
        } else {
          const aiReply = await getChatGptFallbackReply(body, from);

          if (aiReply) {
            await replyToGuest(from, aiReply, { alsoSendAudio: cameFromAudio });
          } else {
            const faqResponse = getFaqResponse(normalized);

            if (faqResponse) {
              await replyToGuest(from, faqResponse, { alsoSendAudio: cameFromAudio });
            } else {
              await replyToGuest(
                from,
                `${HUMAN_ESCALATION_RESPONSE}\n\nSe quiser voltar ao menu, é só digitar "menu".`,
                { alsoSendAudio: cameFromAudio }
              );
            }
          }
        }
      }
    }
  }
}

function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^0-9a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNumericSelection(text, ...options) {
  const digits = text.replace(/[^0-9]/g, '');
  return digits && options.includes(digits);
}

function shouldSendMenu(text) {
  return isNumericSelection(text, '0') || /\b(menu|opcao|opcoes|ajuda|inicio|start|comecar)\b/.test(text);
}

function shouldSendWifi(text) {
  return isNumericSelection(text, '1') || /(wi\s*-?\s*fi|wifi|senha do wi fi|senha wifi|senha do wifi)/.test(text);
}

function shouldSendBreakfast(text) {
  return isNumericSelection(text, '2') || /(cafe da manha|breakfast|desjejum)/.test(text);
}

function shouldSendPool(text) {
  return isNumericSelection(text, '3') || /(piscina|academia|gym|ginasi|hidro)/.test(text);
}

function shouldSendParking(text) {
  return isNumericSelection(text, '4') || /(estacionamento|carro|vaga|manobrista|garagem)/.test(text);
}

function shouldSendSnacks(text) {
  return isNumericSelection(text, '5') || /(snack|conveniencia|lanche|guloseima|chocolate)/.test(text);
}

function shouldSendTowels(text) {
  return isNumericSelection(text, '6') || /(toalha|troca de toalha|roupa de banho)/.test(text);
}

function shouldSendRestaurant(text) {
  return isNumericSelection(text, '7') || /(restaurante do hotel|restaurante no hotel|almoco|jantar|refeicao|refeicoes)/.test(text);
}

function shouldSendCheckin(text) {
  return isNumericSelection(text, '8') || /(checkin|check-in|checkout|check-out|horario de checkin|horario de checkout|entrada|saida|saída)/.test(text);
}

function shouldSendTransfer(text) {
  return isNumericSelection(text, '9') || /(transfer|aeroporto|uber|taxi|traslado)/.test(text);
}

function shouldSendHuman(text) {
  return isNumericSelection(text, '10') || /\b(falar com atendente|falar com atendimento|falar com humano|atendente humano|atendimento humano|quero falar com alguem|quero falar com uma pessoa|quero falar com humano|preciso de atendimento humano|me chama um atendente|me encaminha para atendente|me encaminhe para atendente|suporte humano)\b/.test(text);
}

function shouldRedirectToReservationSite(text) {
  return /\b(reservar|reserva|nova reserva|fazer reserva|quero reservar|quero fazer uma reserva|como faco minha reserva|como faço minha reserva|consigo reservar|posso reservar|fechar reserva|fechar hospedagem|disponibilidade|tem vaga|tem disponibilidade|ha vaga|há vaga|valor da diaria|valor da diária|quanto custa|preco|preço|diaria|diária|quarto disponivel|quarto disponível|acomodacao|acomodação|hospedagem|ficar do dia|entrada dia|saida dia|saída dia|checkin dia|checkout dia)\b/.test(text);
}

function shouldSendSecurity(text) {
  return /(seguranca|recepcao|portaria|24h|24 horas)/.test(text);
}

function shouldSendLocation(text) {
  return /(localizacao|endereco|onde fica|diferencial|estrutura)/.test(text);
}

function shouldSendLongStay(text) {
  return /(desconto|long stay|longa estadia|mensal|mensalista)/.test(text);
}

function shouldSendCleaning(text) {
  return /(limpeza|governanca|faxina|arrumacao)/.test(text);
}

function shouldSendInternet(text) {
  return /((internet|wifi).*?(boa|sinal|velocidade|trabalh|stream)|sinal de internet|conexao)/.test(text);
}

function shouldSendLuggage(text) {
  return /(mala|bagagem|guardar|luggage|depositar)/.test(text);
}

function shouldSendGreeting(text) {
  return /\b(oi|ola|olá|bom dia|boa tarde|boa noite|e ai|eai|hey|hello|hi|como vai|tudo bem)\b/.test(text);
}

function shouldSendThanks(text) {
  return /\b(obrigado|obrigada|valeu|agradeco|agradeço|thanks|thank you)\b/.test(text);
}

function getFaqResponse(text) {
  for (const entry of FAQ_ENTRIES) {
    if (entry.patterns.some((regex) => regex.test(text))) {
      return entry.response;
    }
  }
  return null;
}

function shouldHandleReservationConfirmation(text) {
  return isNumericSelection(text, '11') || /(confirmar|confirmacao|status|codigo).*reserva/.test(text);
}

function cleanupPendingConfirmations() {
  const now = Date.now();
  for (const [key, ts] of pendingConfirmations.entries()) {
    if (now - ts > CONFIRMATION_TTL_MS) {
      pendingConfirmations.delete(key);
    }
  }
}

function rememberPendingConfirmation(phone) {
  pendingConfirmations.set(phone, Date.now());
}

function isAwaitingCode(phone) {
  cleanupPendingConfirmations();
  return pendingConfirmations.has(phone);
}

function extractReservationCode(rawText) {
  if (!rawText) return null;
  const tokens = rawText.toUpperCase().replace(/[^A-Z0-9]/g, ' ').split(' ');
  for (const token of tokens) {
    if (token.length >= 4 && token.length <= 8 && /[A-Z]/.test(token) && /[0-9]/.test(token)) {
      return token;
    }
  }
  return null;
}

async function maybeHandleReservationConfirmation({ rawText, normalizedText, from, cameFromAudio = false }) {
  const expectingCode = isAwaitingCode(from);
  const wantsConfirmation = expectingCode || shouldHandleReservationConfirmation(normalizedText);
  if (!wantsConfirmation) {
    return false;
  }

  const code = extractReservationCode(rawText);
  if (!code) {
    rememberPendingConfirmation(from);
    await replyToGuest(from, CONFIRMATION_PROMPT, { alsoSendAudio: cameFromAudio });
    return true;
  }

  const reservation = await fetchReservationByCode(code);
  if (reservation) {
    pendingConfirmations.delete(from);
    await replyToGuest(from, formatReservationMessage(reservation), { alsoSendAudio: cameFromAudio });
  } else {
    rememberPendingConfirmation(from);
    await replyToGuest(from, RESERVATION_NOT_FOUND(code), { alsoSendAudio: cameFromAudio });
  }
  return true;
}

async function fetchReservationByCode(code) {
  if (!STAYS_USERNAME || !STAYS_PASSWORD) {
    console.error('Missing Stays credentials');
    return null;
  }

  const auth = Buffer.from(`${STAYS_USERNAME}:${STAYS_PASSWORD}`).toString('base64');
  const url = `${STAYS_BASE_URL.replace(/\/$/, '')}/booking/reservations/${encodeURIComponent(code)}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const text = await response.text();
      console.error('Failed to fetch reservation', response.status, text);
      return null;
    }

    const data = await response.json();
    const reservation = data?.reservation || data;
    if (reservation && reservation.id) {
      return reservation;
    }
  } catch (err) {
    console.error('Error fetching reservation', err);
  }
  return null;
}

function formatReservationMessage(reservation) {
  const guest = resolveGuestName(reservation);
  const listing = reservation.listing?.internalName || reservation.listing?.id || '';
  const partner = reservation.partnerName || reservation.partner?.name || 'canal direto';
  const status = formatReservationStatus(reservation.type);
  const checkin = formatDateBRT(reservation.checkInDate || reservation.checkin);
  const checkout = formatDateBRT(reservation.checkOutDate || reservation.checkout);
  const guests = reservation.guestTotalCount || reservation.guests || reservation.persons || 1;
  const nights = reservation.nightCount || reservation.nights || '';

  const parts = [
    `Confirmei aqui: a reserva ${reservation.id} (${partner}) está ${status}.`,
    guest ? `Hóspede: ${guest}.` : '',
    checkin && checkout ? `Período: ${checkin} até ${checkout}${nights ? ` · ${nights} noite(s)` : ''}.` : '',
    guests ? `${guests} hóspede(s)${listing ? ` · Flat ${listing}` : ''}.` : listing ? `Flat ${listing}.` : '',
    'Qualquer ajuste, me avisa que eu cuido por aqui. 🌴',
  ].filter(Boolean);

  return parts.join('\n');
}

function resolveGuestName(reservation) {
  if (reservation.client?.name) return reservation.client.name;
  if (reservation.guest_name) return reservation.guest_name;
  const lists = [
    reservation.guestsDetails?.list,
    reservation.guests?.list,
    Array.isArray(reservation.guests) ? reservation.guests : null,
  ];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    const primary = list.find((item) => item?.primary) || list.find((item) => item?.name && !item.name.toLowerCase().startsWith('adult_')) || list[0];
    if (primary?.name) {
      return primary.name;
    }
  }
  return reservation.contact?.name || null;
}

function formatReservationStatus(type) {
  const mapping = {
    booked: 'confirmada ✅',
    reserved: 'pendente de confirmação',
    contract: 'em contrato',
    canceled: 'cancelada ❌',
    maintenance: 'bloqueada para manutenção',
    blocked: 'bloqueada',
  };
  return mapping[type] || 'em andamento';
}

function formatDateBRT(dateStr) {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  }
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function getCurrentDateBRT() {
  return new Date().toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo'
  });
}

function getCurrentTimeBRT() {
  return new Date().toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function shouldSendCurrentDate(text) {
  return /\b(que dia e hoje|que dia é hoje|qual a data de hoje|data de hoje|hoje e que dia|hoje é que dia|me diga a data|qual a data)\b/.test(text);
}

function shouldSendCurrentTime(text) {
  return /\b(que horas sao|que horas são|qual o horario|qual o horário|hora atual|horario agora|horário agora|me diga as horas)\b/.test(text);
}

async function getChatGptFallbackReply(userMessage, phone) {
  if (!OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY');
    return null;
  }

const systemPrompt = `
Você é o concierge virtual da TorresGuest, com atendimento humano, cordial, elegante e objetivo.

Responda sempre em português do Brasil.

Nunca invente informações.

Contexto confiável da operação:

- TorresGuest opera flats particulares dentro de um hotel em Perdizes, São Paulo/SP.
- Próximo ao Allianz Parque, PUC-SP e Shopping Bourbon.
- Café da manhã: todos os dias, das 06h30 às 10h00, no restaurante do lobby.
- Piscina e academia: todos os dias, das 08h00 às 21h00.
- Check-in: a partir das 14h.
- Check-out: até 12h.
- Recepção e segurança: 24 horas.
- Estacionamento com manobrista dentro do prédio, sem custo adicional para hóspedes.
- Transfer aeroporto: sob demanda e com custo adicional.
- Limpeza/governança: pela equipe do hotel, com aviso prévio.
- Guarda de malas: pode ser organizada conforme disponibilidade.
- Chegadas de madrugada são possíveis, pois a recepção funciona 24 horas.

- Endereço oficial: Rua Monte Alegre, 835 - Perdizes, São Paulo - SP.

Regras:
- Sempre que o hóspede perguntar endereço, localização ou como chegar, responda EXATAMENTE:
  "Rua Monte Alegre, 835 - Perdizes, São Paulo - SP."
- Nunca informe outro endereço.
- Nunca comece respostas com "Olá", "Oi", "Bom dia", "Boa tarde" ou qualquer saudação.
- Responda direto ao ponto, de forma natural, como uma conversa contínua.
- Responda de forma curta, útil, natural e acolhedora.
- Sempre tente responder diretamente.
- O atendimento deve ser 100% focado em hospedagem, turismo, estadia, estrutura do hotel e região de Perdizes.
- Nunca responda ou desenvolva assuntos fora desse contexto.
- Se o hóspede perguntar sobre temas fora da hospedagem (ex: política, guerras, notícias, tecnologia, OpenAI, programação, curiosidades gerais ou qualquer outro assunto não relacionado à estadia), responda de forma educada redirecionando para hospedagem.
- Nestes casos, responda de forma breve como:
  "Posso te ajudar com tudo sobre a sua hospedagem na TorresGuest 😊 Me diga o que você precisa durante sua estadia."
- Nunca aprofunde ou continue conversas fora do contexto da hospedagem.
- Só encaminhe para humano quando for necessário.
`.trim();
  
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: systemPrompt }]
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: `Telefone: ${phone}\nMensagem: ${userMessage}` }]
        }
      ]
    }),
  });

  const raw = await response.text();
  console.log('[openai fallback raw]', raw);

  if (!response.ok) {
    console.error('OpenAI fallback failed', response.status, raw);
    return null;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse JSON', err);
    return null;
  }

  if (data.output_text && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const text =
    data.output
      ?.flatMap(item => item.content || [])
      ?.map(item => item.text || '')
      ?.join(' ')
      ?.trim() || null;

  return text;
}

async function downloadWhatsAppMedia(mediaId) {
  if (!WHATSAPP_TOKEN) {
    throw new Error('Missing WhatsApp token');
  }

  const metaRes = await fetch(`https://graph.facebook.com/v25.0/${mediaId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    },
  });

  if (!metaRes.ok) {
    const errorText = await metaRes.text();
    throw new Error(`Failed to fetch media metadata: ${metaRes.status} ${errorText}`);
  }

  const meta = await metaRes.json();
  if (!meta?.url) {
    throw new Error('Media URL not found');
  }

  const fileRes = await fetch(meta.url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    },
  });

  if (!fileRes.ok) {
    const errorText = await fileRes.text();
    throw new Error(`Failed to download media: ${fileRes.status} ${errorText}`);
  }

  const arrayBuffer = await fileRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function transcribeAudioBuffer(buffer, mimeType = 'audio/ogg') {
  if (!OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY');
    return null;
  }

  const form = new FormData();
  const ext = mimeType.includes('mpeg') ? 'mp3' : mimeType.includes('mp4') ? 'mp4' : mimeType.includes('wav') ? 'wav' : 'ogg';

  form.append(
    'file',
    new Blob([buffer], { type: mimeType }),
    `guest-audio.${ext}`
  );
  form.append('model', OPENAI_TRANSCRIBE_MODEL);

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: form,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI transcription failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data?.text?.trim() || null;
}

function shortenForAudio(text) {
  if (!text) return text;

  return text
    .replace(/\n+/g, ' ')           // remove quebras
    .replace(/\.\s+/g, '. ')       // mantém fluidez
    .replace(/:\s+/g, ', ')        // evita pausa longa
    .replace('Se quiser voltar ao menu, é só digitar "menu".', '')
    .replace('Qualquer coisa que precisar, estou por aqui para te ajudar. 🌴', 'Qualquer coisa, estou por aqui.')
    .trim();
}

async function replyToGuest(to, text, options = {}) {
  const { alsoSendAudio = false } = options;

  // Se veio áudio → responde SOMENTE com áudio
  if (alsoSendAudio) {
    try {
      const shortAudioText = shortenForAudio(text);

      if (shortAudioText.length > 600) {
        await sendWhatsAppText(to, text);
        return;
      }

      const audioBuffer = await synthesizeSpeechBuffer(shortAudioText);
      const mediaId = await uploadWhatsAppAudio(audioBuffer, 'reply.mp3', 'audio/mpeg');
      await sendWhatsAppAudio(to, mediaId);
      return;

    } catch (err) {
      console.error('Failed to send audio reply', err);
      await sendWhatsAppText(to, text);
      return;
    }
  }

  // Se veio texto → responde SOMENTE com texto
  await sendWhatsAppText(to, text);
}

async function synthesizeSpeechBuffer(text) {
  if (!OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY');
  }

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      voice: OPENAI_TTS_VOICE,
      input: text,
      format: 'mp3',
      instructions: 'Fale em português do Brasil de forma natural, simpática e acolhedora, com ritmo mais rápido, fluido e com poucas pausas. Evite falar devagar ou robótico.'
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI speech failed: ${response.status} ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function uploadWhatsAppAudio(buffer, filename = 'reply.mp3', mimeType = 'audio/mpeg') {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    throw new Error('Missing WhatsApp credentials');
  }

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', new Blob([buffer], { type: mimeType }), filename);

  const response = await fetch(`https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/media`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    },
    body: form,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`WhatsApp media upload failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  if (!data?.id) {
    throw new Error('WhatsApp media upload returned no media id');
  }

  return data.id;
}

async function sendWhatsAppAudio(to, mediaId) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    throw new Error('Missing WhatsApp credentials');
  }

  const response = await fetch(`https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'audio',
      audio: {
        id: mediaId,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`WhatsApp send audio failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  console.log('WhatsApp audio reply sent', JSON.stringify(data));
}

async function sendWhatsAppText(to, body) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error('Missing WhatsApp credentials');
    return;
  }

  const url = `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: {
      preview_url: false,
      body,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Failed to send WhatsApp message', response.status, errorText);
  } else {
    const data = await response.json();
    console.log('WhatsApp reply sent', JSON.stringify(data));
  }
}

const server = app.listen(PORT, () => {
  console.log(`WhatsApp webhook server listening on port ${PORT}`);
});

server.on('close', () => {
  console.log('Webhook server closed');
});

server.on('error', (err) => {
  console.error('Webhook server error:', err);
});
