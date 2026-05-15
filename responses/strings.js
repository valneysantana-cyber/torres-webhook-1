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
const BREAKFAST_RESPONSE_EN = `☕ Breakfast is included in your stay!
🍞 Served from 6:30 AM to 10:00 AM at the hotel restaurant (lobby).
Just mention your room when you arrive.
Any questions, let me know! 🌴`;

const BREAKFAST_RESPONSE_ES = `☕ ¡El desayuno está incluido en tu estadía!
🍞 Servido de 6:30 a 10:00 en el restaurante del hotel (lobby).
Solo menciona tu habitación al llegar.
¡Cualquier duda, avísame! 🌴`;

const BREAKFAST_RESPONSE_FR = `☕ Le petit-déjeuner est inclus dans votre séjour !
🍞 Servi de 6h30 à 10h00 au restaurant de l'hôtel (lobby).
Mentionnez simplement votre chambre à votre arrivée.
Toute question, faites-moi savoir ! 🌴`;


const POOL_RESPONSE = `\ud83c\udfca\u200d\u2640\ufe0f Piscina & Academia est\u00e3o dispon\u00edveis dentro da infraestrutura do hotel acess\u00edvel todos os dias, das 08h00 \u00e0s 21h00.\nAproveite a piscina para relaxar e a academia para manter a rotina! \ud83c\udf34`;

const PARKING_RESPONSE = `\ud83d\ude97 O estacionamento incluso em sua reserva \u00e9 dentro do pr\u00e9dio, com manobrista.\nBasta informar que est\u00e1 hospedado em flat do condom\u00ednio.\n\u2714\ufe0f Sem custo adicional para h\u00f3spedes. Qualquer d\u00favida, me avisa! \ud83c\udf34`;
const PARKING_RESPONSE_EN = `🚗 The parking included with your reservation is inside the building, with valet service.
Just mention you're staying at a flat in the condominium.
✔️ No additional cost for guests. Let me know if you need anything! 🌴`;

const PARKING_RESPONSE_ES = `🚗 El estacionamiento incluido en tu reserva está dentro del edificio, con valet.
Solo menciona que te hospedas en un flat del condominio.
✔️ Sin costo adicional para huéspedes. ¡Cualquier duda, avísame! 🌴`;

const PARKING_RESPONSE_FR = `🚗 Le parking inclus dans votre réservation est à l'intérieur du bâtiment, avec voiturier.
Mentionnez simplement que vous êtes logé dans un flat de la copropriété.
✔️ Sans coût supplémentaire pour les invités. Toute question, faites-moi savoir ! 🌴`;


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

// Resposta pra pergunta "Ele/ela pode fazer o checkin?" \u2014 adicionada 13/05/2026
// ap\u00f3s caso real Sofia (Airbnb) que perguntou se marido pode fazer pr\u00e9-checkin.
const PRE_CHECKIN_WHO_CAN_RESPONSE = `\ud83d\udccb *Sim, qualquer titular ou acompanhante da reserva pode fazer o pr\u00e9-check-in online* \u2014 e \u00e9 super r\u00e1pido (3 minutos).\n\n\ud83d\udcf2 Assim que a reserva for confirmada, enviamos o link do pr\u00e9-check-in no e-mail/WhatsApp do titular. \u00c9 s\u00f3 compartilhar com quem for chegar primeiro e ele preenche os dados (documento, foto) por l\u00e1.\n\nQualquer d\u00favida no preenchimento, me chama! \ud83c\udf34`;

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

