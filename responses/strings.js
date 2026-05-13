'use strict';

const {
  HUMAN_NUMBER_PRIMARY,
  HUMAN_NUMBER_SECONDARY,
} = require('../config');

const MENU_RESPONSE = `Ol\u00e1! Seja muito bem-vindo(a) \u00e0 TorresGuest \ud83d\ude0a\n\nEstou aqui para te ajudar com tudo da sua hospedagem. Escolha uma op\u00e7\u00e3o ou digite o tema direto:\n\n1\ufe0f\u20e3 Wi-Fi\n2\ufe0f\u20e3 Caf\u00e9 da manh\u00e3\n3\ufe0f\u20e3 Piscina e academia\n4\ufe0f\u20e3 Estacionamento\n5\ufe0f\u20e3 Snacks no apartamento\n6\ufe0f\u20e3 Troca de toalhas\n7\ufe0f\u20e3 Restaurante\n8\ufe0f\u20e3 Check-in / Check-out\n9\ufe0f\u20e3 Transfer aeroporto\n\ud83d\udd1f Falar com atendimento humano\n1\ufe0f\u20e31\ufe0f\u20e3 Confirmar minha reserva\n\n\u00c9 s\u00f3 responder com o n\u00famero ou escrever o assunto. Sempre que precisar, estou por aqui! \ud83c\udf34`;

const HUMAN_ESCALATION_RESPONSE = `Neste caso favor entrar em contato com a Sofia que atende no WhatsApp ${HUMAN_NUMBER_SECONDARY}. Cuidaremos para responder melhor suas duvidas. \ud83d\ude0a`;

const CONFIRMATION_PROMPT = `Claro! Me envia o c\u00f3digo da sua reserva com 5 digitos (letras e n\u00fameros) que foi confirmada por e-mail (exemplo: IC09J) para eu confirmar no sistema.`;

const WIFI_RESPONSE = `O Acesso ao Wi-Fi \u00e9 atrav\u00e9s da rede do hotel. Ao abrir o portal Captiva, basta informar o Nome + CPF (os mesmos do check-in).\nSe tiver qualquer dificuldade, me chama aqui que eu ajudo. \ud83c\udf34`;

const BREAKFAST_RESPONSE = `\u2615 O Caf\u00e9 da Manh\u00e3 est\u00e1 incluso na sua reserva, servido no restaurante do lobby (em frente \u00e0 recep\u00e7\u00e3o).\n\ud83d\udd52 Todos os dias, das 06h30 \u00e0s 10h00.\nAproveite para come\u00e7ar o dia muito bem! \ud83c\udf34`;

const POOL_RESPONSE = `\ud83c\udfca\u200d\u2640\ufe0f Piscina & Academia est\u00e3o dispon\u00edveis dentro da infraestrutura do hotel acess\u00edvel todos os dias, das 08h00 \u00e0s 21h00.\nAproveite a piscina para relaxar e a academia para manter a rotina! \ud83c\udf34`;

const PARKING_RESPONSE = `\ud83d\ude97 O estacionamento incluso em sua reserva \u00e9 dentro do pr\u00e9dio, com manobrista.\nBasta informar que est\u00e1 hospedado em flat do condom\u00ednio.\n\u2714\ufe0f Sem custo adicional para h\u00f3spedes. Qualquer d\u00favida, me avisa! \ud83c\udf34`;

const SNACKS_RESPONSE = `\ud83c\udf6b Os Snacks e Conveni\u00eancia\nDeixamos no apartamento para sua comodidade.\n\ud83d\udcb3 Pagamento via PIX 62.169.624/0001-94.\n\ud83d\udccb A tabela est\u00e1 na bancada; se preferir, te envio aqui.\nCurta com vontade! \ud83c\udf34`;

const TOWELS_RESPONSE = `\ud83e\uddf3 A Troca de Toalhas para estadias acima de dois dias, \u00e9 feita a cada 48h.\nSe precisar antes, \u00e9 s\u00f3 me avisar que agilizo com a governan\u00e7a. \ud83c\udf34`;

