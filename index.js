
const express = require('express');
const bodyParser = require('body-parser');

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

const HUMAN_ESCALATION_RESPONSE = `Para qualquer outra dúvida, nosso concierge humano atende nos WhatsApps ${HUMAN_NUMBER_PRIMARY} e ${HUMAN_NUMBER_SECONDARY}. É só chamar que cuidamos de você 24/7. 😊`;

const CONFIRMATION_PROMPT = `Claro! Me envia o código da sua reserva (ex.: IC09J) ou os dados completos para eu confirmar no sistema.`;

const WIFI_RESPONSE = `Acesso ao Wi-Fi
Conecte-se à rede do hotel e, ao abrir o portal Captiva, informe Nome + CPF (os mesmos do check-in).
Se tiver qualquer dificuldade, me chama aqui que eu ajudo. 🌴`;

const BREAKFAST_RESPONSE = `☕ Café da Manhã
Incluso na sua reserva, servido no restaurante do lobby (em frente à recepção).
🕒 Todos os dias, das 06h30 às 10h00.
Aproveite para começar o dia muito bem! 🌴`;

const POOL_RESPONSE = `🏊‍♀️ Piscina & Academia
A infraestrutura do hotel fica disponível todos os dias, das 08h00 às 21h00.
Aproveite a piscina para relaxar e a academia para manter a rotina! 🌴`;

const PARKING_RESPONSE = `🚗 Estacionamento
O estacionamento é dentro do prédio, com manobrista.
Basta informar que está hospedado em flat do condomínio.
✔️ Sem custo adicional para hóspedes. Qualquer dúvida, me avisa! 🌴`;

const SNACKS_RESPONSE = `🍫 Snacks e Conveniência
Deixamos snacks no apartamento para sua comodidade.
💳 Pagamento via PIX 62.169.624/0001-94.
📋 A tabela está na bancada; se preferir, te envio aqui.
Curta com vontade! 🌴`;

const TOWELS_RESPONSE = `🧺 Troca de Toalhas
Para estadias acima de dois dias, fazemos a troca a cada 48h.
Se precisar antes, é só me avisar que agilizo com a governança. 🌴`;

const RESTAURANT_RESPONSE = `🍽️ Restaurante do Hotel
O restaurante no lobby oferece refeições à la carte ao longo do dia.
Perfeito para quem quer comer bem sem sair do prédio. Se quiser sugestões, me chama! 🌴`;

const CHECKIN_RESPONSE = `🕐 Check-in & Check-out
Check-in: a partir das 14h
Check-out: até 12h
A recepção funciona 24h com equipe de segurança para te receber em qualquer horário. 🌴`;

const SECURITY_RESPONSE = `🔐 Segurança & Recepção
Contamos com recepção 24h, controle de acesso e equipe no local o tempo todo.
Pode chegar tranquilo(a), estamos sempre por perto. 🌴`;

const TRANSFER_RESPONSE = `✈️ Transfer Aeroporto
Oferecemos apoio com transfer sob demanda.
Me avise seu voo e horário que conecto você direto com nossa concierge no ${HUMAN_NUMBER_PRIMARY} ou ${HUMAN_NUMBER_SECONDARY} para finalizar os detalhes. 🌴`;

