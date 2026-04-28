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

const RESTAURANT_RESPONSE = `\ud83c\udf7d\ufe0f O Restaurante do Hotel com acesso pelo lobby oferece refei\u00e7\u00f5es \u00e0 la carte ao longo do dia.\nPerfeito para quem quer comer bem sem sair do pr\u00e9dio. Se quiser sugest\u00f5es, me chama! \ud83c\udf34`;

const FOOD_ORDER_RESPONSE = `\ud83c\udf7d\ufe0f Para fazer pedido no restaurante Don Maitre (no pr\u00f3prio pr\u00e9dio):\n\n\ud83d\udcf2 Card\u00e1pio completo: https://conciergecloud.com.br/restaurante.html\n\ud83c\udf9f\ufe0f Cupom 10% off: *CONCIERGECLOUD10*\n\nVale pra sal\u00e3o, room service e take-away. Me avisa se precisar de ajuda com o pedido! \ud83c\udf34`;

const CHECKIN_RESPONSE = `\ud83d\udd50 Check-in & Check-out possuem limites de hor\u00e1rio, sobretudo o check-out, pois o time de governan\u00e7a do hotel pede uma hora para limpeza e higieniza\u00e7\u00e3o.\nCheck-in: a partir das 14h\nCheck-out: at\u00e9 12h\nA recep\u00e7\u00e3o funciona 24h com equipe de seguran\u00e7a para te receber em qualquer hor\u00e1rio. \ud83c\udf34`;

const SECURITY_RESPONSE = `\ud83d\udd10 Contamos com Seguran\u00e7a & Recep\u00e7\u00e3o 24h, controle de acesso e equipe no local o tempo todo.\nPode chegar tranquilo(a), estamos sempre por perto. \ud83c\udf34`;

const TRANSFER_RESPONSE = `\u2708\ufe0f Transfer Aeroporto\nOferecemos apoio com transfer sob demanda e com custo adicional.\nMe avise seu voo e hor\u00e1rio que conecto voc\u00ea direto com nossa concierge no ${HUMAN_NUMBER_PRIMARY} ou ${HUMAN_NUMBER_SECONDARY} para finalizar os detalhes. \ud83c\udf34`;

const LOCATION_RESPONSE = `\ud83d\udccd Diferenciais TorresGuest\n\u2022 Flats dentro de um hotel completo (piscina, academia, restaurante)\n\u2022 Localiza\u00e7\u00e3o excelente em Perdizes, S\u00e3o Paulo/SP\n\u2022 Pr\u00f3ximo ao Allianz Parque, PUC-SP e Shopping Bourbon\n\u2022 Atendimento pr\u00f3ximo e humanizado, estilo concierge\n\nIdeal para lazer ou trabalho. Precisa de algo espec\u00edfico? S\u00f3 chamar! \ud83c\udf34`;

const LONG_STAY_RESPONSE = `\ud83d\udcb0 Estadias longas\nTemos condi\u00e7\u00f5es especiais para per\u00edodos estendidos.\nMe conta quantas noites e datas que converso com a equipe no ${HUMAN_NUMBER_PRIMARY}/${HUMAN_NUMBER_SECONDARY} e j\u00e1 retorno com a proposta. \ud83c\udf34`;

const CLEANING_RESPONSE = `\ud83e\uddf9 Limpeza / Governan\u00e7a\nA limpeza \u00e9 realizada pela equipe do hotel.\nAvise com 24h de anteced\u00eancia o melhor hor\u00e1rio e eu agendo pra voc\u00ea. \ud83c\udf34`;

const INTERNET_RESPONSE = `\ud83d\udce1 Internet\nO Wi-Fi do hotel \u00e9 fibra, ideal para trabalho remoto e streaming.\nSe notar qualquer instabilidade, me chama que aciono o time t\u00e9cnico na hora. \ud83c\udf34`;

const LUGGAGE_RESPONSE = `\ud83e\uddf3 Guarda de malas\nPrecisando deixar bagagem antes do check-in ou depois do check-out?\nTemos um acordo com o Sr. Alberto (chefe do restaurante) para guardar as malas de nossos hospedes conforme disponibilidade. \nMe informe hor\u00e1rios que j\u00e1 deixo alinhado com ele. \ud83c\udf34`;

const GREETING_RESPONSE = (name) =>
  `Perfeito, ${name || 'tudo bem'} \ud83d\ude0a\n\nMe diga o que voc\u00ea precisa, ou digite *menu* para ver as op\u00e7\u00f5es. \ud83c\udf34`;

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
  CHECKIN_RESPONSE,
  SECURITY_RESPONSE,
  TRANSFER_RESPONSE,
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
};