const RESTAURANT_RESPONSE = `\ud83c\udf7d\ufe0f *Restaurante Don Maitre* (no pr\u00f3prio pr\u00e9dio, acesso pelo lobby)\n\nCozinha italiana \u00e0 la carte \u2014 almo\u00e7o, jantar e room service.\n\n\ud83d\udcdd Card\u00e1pio completo + fotos: https://conciergecloud.com.br/restaurante.html\n\u260e\ufe0f Pedidos: ligue (11) 3801-3750 \u2192 pe\u00e7a *Ramal 2013* (Don Maitre)\n\ud83c\udf9f\ufe0f Cupom *CONCIERGECLOUD10* \u2014 10% off no pedido\n\nVale pra sal\u00e3o, room service e take-away. Qualquer d\u00favida, me chama! \ud83c\udf34`;

const { links: affLinks } = require('../utils/affiliateLinks');
const FOOD_ORDER_RESPONSE = `\ud83c\udf7d\ufe0f Para fazer pedido no restaurante Don Maitre (no pr\u00f3prio pr\u00e9dio):\n\n\ud83d\udcf2 Card\u00e1pio completo: ${affLinks.donMaitre('food_order')}\n\ud83c\udf9f\ufe0f Cupom 10% off: *CONCIERGECLOUD10*\n\nVale pra sal\u00e3o, room service e take-away. Me avisa se precisar de ajuda com o pedido! \ud83c\udf34`;

// Resposta i18n pra restaurant menu (Don Maitre). Adicionada 2026-05-04 (Valney pediu
// 4 idiomas matching o site /restaurante.html). Mesmo link affiliate em todas variantes.
const FOOD_ORDER_RESPONSE_I18N = {
  pt: FOOD_ORDER_RESPONSE,
  en: `\ud83c\udf7d\ufe0f To order at Don Maitre restaurant (right inside the building):\n\n\ud83d\udcf2 Full menu: ${affLinks.donMaitre('food_order')}\n\ud83c\udf9f\ufe0f 10% off coupon: *CONCIERGECLOUD10*\n\nAvailable for dine-in, room service and take-away. Let me know if you need help with the order! \ud83c\udf34`,
  fr: `\ud83c\udf7d\ufe0f Pour commander au restaurant Don Maitre (dans le b\u00e2timent m\u00eame):\n\n\ud83d\udcf2 Carte compl\u00e8te: ${affLinks.donMaitre('food_order')}\n\ud83c\udf9f\ufe0f Coupon 10% de r\u00e9duction: *CONCIERGECLOUD10*\n\nValable en salle, room service et \u00e0 emporter. Dites-moi si vous avez besoin d'aide pour la commande! \ud83c\udf34`,
  es: `\ud83c\udf7d\ufe0f Para pedir en el restaurante Don Maitre (dentro del propio edificio):\n\n\ud83d\udcf2 Carta completa: ${affLinks.donMaitre('food_order')}\n\ud83c\udf9f\ufe0f Cup\u00f3n 10% de descuento: *CONCIERGECLOUD10*\n\nV\u00e1lido para sal\u00f3n, room service y para llevar. Av\u00edsame si necesitas ayuda con el pedido! \ud83c\udf34`,
};
function getFoodOrderResponse(language) {
  return FOOD_ORDER_RESPONSE_I18N[language] || FOOD_ORDER_RESPONSE_I18N.pt;
}

// Curso Hotmart "Desvendando o Airbnb" — afiliação ativa (cookie 180d, 50% comm).
// Disparado por shouldSendHostingCourse pra prospects que querem ser anfitriões.
// Link direto Hotmart preserva o código de afiliado B105630974J.
const HOSTING_COURSE_RESPONSE = `🏠 Tem interesse em ser anfitrião de Airbnb? Recomendamos o curso *Desvendando o Airbnb* — feito por quem opera múltiplas unidades no Brasil:

📚 Acesse: https://go.hotmart.com/B105630974J
🎯 Aulas práticas: precificação, anúncio, fotos, resenhas, pricing dinâmico
💰 Investimento baixo · garantia 7 dias

Se quiser trocar uma ideia primeiro, posso te conectar com a Sofia no ${HUMAN_NUMBER_SECONDARY}. 🌴`;

const CHECKIN_RESPONSE = `\ud83d\udd50 Check-in & Check-out possuem limites de hor\u00e1rio, sobretudo o check-out, pois o time de governan\u00e7a do hotel pede uma hora para limpeza e higieniza\u00e7\u00e3o.\nCheck-in: a partir das 14h\nCheck-out: at\u00e9 12h\nA recep\u00e7\u00e3o funciona 24h com equipe de seguran\u00e7a para te receber em qualquer hor\u00e1rio. \ud83c\udf34`;