const LOCATION_RESPONSE = `📍 Diferenciais TorresGuest
• Flats dentro de um hotel completo (piscina, academia, restaurante)
• Localização excelente em Santos/SP
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
Organizo com a recepção conforme disponibilidade. Me informe horários que já deixo alinhado. 🌴`;


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
      for (const message of messages) {
        if (message.type !== 'text') continue;
        const body = message.text?.body || '';
        const from = message.from;
        if (!from) continue;

        const normalized = normalizeText(body);
        console.log('[incoming]', { from, body, normalized });
        const faqResponse = getFaqResponse(normalized);

        if (shouldSendMenu(normalized)) {
          console.log('[menu] sending menu response');
          await sendWhatsAppText(from, MENU_RESPONSE);
          pendingConfirmations.delete(from);
          continue;
        }

        const confirmationHandled = await maybeHandleReservationConfirmation({ rawText: body, normalizedText: normalized, from });
        if (confirmationHandled) {
          continue;
        }

        if (shouldSendMenu(normalized)) {
          await sendWhatsAppText(from, MENU_RESPONSE);
        } else if (shouldSendWifi(normalized)) {
          await sendWhatsAppText(from, WIFI_RESPONSE);
        } else if (shouldSendBreakfast(normalized)) {
          await sendWhatsAppText(from, BREAKFAST_RESPONSE);
        } else if (shouldSendPool(normalized)) {
          await sendWhatsAppText(from, POOL_RESPONSE);
        } else if (shouldSendParking(normalized)) {
          await sendWhatsAppText(from, PARKING_RESPONSE);
        } else if (shouldSendSnacks(normalized)) {
          await sendWhatsAppText(from, SNACKS_RESPONSE);
        } else if (shouldSendTowels(normalized)) {
          await sendWhatsAppText(from, TOWELS_RESPONSE);
        } else if (shouldSendRestaurant(normalized)) {
          await sendWhatsAppText(from, RESTAURANT_RESPONSE);
        } else if (shouldSendCheckin(normalized)) {
          await sendWhatsAppText(from, CHECKIN_RESPONSE);
        } else if (shouldSendSecurity(normalized)) {
          await sendWhatsAppText(from, SECURITY_RESPONSE);
        } else if (shouldSendTransfer(normalized)) {
          await sendWhatsAppText(from, TRANSFER_RESPONSE);
        } else if (shouldSendLocation(normalized)) {
          await sendWhatsAppText(from, LOCATION_RESPONSE);
        } else if (shouldSendLongStay(normalized)) {
          await sendWhatsAppText(from, LONG_STAY_RESPONSE);
        } else if (shouldSendCleaning(normalized)) {
          await sendWhatsAppText(from, CLEANING_RESPONSE);
        } else if (shouldSendInternet(normalized)) {
          await sendWhatsAppText(from, INTERNET_RESPONSE);
        } else if (shouldSendLuggage(normalized)) {
          await sendWhatsAppText(from, LUGGAGE_RESPONSE);
        } else if (faqResponse) {
          await sendWhatsAppText(from, faqResponse);
        } else if (shouldSendHuman(normalized)) {
          await sendWhatsAppText(from, HUMAN_ESCALATION_RESPONSE);
        } else {
          await sendWhatsAppText(from, `${HUMAN_ESCALATION_RESPONSE}\n\nSe quiser voltar ao menu, é só digitar "menu".`);
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
  return isNumericSelection(text, '0') || /(menu|opcao|opcoes|ajuda|inicio|start|comecar)/.test(text);
}

function shouldSendWifi(text) {
  return isNumericSelection(text, '1') || /(wi\s*-?\s*fi|wifi|senha do wi fi|internet)/.test(text);
}

function shouldSendBreakfast(text) {
  return isNumericSelection(text, '2') || /(cafe da manha|cafe|breakfast|desjejum)/.test(text);
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
  return isNumericSelection(text, '7') || /(restaurante|comida|almoco|jantar|refeicao)/.test(text);
}

function shouldSendCheckin(text) {
  return isNumericSelection(text, '8') || /(checkin|check-in|checkout|check-out|entrada|saida|saída|horario|horário)/.test(text);
}

function shouldSendTransfer(text) {
  return isNumericSelection(text, '9') || /(transfer|aeroporto|uber|taxi|traslado)/.test(text);
}

function shouldSendHuman(text) {
  return isNumericSelection(text, '10') || /(atendimento|humano|falar com alguem|concierge|suporte)/.test(text);
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

async function maybeHandleReservationConfirmation({ rawText, normalizedText, from }) {
  const expectingCode = isAwaitingCode(from);
  const wantsConfirmation = expectingCode || shouldHandleReservationConfirmation(normalizedText);
  if (!wantsConfirmation) {
    return false;
  }

  const code = extractReservationCode(rawText);
  if (!code) {
    rememberPendingConfirmation(from);
    await sendWhatsAppText(from, CONFIRMATION_PROMPT);
    return true;
  }

  const reservation = await fetchReservationByCode(code);
  if (reservation) {
    pendingConfirmations.delete(from);
    await sendWhatsAppText(from, formatReservationMessage(reservation));
  } else {
    rememberPendingConfirmation(from);
    await sendWhatsAppText(from, RESERVATION_NOT_FOUND(code));
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
