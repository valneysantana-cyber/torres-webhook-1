'use strict';

const FAQ_ENTRIES = [
  {
    patterns: [/(onde.*localizad|qual.*bairro|localizacao|onde voces estao|onde fica)/],
    response: 'Estamos no bairro de Perdizes, uma das regi\u00f5es mais valorizadas e estrat\u00e9gicas de S\u00e3o Paulo. \ud83d\ude0a',
  },
  {
    patterns: [/(perto.*allianz|allianz.*perto|allianz parque)/],
    response: 'Sim! Ficamos a poucos minutos do Allianz Parque, perfeito para shows e jogos. \u26bd\ud83c\udfa4',
  },
  {
    patterns: [/(ir a pe|caminha|andar).*allianz/],
    response: 'D\u00e1 para ir a p\u00e9 at\u00e9 o Allianz Parque em cerca de 10 a 15 minutos, dependendo do ritmo. \ud83d\udeb6\u200d\u2642\ufe0f',
  },
  {
    patterns: [/(regiao segura|area segura|seguro ai|seguro o bairro)/],
    response: 'Perdizes \u00e9 um bairro residencial com boa seguran\u00e7a e movimento constante. Ainda assim, recomendamos os cuidados usuais de cidade grande.',
  },
  {
    patterns: [/(mercado|supermercado|padaria).*perto/],
    response: 'Temos mercados, padarias e farm\u00e1cias muito pr\u00f3ximos \u2014 d\u00e1 pra resolver tudo a p\u00e9.',
  },
  {
    patterns: [/(restaurante|gastronomia).*perto/],
    response: 'Sim! A regi\u00e3o \u00e9 rica em restaurantes e bares, desde caf\u00e9s charmosos at\u00e9 casas premiadas. \ud83c\udf7d\ufe0f',
  },
  {
    patterns: [/(shopping|bourbon)/],
    response: 'O Shopping Bourbon fica pertinho e \u00e9 \u00f3tima op\u00e7\u00e3o para compras, cinema e alimenta\u00e7\u00e3o.',
  },
  {
    patterns: [/(puc|universidade)/],
    response: 'Estamos bem pr\u00f3ximos da PUC-SP, perfeito para quem vem a eventos ou gradua\u00e7\u00f5es. \ud83c\udf93',
  },
  {
    patterns: [/(?:((?:uber|app).*facil)|facil pedir carro)/],
    response: 'O acesso a Uber e demais apps \u00e9 bem r\u00e1pido por aqui. \ud83d\ude97',
  },
  {
    patterns: [/(longe).*centro/],
    response: 'Estamos a poucos minutos do centro \u2014 o acesso \u00e9 r\u00e1pido tanto de carro quanto de transporte p\u00fablico.',
  },
  {
    patterns: [/(avenida paulista|paulista)/],
    response: 'A Avenida Paulista fica a cerca de 10\u201315 minutos de carro, super pr\u00e1tico.',
  },
  {
    patterns: [/(farmacia)/],
    response: 'Tem farm\u00e1cias 24h e drograrias de rede muito perto. \ud83d\udc8a',
  },
  {
    patterns: [/(padaria)/],
    response: 'Padarias \u00f3timas na regi\u00e3o \u2014 imposs\u00edvel n\u00e3o querer um caf\u00e9 ali. \u2615',
  },
  {
    patterns: [/(area movimentada|rua movimentada)/],
    response: '\u00c9 uma \u00e1rea movimentada e residencial, com bom fluxo mas mantendo tranquilidade.',
  },
  {
    patterns: [/(bares|barzinho)/],
    response: 'Sim, temos bares e pubs pr\u00f3ximos para diversos estilos. \ud83c\udf7b',
  },
  {
    patterns: [/(transporte publico|onibus|metro)/],
    response: 'Temos acesso f\u00e1cil a \u00f4nibus e metr\u00f4, facilitando deslocamentos pela cidade.',
  },
  {
    patterns: [/(?:aeroporto.*proximo|qual aeroporto)/],
    response: 'O aeroporto mais pr\u00f3ximo \u00e9 Congonhas, ideal para quem chega por voos dom\u00e9sticos. \u2708\ufe0f',
  },
  {
    patterns: [/(tempo).*aeroporto/],
    response: 'Congonhas fica a 20\u201340 minutos, variando conforme o tr\u00e2nsito.',
  },
  {
    patterns: [/(ciclovia|bike)/],
    response: 'Sim, h\u00e1 ciclovias e ciclofaixas pr\u00f3ximas \u2014 o bairro \u00e9 \u00f3timo pra quem pedala. \ud83d\udeb4',
  },
  {
    patterns: [/(turismo|pontos turisticos)/],
    response: 'Perdizes \u00e9 uma base excelente pra explorar S\u00e3o Paulo: fica perto de polos culturais, gastron\u00f4micos e de compras.',
  },
  {
    patterns: [/(?:hospede.*show|allianz parque|eventos)/],
    response: 'Recebemos muitos h\u00f3spedes que v\u00eam para shows e eventos \u2014 a localiza\u00e7\u00e3o \u00e9 perfeita pra isso. \ud83c\udfb6',
  },
  {
    patterns: [/(?:barulho.*show|movimento.*evento)/],
    response: 'Em dias de jogos ou shows a regi\u00e3o fica mais movimentada, mas nada que comprometa o descanso dentro do flat.',
  },
  {
    patterns: [/(avisam).*eventos/],
    response: 'Sempre que poss\u00edvel avisamos sobre eventos na regi\u00e3o pra voc\u00ea se organizar.',
  },
  {
    patterns: [/(?:ver.*estadio|vista.*allianz)/],
    response: 'Algumas unidades t\u00eam vista parcial do Allianz Parque \u2014 consulte a disponibilidade que eu verifico pra voc\u00ea. \ud83d\udc40',
  },
  {
    patterns: [/(restaurante).*estadio/],
    response: 'Os arredores do Allianz t\u00eam v\u00e1rias op\u00e7\u00f5es de bares e restaurantes pra antes ou depois dos eventos.',
  },
  {
    patterns: [/(cheio|lotado).*evento/],
    response: 'Nos dias de evento a regi\u00e3o fica cheia, ent\u00e3o recomendamos sair com anteced\u00eancia.',
  },
  {
    patterns: [/(seguro).*voltar.*noite/],
    response: '\u00c9 seguro voltar, mas em dias de grande movimento sugerimos usar apps de transporte pra mais conforto.',
  },
  {
    patterns: [/(vale a pena|bom lugar).*show/],
    response: 'Vale muito! Voc\u00ea fica pertinho do Allianz e ainda conta com toda estrutura do flat/hotel.',
  },
  {
    patterns: [/(estacionamento).*jogo/],
    response: 'Mesmo em dias de jogos, mantemos o estacionamento com manobrista dentro do pr\u00e9dio.',
  },
  {
    patterns: [/(evitar).*transito/],
    response: 'Saindo antes dos hor\u00e1rios de pico voc\u00ea evita tr\u00e2nsito pesado; posso te ajudar com dicas de trajeto.',
  },
  {
    patterns: [/(hotel ou airbnb|eh hotel)/],
    response: 'Somos flats particulares dentro de um hotel, unindo privacidade com toda a estrutura hoteleira. \ud83d\ude0a',
  },
  {
    patterns: [/(?:usar.*estrutura|piscina academia restaurante)/],
    response: 'Os h\u00f3spedes podem usar toda a estrutura do hotel: piscina, academia, restaurante e servi\u00e7os.',
  },
  {
    patterns: [/(piscina)/],
    response: 'Tem piscina das 08h \u00e0s 21h para relaxar quando quiser. \ud83c\udfca\u200d\u2640\ufe0f',
  },
  {
    patterns: [/(academia|gym)/],
    response: 'Tem academia equipada aberta das 08h \u00e0s 21h. \ud83d\udcaa',
  },
  {
    patterns: [/(cafe da manha)/],
    response: 'O caf\u00e9 da manh\u00e3 est\u00e1 incluso e servido no restaurante do lobby, das 06h30 \u00e0s 10h.',
  },
  {
    patterns: [/(wifi|internet)/],
    response: 'Temos Wi-Fi fibra com \u00f3tima estabilidade, ideal pra trabalho e streaming. \ud83d\udce6',
  },
  {
    patterns: [/(ar condicionado|ar-condicionado|climatizado)/],
    response: 'Todos os flats contam com ar-condicionado para seu conforto. \u2744\ufe0f',
  },
  {
    patterns: [/(tv)/],
    response: 'Tem TV com canais a cabo/streaming para voc\u00ea relaxar. \ud83d\udcfa',
  },
  {
    patterns: [/(limpeza|faxina)/],
    response: 'A limpeza \u00e9 feita pela governan\u00e7a do hotel; \u00e9 s\u00f3 avisar com anteced\u00eancia que agendamos.',
  },
  {
    patterns: [/(recepcao|24h)/],
    response: 'Temos recep\u00e7\u00e3o 24h pronta para apoiar em qualquer necessidade. \ud83d\udece\ufe0f',
  },
  {
    patterns: [/(elevador)/],
    response: 'Sim, o pr\u00e9dio possui elevadores modernos e r\u00e1pidos.',
  },
  {
    patterns: [/(vista)/],
    response: 'Algumas unidades t\u00eam vista linda da cidade; me fala sua prefer\u00eancia que escolho a melhor op\u00e7\u00e3o.',
  },
  {
    patterns: [/(secador)/],
    response: 'Disponibilizamos secador \u2014 se n\u00e3o estiver no flat \u00e9 s\u00f3 solicitar que levamos.',
  },
  {
    patterns: [/(ferro)/],
    response: 'Podemos providenciar ferro e t\u00e1bua sob demanda, sem custo.',
  },
  {
    patterns: [/(cozinha|cooktop|micro-ondas|microondas)/],
    response: 'Os flats t\u00eam mini cozinha funcional com itens b\u00e1sicos para refei\u00e7\u00f5es r\u00e1pidas.',
  },
  {
    patterns: [/(frigobar|geladeira)/],
    response: 'Sim, cada unidade conta com frigobar abastecido.',
  },
  {
    patterns: [/(snack|snacks)/],
    response: 'Deixamos snacks no apartamento \u2014 se consumir, \u00e9 s\u00f3 pagar via PIX 62.169.624/0001-94.',
  },
  {
    patterns: [/(trabalho|home office|notebook)/],
    response: 'Tem espa\u00e7o confort\u00e1vel pra trabalhar, com internet r\u00e1pida e tomadas acess\u00edveis. \ud83d\udcbb',
  },
  {
    patterns: [/(silencioso|barulho)/],
    response: 'O flat \u00e9 silencioso; s\u00f3 em dias de grandes eventos pode haver mais movimento externo.',
  },
  {
    patterns: [/(visita|receber pessoas)/],
    response: 'Visitas s\u00e3o poss\u00edveis mediante aviso pr\u00e9vio para alinharmos com a recep\u00e7\u00e3o.',
  },
  {
    patterns: [/(festa|eventos no apartamento)/],
    response: 'N\u00e3o permitimos festas no flat para garantir o conforto de todos os h\u00f3spedes. \ud83d\udeab',
  },
  {
    patterns: [/(fumar|cigarro)/],
    response: 'Os flats s\u00e3o 100% n\u00e3o fumantes. Se precisar, temos \u00e1reas externas designadas.',
  },
  {
    patterns: [/(pet|animal)/],
    response: 'Pets podem ser aceitos mediante consulta \u2014 me avisa o porte e os dias pra eu confirmar. \ud83d\udc3e',
  },
  {
    patterns: [/(lavanderia)/],
    response: 'O hotel oferece servi\u00e7o de lavanderia; posso ajudar a agendar.',
  },
  {
    patterns: [/(room service|servico de quarto)/],
    response: 'O restaurante atende o flat via room service em hor\u00e1rios definidos.',
  },
  {
    patterns: [/(check-in facil|checkin facil)/],
    response: 'O check-in \u00e9 simples: nos avise o hor\u00e1rio e deixamos tudo pronto na recep\u00e7\u00e3o.',
  },
  {
    patterns: [/(suporte durante a estadia|ajuda durante a estadia)/],
    response: 'Ficamos dispon\u00edveis 24/7 no WhatsApp pra resolver qualquer necessidade durante a estadia. \ud83d\ude0a',
  },
  {
    patterns: [/(pedir comida|delivery)/],
    response: 'Pode pedir delivery sem problema; avisamos a recep\u00e7\u00e3o pra autorizar a entrega.',
  },
  {
    patterns: [/(acessibilidade|cadeirante)/],
    response: 'Temos unidades com recursos de acessibilidade \u2014 me diz o que precisa que seleciono a melhor op\u00e7\u00e3o.',
  },
  {
    patterns: [/(blackout|cortina)/],
    response: 'As unidades t\u00eam cortinas blackout para garantir noites bem escuras.',
  },
  {
    patterns: [/(tomada|energia)/],
    response: 'H\u00e1 diversas tomadas pr\u00f3ximas da cama e da esta\u00e7\u00e3o de trabalho.',
  },
  {
    patterns: [/(casal|romantico)/],
    response: 'Os flats acomodam casais com muito conforto \u2014 posso preparar mimos especiais se quiser.',
  },
  {
    patterns: [/(confortavel|conforto)/],
    response: 'Sim, montamos tudo para ser aconchegante e pr\u00e1tico, com padr\u00e3o de hotel boutique. \ud83d\ude0a',
  },
];

function getFaqResponse(text) {
  for (const entry of FAQ_ENTRIES) {
    if (entry.patterns.some((regex) => regex.test(text))) {
      return entry.response;
    }
  }
  return null;
}

module.exports = { FAQ_ENTRIES, getFaqResponse };