// \u2500\u2500 FAQ coverage gaps (06/05/2026) \u2014 10 templates novos \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Phase 1 cr\u00edticos: Documents, HotelAccess, Safe, Invoice
// Phase 2 m\u00e9dios: CommonAreas, Bedding, DateChange, HotelMaintenance,
// BreakfastCompanion, ParkingEarly. Tom cauteloso/multi-tenant.

const DOCUMENTS_RESPONSE = `\ud83d\udcc4 Para o check-in, todos os h\u00f3spedes precisam apresentar *documento oficial com foto* (RG, CNH ou passaporte) na recep\u00e7\u00e3o.

Em caso de menores de idade, traga tamb\u00e9m o documento da crian\u00e7a ou adolescente. Qualquer d\u00favida, me chama. \ud83c\udf34`;

const HOTEL_ACCESS_RESPONSE = `\ud83c\udfe8 Sua hospedagem \u00e9 em um *flat privativo administrado pela TorresGuest*, dentro da estrutura do hotel.

Ao chegar, \u00e9 s\u00f3 ir direto na *recep\u00e7\u00e3o 24h do hotel*, apresentar seu documento com foto e informar o nome da reserva. A recep\u00e7\u00e3o faz seu cadastro de entrada. \ud83c\udf34`;

const SAFE_RESPONSE = `\ud83d\udd10 O quarto possui cofre dispon\u00edvel para uso. Em caso de d\u00favida sobre opera\u00e7\u00e3o ou se travar, me avisa o n\u00famero do quarto que oriento ou aciono a recep\u00e7\u00e3o pra te ajudar com o procedimento de seguran\u00e7a. \ud83c\udf34`;

const INVOICE_RESPONSE = `\ud83e\uddfe Pra emiss\u00e3o de *nota fiscal ou recibo*, vou conectar voc\u00ea com a *Sofia* (nossa equipe administrativa) que cuida disso:\n\n\ud83d\udcde ${HUMAN_NUMBER_SECONDARY}\n\nEla j\u00e1 foi avisada e vai te chamar em breve. \ud83c\udf34`;

const COMMON_AREAS_RESPONSE = `\ud83c\udfca Como h\u00f3spede TorresGuest, voc\u00ea tem acesso \u00e0s \u00e1reas comuns do hotel: *piscina, academia, restaurante, recep\u00e7\u00e3o 24h e business center*, conforme regras internas e hor\u00e1rios de funcionamento. Qualquer d\u00favida espec\u00edfica, me chama. \ud83c\udf34`;

const BEDDING_RESPONSE = `\ud83d\udecf\ufe0f Posso verificar disponibilidade de itens extras de cama (travesseiro, cobertor, len\u00e7ol, fronha). Me envia o n\u00famero do quarto e o item que precisa, que aciono a governan\u00e7a. \ud83c\udf34`;

const DATE_CHANGE_RESPONSE = `\ud83d\udcc5 Sobre altera\u00e7\u00e3o de datas: a possibilidade depende da pol\u00edtica da reserva, disponibilidade e canal onde foi feita.

Me envia por favor:
1. Nome completo da reserva
2. Data atual da reserva
3. Nova data desejada
4. Canal (Booking, Airbnb, Expedia, Decolar ou TorresGuest)

Vou verificar e te retornar. \ud83c\udf34`;

const HOTEL_MAINTENANCE_RESPONSE = `\ud83d\udd27 O hotel pode passar por melhorias e manuten\u00e7\u00f5es pontuais, geralmente em hor\u00e1rio comercial. Caso qualquer obra ou ru\u00eddo impacte sua estadia, me avisa imediatamente que acompanho junto \u00e0 equipe do hotel. \ud83c\udf34`;

const BREAKFAST_COMPANION_RESPONSE = `\u2615 Pra incluir acompanhante ou caf\u00e9 extra, recomendamos consultar diretamente a *recep\u00e7\u00e3o do hotel* \u2014 eles confirmam disponibilidade e valores atualizados na hora. Se preferir, me avisa o n\u00famero do quarto que verifico junto \u00e0 equipe. \ud83c\udf34`;