function buildBreakfastResponse(tenant, lang) {
  const isTorres = !tenant || tenant.tenantId === 'torres' || !tenant.settings || !tenant.settings.breakfast;
  if (isTorres) {
    if (lang === 'en') return BREAKFAST_RESPONSE_EN;
    if (lang === 'es') return BREAKFAST_RESPONSE_ES;
    if (lang === 'fr') return BREAKFAST_RESPONSE_FR;
    return BREAKFAST_RESPONSE;
  }
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

function buildParkingResponse(tenant, lang) {
  const isTorres = !tenant || tenant.tenantId === 'torres' || !tenant.settings || !tenant.settings.parking;
  if (isTorres) {
    if (lang === 'en') return PARKING_RESPONSE_EN;
    if (lang === 'es') return PARKING_RESPONSE_ES;
    if (lang === 'fr') return PARKING_RESPONSE_FR;
    return PARKING_RESPONSE;
  }
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

/**
 * buildGratitudeFarewellResponse — constrói resposta calorosa ESPELHADA
 * baseada nos sinais detectados pelo detectGratitudeFarewell.
 *
 * Princípios:
 *   - Reciprocidade autêntica (eco do que o hóspede disse)
 *   - Curta, sem CTA agressivo de "me diga o que precisa"
 *   - Variação: 4 templates pra evitar repetição
 *   - Emoji compatível com o que o hóspede usou
 *
 * @param {object} sig  Resultado de detectGratitudeFarewell
 * @returns {string}
 */
function buildGratitudeFarewellResponse(sig) {
  if (!sig) return null;
  const name = sig.name ? sig.name.split(' ')[0] : '';
  const greetName = name ? `, ${name}` : '';

  // 4 templates rotativos baseados nos sinais
  const parts = [];

  // Abertura calorosa
  const openers = [
    `Imagina${greetName}! 🤗`,
    `Que carinho${greetName}! 💛`,
    `Ahh, obrigada você${greetName}! 😊`,
    `Tudo de bom pra você${greetName}! ✨`,
  ];
  // Escolhe um opener baseado em hash simples (timestamp do minuto)
  const idx = Math.floor(Date.now() / 60000) % openers.length;
  parts.push(openers[idx]);

  // Eco da bênção, se houver
  if (sig.hasBlessing) {
    parts.push(`Que Deus abençoe vocês também 🙏`);
  }

  // Eco do desejo temporal, se houver
  if (sig.timePeriod) {
    const tp = sig.timePeriod;
    if (tp === 'final de semana') parts.push(`Ótimo final de semana pra vocês também!`);
    else if (tp === 'feriado') parts.push(`Ótimo feriado pra vocês também!`);
    else if (tp === 'viagem') parts.push(`Boa viagem e curtam muito!`);
    else if (tp === 'dia') parts.push(`Bom dia pra vocês também!`);
    else if (tp === 'tarde') parts.push(`Boa tarde pra vocês!`);
    else if (tp === 'noite') parts.push(`Boa noite, descansem bem!`);
    else if (tp === 'semana') parts.push(`Ótima semana pra vocês!`);
  }

  // Fechamento sem ser invasivo
  parts.push(`Fico por aqui se precisarem de qualquer coisinha 🌴`);

  return parts.join(' ');
}

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


// ════════════════════════════════════════════════════════════════════════════
// I18N CENTRAL (15/05/2026) — 4 idiomas (PT/EN/ES/FR) para TODAS as
// respostas operacionais. Cobertura 100% pro produto multilíngue.
// Default (PT) mantém o texto original. Novas keys EN/ES/FR retornam
// equivalente. Helpers no fim do bloco.
// ════════════════════════════════════════════════════════════════════════════

const I18N_RESPONSES = {
  WIFI: {
    pt: WIFI_RESPONSE,
    en: `📶 Wi-Fi access is through the hotel network. When the Captive Portal opens, just enter your Name + ID (same as check-in).\nAny difficulty, ping me here that I'll help out! 🌴`,
    es: `📶 El acceso al Wi-Fi es a través de la red del hotel. Al abrir el Portal Cautivo, solo informa Nombre + Documento (los mismos del check-in).\n¡Cualquier dificultad, avísame que te ayudo! 🌴`,
    fr: `📶 L'accès Wi-Fi se fait via le réseau de l'hôtel. Lors de l'ouverture du Portail Captif, indiquez votre Nom + Pièce d'identité (les mêmes qu'au check-in).\nUne difficulté, faites-moi savoir et je vous aide ! 🌴`,
  },
  POOL: {
    pt: POOL_RESPONSE,
    en: `🏊‍♀️ Pool & Gym are available inside the hotel facilities, open every day from 8:00 AM to 9:00 PM.\nEnjoy the pool to relax and the gym to keep your routine! 🌴`,
    es: `🏊‍♀️ La Piscina y el Gimnasio están disponibles en la infraestructura del hotel, accesibles todos los días de 8:00 a 21:00.\n¡Aprovecha la piscina para relajarte y el gimnasio para mantener la rutina! 🌴`,
    fr: `🏊‍♀️ La Piscine et la Salle de sport sont disponibles dans l'hôtel, accessibles tous les jours de 8h00 à 21h00.\nProfitez de la piscine pour vous détendre et de la salle de sport pour garder votre routine ! 🌴`,
  },
  SNACKS: {
    pt: SNACKS_RESPONSE,
    en: `🍫 Snacks & Convenience\nWe leave them in the apartment for your comfort.\n💳 Payment via PIX 62.169.624/0001-94.\n📋 The price list is on the counter; if you prefer, I'll send it here.\nEnjoy without worries! 🌴`,
    es: `🍫 Snacks y Conveniencia\nLos dejamos en el apartamento para tu comodidad.\n💳 Pago via PIX 62.169.624/0001-94.\n📋 La tabla está en la encimera; si prefieres, te la envío aquí.\n¡Disfruta sin preocupaciones! 🌴`,
    fr: `🍫 Snacks et Articles de commodité\nNous les laissons dans l'appartement pour votre confort.\n💳 Paiement via PIX 62.169.624/0001-94.\n📋 Le tableau est sur le comptoir ; si vous préférez, je vous l'envoie ici.\nProfitez sans souci ! 🌴`,
  },
  TOWELS: {
    pt: TOWELS_RESPONSE,
    en: `🧺 Towel change for stays longer than 2 days happens every 48h.\nIf you need it sooner, just let me know and I'll arrange it with housekeeping. 🌴`,
    es: `🧺 El cambio de toallas para estadías superiores a dos días se realiza cada 48h.\nSi lo necesitas antes, solo avísame que lo coordino con limpieza. 🌴`,
    fr: `🧺 Le changement de serviettes pour les séjours de plus de deux jours se fait toutes les 48h.\nSi besoin avant, prévenez-moi et j'organise avec le service de ménage. 🌴`,
  },
  RESTAURANT: {
    pt: RESTAURANT_RESPONSE,
    en: `🍽️ *Don Maitre Restaurant* (in the building itself, access via lobby)\n\nItalian à la carte cuisine — lunch, dinner and room service.\n\n📝 Full menu + photos: https://conciergecloud.com.br/restaurante.html\n☎️ Orders: call (11) 3801-3750 → ask for *Extension 2013* (Don Maitre)\n🎟️ Coupon *CONCIERGECLOUD10* — 10% off your order\n\nValid for dine-in, room service and take-away. Any questions, let me know! 🌴`,
    es: `🍽️ *Restaurante Don Maitre* (en el propio edificio, acceso por el lobby)\n\nCocina italiana à la carte — almuerzo, cena y room service.\n\n📝 Menú completo + fotos: https://conciergecloud.com.br/restaurante.html\n☎️ Pedidos: llama (11) 3801-3750 → pide *Extensión 2013* (Don Maitre)\n🎟️ Cupón *CONCIERGECLOUD10* — 10% off en tu pedido\n\nVálido para salón, room service y take-away. ¡Cualquier duda, avísame! 🌴`,
    fr: `🍽️ *Restaurant Don Maitre* (dans le bâtiment même, accès par le lobby)\n\nCuisine italienne à la carte — déjeuner, dîner et room service.\n\n📝 Menu complet + photos: https://conciergecloud.com.br/restaurante.html\n☎️ Commandes: appelez (11) 3801-3750 → demandez *Extension 2013* (Don Maitre)\n🎟️ Coupon *CONCIERGECLOUD10* — 10% de réduction sur votre commande\n\nValable pour salle, room service et take-away. Toute question, dites-moi ! 🌴`,
  },
  CHECKIN: {
    pt: CHECKIN_RESPONSE,
    en: `🕐 Check-in & Check-out have time limits, especially check-out, since the hotel housekeeping team needs one hour for cleaning.\nCheck-in: from 2:00 PM\nCheck-out: until 12:00 PM\nThe reception runs 24h with security team to welcome you any time. 🌴`,
    es: `🕐 Check-in y Check-out tienen límites de horario, sobre todo el check-out, ya que el equipo de limpieza necesita una hora.\nCheck-in: a partir de las 14h\nCheck-out: hasta las 12h\nLa recepción funciona 24h con equipo de seguridad para recibirte a cualquier hora. 🌴`,
    fr: `🕐 Check-in et Check-out ont des limites d'horaires, surtout le check-out, car l'équipe de ménage de l'hôtel a besoin d'une heure.\nCheck-in: à partir de 14h\nCheck-out: jusqu'à 12h\nLa réception fonctionne 24h avec équipe de sécurité pour vous accueillir à tout moment. 🌴`,
  },
  DOCUMENTS: {
    pt: DOCUMENTS_RESPONSE,
    en: `📄 For check-in, all guests must present an *official photo ID* (national ID, driver's license or passport) at the reception.\nForeign guests: passport is mandatory for everyone in the room.\nIf any guest is a minor, they must be accompanied by a legal guardian. 🌴`,
    es: `📄 Para el check-in, todos los huéspedes deben presentar *documento oficial con foto* (DNI, licencia o pasaporte) en la recepción.\nHuéspedes extranjeros: pasaporte es obligatorio para todos.\nSi algún huésped es menor, debe estar acompañado por un tutor legal. 🌴`,
    fr: `📄 Pour le check-in, tous les invités doivent présenter une *pièce d'identité officielle avec photo* (carte d'identité, permis ou passeport) à la réception.\nInvités étrangers: passeport obligatoire pour tous.\nSi un invité est mineur, il doit être accompagné par un tuteur légal. 🌴`,
  },
  HOTEL_ACCESS: {
    pt: HOTEL_ACCESS_RESPONSE,
    en: `🏨 Your stay is in a *private flat managed by TorresGuest*, within the hotel structure.\nYou have full access to common areas (pool, gym, restaurant, 24h reception).\nAny question about the hotel facilities, ping me here. 🌴`,
    es: `🏨 Tu hospedaje es en un *flat privativo administrado por TorresGuest*, dentro de la estructura del hotel.\nTienes acceso completo a las áreas comunes (piscina, gimnasio, restaurante, recepción 24h).\nCualquier duda sobre las instalaciones del hotel, avísame aquí. 🌴`,
    fr: `🏨 Votre séjour est dans un *appartement privé géré par TorresGuest*, dans la structure de l'hôtel.\nVous avez plein accès aux espaces communs (piscine, salle de sport, restaurant, réception 24h).\nToute question sur les installations de l'hôtel, dites-moi ici. 🌴`,
  },
  SAFE: {
    pt: SAFE_RESPONSE,
    en: `🔐 The room has a safe available for use. If you have any doubt about operation or if it gets locked, tell me your room number and I'll guide you or call reception to help with the security procedure. 🌴`,
    es: `🔐 La habitación cuenta con caja fuerte disponible. Si tienes duda sobre el uso o si se bloquea, avísame el número de habitación que te oriento o llamo a recepción para ayudar con el procedimiento. 🌴`,
    fr: `🔐 La chambre dispose d'un coffre-fort disponible. En cas de doute sur l'utilisation ou s'il se bloque, dites-moi le numéro de chambre et je vous guide ou j'appelle la réception pour aider avec la procédure. 🌴`,
  },
  INVOICE: {
    pt: INVOICE_RESPONSE,
    en: `🧾 For *invoice or receipt* issuance, I'll connect you with *Sofia* (our admin team) who handles it:\n\n📞 ${HUMAN_NUMBER_SECONDARY}\n\nShe's been notified and will reach out shortly. 🌴`,
    es: `🧾 Para la emisión de *factura o recibo*, te conecto con *Sofia* (nuestro equipo administrativo) que se encarga:\n\n📞 ${HUMAN_NUMBER_SECONDARY}\n\nYa fue avisada y te contactará pronto. 🌴`,
    fr: `🧾 Pour l'émission de *facture ou reçu*, je vous mets en contact avec *Sofia* (notre équipe administrative):\n\n📞 ${HUMAN_NUMBER_SECONDARY}\n\nElle a été prévenue et vous contactera bientôt. 🌴`,
  },
  PARKING_EARLY: {
    pt: PARKING_EARLY_RESPONSE,
    en: `🚗 The possibility of leaving your car before check-in time depends on availability and authorization from the hotel reception at the moment of arrival. We recommend confirming directly at reception upon arrival. 🌴`,
    es: `🚗 La posibilidad de dejar el coche antes del horario de check-in depende de la disponibilidad y autorización de la recepción del hotel al momento de llegar. Recomendamos confirmar directamente en la recepción al llegar. 🌴`,
    fr: `🚗 La possibilité de laisser votre voiture avant l'heure de check-in dépend de la disponibilité et autorisation de la réception de l'hôtel à votre arrivée. Nous recommandons de confirmer directement à la réception en arrivant. 🌴`,
  },
  HOSTING_COURSE: {
    pt: HOSTING_COURSE_RESPONSE,
    en: `🏠 Interested in becoming an Airbnb host? We recommend the *Decoding Airbnb* course — by someone who operates multiple units in Brazil:\n\n🔗 ${typeof affLinks !== 'undefined' && affLinks.hostingCourse ? affLinks.hostingCourse('hosting_course') : 'https://hotmart.com'}\n\nLet me know if you have any questions about the path. 🌴`,
    es: `🏠 ¿Interesado en ser anfitrión de Airbnb? Recomendamos el curso *Decodificando Airbnb* — hecho por quien opera múltiples unidades en Brasil:\n\n🔗 ${typeof affLinks !== 'undefined' && affLinks.hostingCourse ? affLinks.hostingCourse('hosting_course') : 'https://hotmart.com'}\n\nAvísame si tienes dudas sobre el camino. 🌴`,
    fr: `🏠 Intéressé à devenir hôte Airbnb ? Nous recommandons le cours *Décoder Airbnb* — fait par quelqu'un qui opère plusieurs unités au Brésil:\n\n🔗 ${typeof affLinks !== 'undefined' && affLinks.hostingCourse ? affLinks.hostingCourse('hosting_course') : 'https://hotmart.com'}\n\nDites-moi si vous avez des questions sur le parcours. 🌴`,
  },
  BREAKFAST_COMPANION: {
    pt: BREAKFAST_COMPANION_RESPONSE,
    en: `☕ To add a companion or extra breakfast, we recommend consulting directly with the *hotel reception* — they confirm availability and updated prices on the spot. If you prefer, send me the room number and I'll check with the team. 🌴`,
    es: `☕ Para incluir acompañante o desayuno extra, recomendamos consultar directamente con la *recepción del hotel* — ellos confirman disponibilidad y valores actualizados al momento. Si prefieres, avísame el número de habitación que verifico con el equipo. 🌴`,
    fr: `☕ Pour inclure un accompagnant ou un petit-déjeuner supplémentaire, nous recommandons de consulter directement la *réception de l'hôtel* — ils confirment disponibilité et tarifs à jour sur place. Si vous préférez, dites-moi le numéro de chambre et je vérifie avec l'équipe. 🌴`,
  },
  COMMON_AREAS: {
    pt: COMMON_AREAS_RESPONSE,
    en: `🏊 As a TorresGuest guest, you have access to the hotel common areas: *pool, gym, restaurant, 24h reception and business center*, following internal rules and operating hours. Any specific question, ping me. 🌴`,
    es: `🏊 Como huésped TorresGuest, tienes acceso a las áreas comunes del hotel: *piscina, gimnasio, restaurante, recepción 24h y business center*, según reglas internas y horarios de funcionamiento. Cualquier duda específica, avísame. 🌴`,
    fr: `🏊 En tant qu'invité TorresGuest, vous avez accès aux espaces communs de l'hôtel: *piscine, salle de sport, restaurant, réception 24h et business center*, selon règles internes et horaires de fonctionnement. Toute question spécifique, dites-moi. 🌴`,
  },
  BEDDING: {
    pt: BEDDING_RESPONSE,
    en: `🛏️ I can check availability of extra bedding items (pillow, blanket, sheet, pillowcase). Send me your room number and the item you need, and I'll request from housekeeping. 🌴`,
    es: `🛏️ Puedo verificar disponibilidad de artículos extra de cama (almohada, manta, sábana, funda). Envíame el número de habitación y el artículo que necesitas, que coordino con limpieza. 🌴`,
    fr: `🛏️ Je peux vérifier la disponibilité d'articles de literie supplémentaires (oreiller, couverture, drap, taie). Envoyez-moi votre numéro de chambre et l'article dont vous avez besoin, et je sollicite le ménage. 🌴`,
  },
  DATE_CHANGE: {
    pt: DATE_CHANGE_RESPONSE,
    en: `📅 About date changes: the possibility depends on the reservation policy, availability and the channel where it was made.\n• If you booked directly with us, send me the new dates that I check with the team.\n• If you booked via Airbnb/Booking, the change must be requested in the original channel.\n\nNeed help with the request? Ping me. 🌴`,
    es: `📅 Sobre el cambio de fechas: la posibilidad depende de la política de la reserva, disponibilidad y el canal donde fue hecha.\n• Si reservaste directo con nosotros, envíame las nuevas fechas que verifico con el equipo.\n• Si reservaste vía Airbnb/Booking, el cambio debe solicitarse en el canal original.\n\n¿Necesitas ayuda con el pedido? Avísame. 🌴`,
    fr: `📅 À propos du changement de dates: la possibilité dépend de la politique de réservation, disponibilité et du canal où elle a été faite.\n• Si vous avez réservé directement avec nous, envoyez-moi les nouvelles dates et je vérifie avec l'équipe.\n• Si vous avez réservé via Airbnb/Booking, le changement doit être demandé sur le canal original.\n\nBesoin d'aide pour la demande ? Dites-moi. 🌴`,
  },
  HOTEL_MAINTENANCE: {
    pt: HOTEL_MAINTENANCE_RESPONSE,
    en: `🔧 The hotel may undergo occasional improvements and maintenance, usually during business hours. If any construction or noise impacts your stay, let me know immediately and I'll follow up with the hotel team. 🌴`,
    es: `🔧 El hotel puede pasar por mejoras y mantenimientos puntuales, generalmente en horario comercial. Si cualquier obra o ruido impacta tu estadía, avísame inmediatamente que acompaño con el equipo del hotel. 🌴`,
    fr: `🔧 L'hôtel peut faire l'objet d'améliorations et de maintenances ponctuelles, généralement aux heures de bureau. Si des travaux ou du bruit impactent votre séjour, prévenez-moi immédiatement et je suis avec l'équipe de l'hôtel. 🌴`,
  },
  SECURITY: {
    pt: SECURITY_RESPONSE,
    en: `🔐 We have Security & Reception 24h, access control and on-site team at all times.\nYou can arrive worry-free, we're always nearby. 🌴`,
    es: `🔐 Contamos con Seguridad y Recepción 24h, control de acceso y equipo en el lugar todo el tiempo.\nPuedes llegar tranquilo(a), siempre estamos cerca. 🌴`,
    fr: `🔐 Nous avons Sécurité et Réception 24h, contrôle d'accès et équipe sur place en permanence.\nVous pouvez arriver l'esprit tranquille, nous sommes toujours à proximité. 🌴`,
  },
  LONG_STAY: {
    pt: LONG_STAY_RESPONSE,
    en: `💰 Long stays\nWe have special rates for extended periods.\nTell me how many nights and dates, and I'll check with the team at ${HUMAN_NUMBER_PRIMARY}/${HUMAN_NUMBER_SECONDARY} and come back with a proposal. 🌴`,
    es: `💰 Estadías largas\nTenemos condiciones especiales para períodos extendidos.\nDime cuántas noches y fechas que consulto con el equipo en ${HUMAN_NUMBER_PRIMARY}/${HUMAN_NUMBER_SECONDARY} y vuelvo con la propuesta. 🌴`,
    fr: `💰 Séjours longs\nNous avons des conditions spéciales pour les périodes prolongées.\nDites-moi combien de nuits et les dates et je consulte l'équipe au ${HUMAN_NUMBER_PRIMARY}/${HUMAN_NUMBER_SECONDARY} et reviens avec la proposition. 🌴`,
  },
  CLEANING: {
    pt: CLEANING_RESPONSE,
    en: `🧹 Cleaning / Housekeeping\nCleaning is done by the hotel team, usually between 10:00 and 15:00.\nIf you need a specific time or prefer not to be disturbed in this interval, let me know 24h in advance and I'll schedule it for you. 🌴`,
    es: `🧹 Limpieza / Housekeeping\nLa limpieza la realiza el equipo del hotel, generalmente entre 10:00 y 15:00.\nSi necesitas un horario específico o prefieres no ser molestado en ese intervalo, avísame con 24h de anticipación que lo agendo. 🌴`,
    fr: `🧹 Ménage / Housekeeping\nLe ménage est effectué par l'équipe de l'hôtel, généralement entre 10h00 et 15h00.\nSi vous avez besoin d'un horaire spécifique ou préférez ne pas être dérangé dans cet intervalle, prévenez-moi 24h à l'avance et je planifie. 🌴`,
  },
  INTERNET: {
    pt: INTERNET_RESPONSE,
    en: `📡 Internet\nThe hotel Wi-Fi is fiber, ideal for remote work and streaming.\nIf you notice any instability, ping me and I'll trigger the technical team right away. 🌴`,
    es: `📡 Internet\nEl Wi-Fi del hotel es fibra, ideal para trabajo remoto y streaming.\nSi notas alguna inestabilidad, avísame que llamo al equipo técnico al momento. 🌴`,
    fr: `📡 Internet\nLe Wi-Fi de l'hôtel est en fibre, idéal pour le télétravail et le streaming.\nSi vous remarquez une instabilité, prévenez-moi et j'active l'équipe technique immédiatement. 🌴`,
  },
  LUGGAGE: {
    pt: LUGGAGE_RESPONSE,
    en: `🧳 Luggage storage\nNeed to leave luggage before check-in or after check-out?\nWe have an agreement with Mr. Alberto (restaurant manager) to store our guests' luggage subject to availability.\nLet me know the times and I'll align with him. 🌴`,
    es: `🧳 Guarda de equipaje\n¿Necesitas dejar equipaje antes del check-in o después del check-out?\nTenemos acuerdo con el Sr. Alberto (jefe del restaurante) para guardar el equipaje de nuestros huéspedes según disponibilidad.\nAvísame horarios que ya alineo con él. 🌴`,
    fr: `🧳 Garde de bagages\nBesoin de laisser des bagages avant le check-in ou après le check-out?\nNous avons un accord avec M. Alberto (chef du restaurant) pour garder les bagages de nos invités selon disponibilité.\nDites-moi les horaires et j'aligne avec lui. 🌴`,
  },
  HUMAN_ESCALATION: {
    pt: HUMAN_ESCALATION_RESPONSE,
    en: `In this case please contact Sofia who answers on WhatsApp ${HUMAN_NUMBER_SECONDARY}. We'll take care to answer your questions better. 😊`,
    es: `En este caso favor contactar a Sofia que atiende en WhatsApp ${HUMAN_NUMBER_SECONDARY}. Cuidaremos de responder mejor tus dudas. 😊`,
    fr: `Dans ce cas veuillez contacter Sofia qui répond sur WhatsApp ${HUMAN_NUMBER_SECONDARY}. Nous prendrons soin de mieux répondre à vos questions. 😊`,
  },
};

/**
 * Helper multi-tenant para obter resposta no idioma do hóspede com fallback
 * hierárquico. Ordem (do mais específico ao mais genérico):
 *   1. tenant.settings.responses[KEY][lang]    custom completo do anfitrião
 *   2. tenant.settings.responses[KEY].pt       custom em PT (mesmo se lang!=pt)
 *   3. I18N_RESPONSES[KEY][lang]               default ConciergeCloud no idioma
 *   4. I18N_RESPONSES[KEY].pt                  default PT (último recurso)
 *
 * @param {string} key     Nome do response (WIFI, POOL, etc)
 * @param {string} lang    'pt'|'en'|'es'|'fr'
 * @param {object} tenant  doc Mongo do tenant (opcional)
 * @returns {string|null}
 */
function getResponseForTenant(key, lang, tenant) {
  const custom = tenant && tenant.settings && tenant.settings.responses && tenant.settings.responses[key];
  const def = I18N_RESPONSES[key];
  if (custom) {
    if (custom[lang]) return custom[lang];
    if (custom.pt) return custom.pt;
  }
  if (def) {
    if (def[lang]) return def[lang];
    if (def.pt) return def.pt;
  }
  return null;
}

/**
 * Backward-compat helper sem tenant (chama getResponseForTenant com tenant=null).
 * Mantido para callers antigos que ainda não passam tenant.
 */
function getI18nResponse(key, lang) {
  return getResponseForTenant(key, lang, null);
}


module.exports = {
  I18N_RESPONSES,
  getI18nResponse,
  getResponseForTenant,
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
  PRE_CHECKIN_WHO_CAN_RESPONSE,
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
  buildGratitudeFarewellResponse,
  RESERVATION_SITE_RESPONSE,
  RESERVATION_NOT_FOUND,
  getReservationResponse,
  getLocationResponse,
  FRIGOBAR_PIX_RESPONSE,
  FRIGOBAR_RESTOCK_RESPONSE,
  getEarlyCompanionArrivalResponse,
};