const PARKING_EARLY_RESPONSE = `\ud83d\ude97 A possibilidade de deixar o carro antes do hor\u00e1rio de check-in depende da disponibilidade e libera\u00e7\u00e3o da recep\u00e7\u00e3o do hotel no momento da chegada. Recomendamos confirmar diretamente na recep\u00e7\u00e3o quando chegar. \ud83c\udf34`;

// \u2500\u2500 Tenant-aware builders \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Quando tenantId !== 'torres' E tenant.settings tem o campo, montamos resposta
// din\u00e2mica baseada nas configs do anfitri\u00e3o. Caso contr\u00e1rio fallback pra
// resposta hardcoded da TorresGuest (compat).

function buildBreakfastResponse(tenant) {
  const isTorres = !tenant || tenant.tenantId === 'torres' || !tenant.settings || !tenant.settings.breakfast;
  if (isTorres) return BREAKFAST_RESPONSE;
  const b = tenant.settings.breakfast;
  if (b.enabled === false || b.type === 'none') {
    return `\u2615 A propriedade *n\u00e3o oferece caf\u00e9 da manh\u00e3*. Posso te indicar op\u00e7\u00f5es pr\u00f3ximas se quiser. \ud83c\udf34`;
  }
  const hours = b.hours || '06h30 \u00e0s 10h00';
  const location = b.location ? `, no ${b.location}` : '';
  if (b.type === 'included') {
    return `\u2615 O caf\u00e9 da manh\u00e3 est\u00e1 *incluso na sua reserva*${location}.\n\ud83d\udd52 ${hours}.\nAproveite e bom dia! \ud83c\udf34`;
  }
  if (b.type === 'paid') {
    return `\u2615 A propriedade oferece caf\u00e9 da manh\u00e3 *com cobran\u00e7a extra*${location}.\n\ud83d\udd52 ${hours}.${b.cost ? '\n\ud83d\udcb0 Valor: ' + b.cost : ''}\nQualquer d\u00favida, me avisa. \ud83c\udf34`;
  }
  return `\u2615 Caf\u00e9 da manh\u00e3 dispon\u00edvel${location}.\n\ud83d\udd52 ${hours}.${b.note ? '\n' + b.note : ''} \ud83c\udf34`;
}

function buildParkingResponse(tenant) {
  const isTorres = !tenant || tenant.tenantId === 'torres' || !tenant.settings || !tenant.settings.parking;
  if (isTorres) return PARKING_RESPONSE;
  const p = tenant.settings.parking;
  if (p.type === 'none') {
    return `\ud83d\ude97 A propriedade *n\u00e3o oferece estacionamento*. Posso te indicar op\u00e7\u00f5es pr\u00f3ximas se precisar. \ud83c\udf34`;
  }
  const loc = p.location ? ` ${p.location}` : '';
  if (p.type === 'valet-included') {
    return `\ud83d\ude97 Estacionamento com manobrista${loc}, *sem custo adicional* pra h\u00f3spedes.${p.note ? ' ' + p.note : ''} \ud83c\udf34`;
  }
  if (p.type === 'valet-paid') {
    return `\ud83d\ude97 Estacionamento com manobrista${loc}.${p.cost ? ' Valor: ' + p.cost + '.' : ''}${p.note ? ' ' + p.note : ''} \ud83c\udf34`;
  }
  if (p.type === 'external') {
    return `\ud83d\ude97 Estacionamento *externo*${loc ? ', em ' + p.location : ''}.${p.cost ? ' Valor: ' + p.cost + '.' : ''}${p.note ? ' ' + p.note : ''} \ud83c\udf34`;
  }
  return PARKING_RESPONSE;
}

const SECURITY_RESPONSE = `\ud83d\udd10 Contamos com Seguran\u00e7a & Recep\u00e7\u00e3o 24h, controle de acesso e equipe no local o tempo todo.\nPode chegar tranquilo(a), estamos sempre por perto. \ud83c\udf34`;

// Transfer / t\u00e1xi \u2014 agora oferece DUAS op\u00e7\u00f5es:
//   1) Uber direto (auto-servi\u00e7o, imediato) \u2014 UTM ConciergeCloud pra tracking
//   2) Transfer organizado com motorista cadastrado pelo anfitri\u00e3o (premium)
// Adicionado fallback Uber em 09/05/2026 conforme spec contratual de cobertura
// "Pedido de t\u00e1xi (com fallback Uber)" do plano Pro/Agency.
const UBER_FALLBACK_URL = 'https://m.uber.com/?utm_source=conciergecloud&utm_medium=whatsapp_bot&utm_campaign=taxi_fallback';

const TRANSFER_RESPONSE = `\u2708\ufe0f Transfer / T\u00e1xi\nDuas op\u00e7\u00f5es pra voc\u00ea:\n\n\ud83d\ude96 *Uber agora* (auto-servi\u00e7o):\n${UBER_FALLBACK_URL}\n\n\ud83d\udc64 *Transfer organizado* (motorista de confian\u00e7a, custo adicional):\nMe avise seu voo e hor\u00e1rio que conecto voc\u00ea direto com nossa concierge no ${HUMAN_NUMBER_PRIMARY} ou ${HUMAN_NUMBER_SECONDARY} pra finalizar os detalhes. \ud83c\udf34`;

const TRANSFER_RESPONSE_I18N = {
  pt: TRANSFER_RESPONSE,
  en: `\u2708\ufe0f Transfer / Taxi\nTwo options for you:\n\n\ud83d\ude96 *Uber now* (self-service):\n${UBER_FALLBACK_URL}\n\n\ud83d\udc64 *Scheduled transfer* (trusted driver, additional cost):\nSend me your flight and time and I'll connect you with our concierge at ${HUMAN_NUMBER_PRIMARY} or ${HUMAN_NUMBER_SECONDARY} to sort the details. \ud83c\udf34`,
  fr: `\u2708\ufe0f Transfert / Taxi\nDeux options pour vous:\n\n\ud83d\ude96 *Uber maintenant* (auto-service):\n${UBER_FALLBACK_URL}\n\n\ud83d\udc64 *Transfert programm\u00e9* (chauffeur de confiance, co\u00fbt suppl\u00e9mentaire):\nEnvoyez-moi votre vol et l'heure, je vous mets en relation avec notre concierge au ${HUMAN_NUMBER_PRIMARY} ou ${HUMAN_NUMBER_SECONDARY} pour les d\u00e9tails. \ud83c\udf34`,
  es: `\u2708\ufe0f Traslado / Taxi\nDos opciones para ti:\n\n\ud83d\ude96 *Uber ahora* (auto-servicio):\n${UBER_FALLBACK_URL}\n\n\ud83d\udc64 *Traslado programado* (conductor de confianza, costo adicional):\nAv\u00edsame tu vuelo y horario, te conecto con nuestra concierge en ${HUMAN_NUMBER_PRIMARY} o ${HUMAN_NUMBER_SECONDARY} para los detalles. \ud83c\udf34`,
};

function getTransferResponse(language) {
  return TRANSFER_RESPONSE_I18N[language] || TRANSFER_RESPONSE_I18N.pt;
}

const LOCATION_RESPONSE = `\ud83d\udccd Diferenciais TorresGuest\n\u2022 Flats dentro de um hotel completo (piscina, academia, restaurante)\n\u2022 Localiza\u00e7\u00e3o excelente em Perdizes, S\u00e3o Paulo/SP\n\u2022 Pr\u00f3ximo ao Allianz Parque, PUC-SP e Shopping Bourbon\n\u2022 Atendimento pr\u00f3ximo e humanizado, estilo concierge\n\nIdeal para lazer ou trabalho. Precisa de algo espec\u00edfico? S\u00f3 chamar! \ud83c\udf34`;

const LONG_STAY_RESPONSE = `\ud83d\udcb0 Estadias longas\nTemos condi\u00e7\u00f5es especiais para per\u00edodos estendidos.\nMe conta quantas noites e datas que converso com a equipe no ${HUMAN_NUMBER_PRIMARY}/${HUMAN_NUMBER_SECONDARY} e j\u00e1 retorno com a proposta. \ud83c\udf34`;

const CLEANING_RESPONSE = `\ud83e\uddf9 Limpeza / Governan\u00e7a\nA limpeza \u00e9 realizada pela equipe do hotel, geralmente entre 10:00 e 15:00.\nSe precisar de um hor\u00e1rio espec\u00edfico ou prefere n\u00e3o ser inc\u00f3modado nesse intervalo, me avise com 24h de anteced\u00eancia que eu agendo pra voc\u00ea. \ud83c\udf34`;

const INTERNET_RESPONSE = `\ud83d\udce1 Internet\nO Wi-Fi do hotel \u00e9 fibra, ideal para trabalho remoto e streaming.\nSe notar qualquer instabilidade, me chama que aciono o time t\u00e9cnico na hora. \ud83c\udf34`;

const LUGGAGE_RESPONSE = `\ud83e\uddf3 Guarda de malas\nPrecisando deixar bagagem antes do check-in ou depois do check-out?\nTemos um acordo com o Sr. Alberto (chefe do restaurante) para guardar as malas de nossos hospedes conforme disponibilidade. \nMe informe hor\u00e1rios que j\u00e1 deixo alinhado com ele. \ud83c\udf34`;

const GREETING_RESPONSE = (name) =>
  `Ol\u00e1${name ? ', ' + name : ''}! \ud83d\ude0a Sou o concierge digital da TorresGuest e vou te ajudar por aqui.\n\nMe diga o que voc\u00ea precisa, ou digite *menu* para ver as op\u00e7\u00f5es. \ud83c\udf34`;

const THANKS_RESPONSE = `Imagina! \ud83d\ude0a\n\nQualquer coisa que precisar, estou por aqui para te ajudar. \ud83c\udf34`;

const RESERVATION_SITE_RESPONSE = `As reservas s\u00e3o feitas exclusivamente pelo nosso site oficial:\n\n\ud83c\udf10 www.torresguest.com.br\n\nPor aqui no WhatsApp eu n\u00e3o realizo reservas nem consulto disponibilidade para novas hospedagens.`;

const RESERVATION_NOT_FOUND = (code) =>
  `Ainda n\u00e3o localizei a reserva ${code}. Voc\u00ea consegue confirmar se o c\u00f3digo est\u00e1 correto ou me enviar o print do canal? Se preferir, nosso atendimento humano resolve rapidinho nos n\u00fameros ${HUMAN_NUMBER_PRIMARY} e ${HUMAN_NUMBER_SECONDARY}.`;

function getReservationResponse(lang) {
  if (lang === 'en') {
    return `Reservations must be made exclusively through our official website:\n\n\ud83c\udf10 www.torresguest.com.br\n\nWe do not process reservations via WhatsApp.`;
  }
  if (lang === 'es') {
    return `Las reservas se realizan exclusivamente a trav\u00e9s de nuestro sitio web oficial:\n\n\ud83c\udf10 www.torresguest.com.br\n\nNo realizamos reservas por WhatsApp.`;
  }
  return `As reservas s\u00e3o feitas exclusivamente pelo nosso site oficial:\n\n\ud83c\udf10 www.torresguest.com.br\n\nPor aqui no WhatsApp n\u00e3o realizo reservas nem consulto disponibilidade.`;
}

function getLocationResponse(lang) {
  if (lang === 'en') {
    return `\ud83d\udccd TorresGuest Highlights\n\u2022 Private flats inside a full-service hotel (pool, gym, restaurant)\n\u2022 Excellent location in Perdizes, S\u00e3o Paulo/SP\n\u2022 Close to Allianz Parque, PUC-SP and Shopping Bourbon\n\u2022 Personal and humanized service, concierge style\n\nPerfect for leisure or business. Need anything specific? Just ask! \ud83c\udf34`;
  }
  return LOCATION_RESPONSE;
}


/**
 * Resposta para EARLY_COMPANION_ARRIVAL.
 *
 * Quando temos o staysId da reserva ativa do titular, devolvemos o link
 * direto do pré-checkin — o titular encaminha pra acompanhante por
 * qualquer canal e ela mesma preenche (doc + nome + horário) no
 * formulário web, que dispara o email pra recepção AHI (Feature B).
 *
 * Quando não temos staysId (reserva não localizada), caímos na versão
 * sem link — pede os dados pelo WhatsApp e escala pra Sofia se preciso.
 */
function getEarlyCompanionArrivalResponse(staysId, publicUrl) {
  const base = publicUrl || 'https://conciergecloud.com.br';
  if (staysId) {
    return `Claro! 🌴 Podemos receber seu(a) acompanhante antes da sua chegada — ele(a) faz parte da sua reserva, sem problema.

É só ele(a) preencher o pré-checkin neste link:

🔗 ${base}/checkin/${staysId}

Leva 2 minutos. O formulário pede:
📄 Documento com foto (RG ou CNH — frente e verso)
👤 Nome completo
🕐 Horário previsto de chegada

Pode encaminhar o link por aqui mesmo ou por outro canal. Assim que ele(a) enviar, a recepção é avisada automaticamente e na chegada é só apresentar o documento original. 😊`;
  }
  return `Claro! 🌴 Podemos receber seu(a) acompanhante antes da sua chegada — ele(a) faz parte da sua reserva, sem problema.

Pra organizar a entrada dele(a), me passa por aqui:

📄 Documento com foto (RG ou CNH — frente e verso)
👤 Nome completo do(a) acompanhante
🕐 Horário previsto de chegada

Assim que receber, aviso a recepção e ele(a) só precisa apresentar o documento original na chegada. 😊`;
}

const FRIGOBAR_PIX_RESPONSE = `🍽️ *Cardápio — Frigobar & Snacks*

☕ Café – R$ 8,00
🥤 Refrigerante 350ml – R$ 8,90
🥤 Refrigerante 200/220ml – R$ 5,50
💧 Água – R$ 7,50
🍺 Cerveja 269ml – R$ 12,90
🍺 Cerveja 350ml – R$ 18,90
⚡ Energético – R$ 18,90
🧂 Salgadinhos – R$ 4,90
🍬 Drops/Balas – R$ 4,50
🍬 Chicletes – R$ 4,90
🍫 Chocolates – R$ 8,90
🥜 Amendoim – R$ 9,90
🌾 Barras de Cereais – R$ 9,90
🍹 Sucos – R$ 8,90

💳 *Pagamento via PIX:*
🏦 CNPJ: *62.169.624/0001-94*

Me confirme quando o pagamento for feito! 🌴`
const FRIGOBAR_RESTOCK_RESPONSE = `🧊 *Reposição do Frigobar*

Anotado! Estou avisando a equipe de governança agora para repor os itens.

Em breve estaremos aí para abastecer. Qualquer outra coisa, é só chamar! 🌴`;

module.exports = {
  MENU_RESPONSE,
  HUMAN_ESCALATION_RESPONSE,
  CONFIRMATION_PROMPT,
  WIFI_RESPONSE,
  BREAKFAST_RESPONSE,
  POOL_RESPONSE,
  PARKING_RESPONSE,
  SNACKS_RESPONSE,
  TOWELS_RESPONSE,
  RESTAURANT_RESPONSE,
  FOOD_ORDER_RESPONSE,
  FOOD_ORDER_RESPONSE_I18N,
  getFoodOrderResponse,
  HOSTING_COURSE_RESPONSE,
  CHECKIN_RESPONSE,
  // FAQ coverage 06/05/2026
  DOCUMENTS_RESPONSE,
  HOTEL_ACCESS_RESPONSE,
  SAFE_RESPONSE,
  INVOICE_RESPONSE,
  COMMON_AREAS_RESPONSE,
  BEDDING_RESPONSE,
  DATE_CHANGE_RESPONSE,
  HOTEL_MAINTENANCE_RESPONSE,
  BREAKFAST_COMPANION_RESPONSE,
  PARKING_EARLY_RESPONSE,
  buildBreakfastResponse,
  buildParkingResponse,
  SECURITY_RESPONSE,
  TRANSFER_RESPONSE,
  TRANSFER_RESPONSE_I18N,
  getTransferResponse,
  LOCATION_RESPONSE,
  LONG_STAY_RESPONSE,
  CLEANING_RESPONSE,
  INTERNET_RESPONSE,
  LUGGAGE_RESPONSE,
  GREETING_RESPONSE,
  THANKS_RESPONSE,
  RESERVATION_SITE_RESPONSE,
  RESERVATION_NOT_FOUND,
  getReservationResponse,
  getLocationResponse,
  FRIGOBAR_PIX_RESPONSE,
  FRIGOBAR_RESTOCK_RESPONSE,
  getEarlyCompanionArrivalResponse,
};
