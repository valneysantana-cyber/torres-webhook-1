'use strict';

const { normalizeText } = require('../utils/formatters');

const CATEGORIES = [
  {
    level: 'CRITICO', emoji: '\u{1F534}', name: 'Urg\u00eancia',
    keywords: ['urgente','socorro','travado','presa','preso','bloqueada','bloqueado','emergencia','emerg\u00eancia','imediato','imediatamente','nao aguenta','n\u00e3o aguenta','precisando agora','acidente','machuc','sangr','desmaio','mal estar'],
    guestReply: 'Entendido! Acionei nossa equipe com prioridade m\u00e1xima \u2014 algu\u00e9m entrar\u00e1 em contato com voc\u00ea em instantes! \u{1F534}',
  },
  {
    level: 'CRITICO', emoji: '\u{1F534}', name: 'Manuten\u00e7\u00e3o',
    keywords: [
      'ar condicionado','ar-condicionado','chuveiro','agua quente','\u00e1gua quente',
      'vazamento','vazando',
      'tv nao','tv n\u00e3o','tv com problema','tv sem','tv quebr','tv acionand','tv ruim','tv nao ta','tv n\u00e3o ta',
      'televisao nao','televis\u00e3o n\u00e3o','televisao com','televis\u00e3o com','televisao sem','televis\u00e3o sem',
      'problema na tv','problema com a tv','sem sinal na tv','televisao','televis\u00e3o',
      'internet caiu','internet nao funciona','internet n\u00e3o funciona','wifi caiu','wifi nao','wifi n\u00e3o',
      'fechadura','porta nao abre','porta n\u00e3o abre','porta travada',
      'sem energia','sem luz','queda de energia',
      'barulho alto','barulho excessivo','barulho demais',
      'nao funciona','n\u00e3o funciona','nao liga','n\u00e3o liga','nao acende','n\u00e3o acende',
      'geladeira','frigobar','microondas',
      'tomada','interruptor','lampada','l\u00e2mpada',
      'torneira','pia','entupid','vaso entupid','privada',
      'aquecedor','aquecimento','chuveiro frio','agua gelada','\u00e1gua gelada',
      'infiltracao','infiltra\u00e7\u00e3o','goteira',
      'janela quebr','vidro quebr','cama quebr','colchao','colch\u00e3o',
      'ar quente','calor no quarto','mofo','cheiro ruim','cheiro estranho',
      'descarga','sanitario','sanit\u00e1rio','problema no banheiro'
    ],
    guestReply: 'Entendido! Acionei nossa equipe de manuten\u00e7\u00e3o agora mesmo \u2014 vamos resolver isso o mais r\u00e1pido poss\u00edvel. \u{1F527}',
  },
  {
    level: 'OPERACIONAL', emoji: '\u{1F7E1}', name: 'Acesso / Check-in',
    keywords: ['nao consigo entrar','n\u00e3o consigo entrar','nao abriu','n\u00e3o abriu','perdi a chave','perdi o cartao','perdi o cart\u00e3o','cartao parou','cart\u00e3o parou','cartao nao','cart\u00e3o n\u00e3o','problema com a chave','chave nao','chave n\u00e3o','esqueci a chave','nao abre','n\u00e3o abre'],
    guestReply: 'Claro! Vou acionar nossa recep\u00e7\u00e3o agora mesmo para te atender. Algu\u00e9m entrar\u00e1 em contato em breve! \u{1F60A}',
  },
  {
    level: 'OPERACIONAL', emoji: '\u{1F7E1}', name: 'Limpeza',
    keywords: ['limpeza','limpar','sujo','suja','toalha','roupa de cama','lencol','len\u00e7ol','fronha','travesseiro','falta toalha','sem toalha','quarto sujo','banheiro sujo','lixo','amenidades','sabonete','shampoo','papel higienico','papel higi\u00eanico','mais toalha'],
    guestReply: 'Anotei! Vou solicitar nosso servi\u00e7o de limpeza para o seu apartamento. Em breve algu\u00e9m passar\u00e1 por l\u00e1. \u{1F9F9}',
  },
  {
    level: 'OPERACIONAL', emoji: '\u{1F7E1}', name: 'Reclama\u00e7\u00e3o',
    keywords: ['pessimo','p\u00e9simo','p\u00e9ssimo','horrivel','horr\u00edvel','absurdo','inaceitavel','inaceit\u00e1vel','decepcionado','decep\u00e7\u00e3o','revoltado','nao to gostando','n\u00e3o to gostando','mal atendido','falta de respeito','quero reclamar','muito ruim','insatisfeito'],
    guestReply: 'Lamentamos muito pelo inconveniente. Encaminhei para nossa ger\u00eancia \u2014 entrar\u00e3o em contato para resolver isso da melhor forma. \u{1F64F}',
  },
  {
    level: 'OPERACIONAL', emoji: '\u{1F4E6}', name: 'Objetos Esquecidos',
    keywords: [
      'esqueci no hotel','esqueci no quarto','esqueci no apartamento','esqueci no flat',
      'deixei no hotel','deixei no quarto','deixei no apartamento','deixei no flat',
      'esqueci minha roupa','esqueci meu casaco','esqueci minha bolsa','esqueci minha mala',
      'esqueci meu documento','esqueci meus pertences','esqueci minhas coisas',
      'deixei minha roupa','deixei meu casaco','deixei minha bolsa','deixei minha mala',
      'objeto esquecido','pertences esquecidos','roupa esquecida','roupas esquecidas',
      'achados e perdidos','lost and found',
      'esqueceu no quarto','esqueceu no hotel','deixou no quarto','deixou no hotel',
      'esqueci algo la','esqueci alguma coisa no hotel','deixei algo no quarto'
    ],
    guestReply: 'Entendido! Estou direcionando para nossa equipe entrar em contato sobre seus pertences. Em breve algu\u00e9m te retornar\u00e1! \u{1F4E6}',
  },
  {
    level: 'INFO', emoji: '\u{1F4DE}', name: 'Contato Recep\u00e7\u00e3o', noAlert: true,
    keywords: [
      'falar com a recepcao','falar com recepcao','falar com a recep\u00e7\u00e3o','falar com recep\u00e7\u00e3o',
      'contato da recepcao','contato da recep\u00e7\u00e3o','contato com a recepcao','contato com a recep\u00e7\u00e3o',
      'numero da recepcao','n\u00famero da recepcao','numero da recep\u00e7\u00e3o','n\u00famero da recep\u00e7\u00e3o',
      'telefone da recepcao','telefone da recep\u00e7\u00e3o','ramal da recepcao','ramal da recep\u00e7\u00e3o',
      'como falo com a recepcao','como falo com a recep\u00e7\u00e3o',
      'como chamo a recepcao','como chamo a recep\u00e7\u00e3o',
      'chamar a recepcao','chamar a recep\u00e7\u00e3o','chamar recepcao','chamar recep\u00e7\u00e3o',
      'ligar para recepcao','ligar para a recepcao','ligar para recep\u00e7\u00e3o','ligar para a recep\u00e7\u00e3o',
      'quero falar com alguem do hotel','preciso falar com a recepcao','preciso falar com a recep\u00e7\u00e3o',
      'como falo com alguem','falar com alguem do hotel',
      'tem recepcao','tem recep\u00e7\u00e3o','onde fica a recepcao','onde fica a recep\u00e7\u00e3o'
    ],
    guestReply: 'Para falar com a recep\u00e7\u00e3o, disque *9* ou **1* no telefone do seu quarto. Estamos dispon\u00edveis 24 horas! \u{1F4DE}',
  },
  {
    level: 'INFO', emoji: '\u{1F4C5}', name: 'Reserva', noAlert: true,
    keywords: [
      'quero reservar','fazer reserva','fazer uma reserva','quero fazer reserva',
      'quero uma reserva','como reservo','como faco reserva','como fa\u00e7o reserva',
      'como faco uma reserva','como fa\u00e7o uma reserva',
      'quero alugar','como alugo','como eu alugo','alugar um flat','alugar o flat',
      'alugar um apto','alugar o apto','alugar um apartamento','alugar apartamento',
      'aluguel do flat','aluguel do apto','aluguel','quero um flat','quero o flat',
      'disponibilidade','tem quarto disponivel','tem quarto dispon\u00edvel',
      'tem apartamento disponivel','tem apartamento dispon\u00edvel',
      'tem flat disponivel','tem flat dispon\u00edvel',
      'quero me hospedar','preciso de quarto','preciso de hospedagem',
      'quanto custa a diaria','quanto custa a di\u00e1ria','qual o valor da diaria','qual o valor da di\u00e1ria',
      'qual o preco','qual o pre\u00e7o','como reservar','quero reserva','efetuar reserva',
      'fazer booking','quero booking','site para reservar','onde reservo',
      'qual o site','qual o telefone','qual o numero','qual o n\u00famero',
      'telefone para reserva','numero para reserva','n\u00famero para reserva',
      'contato para reserva','como entro em contato','quero contato',
      'como faco para reservar','como fa\u00e7o para reservar',
      'quero fazer uma reserva','gostaria de reservar','gostaria de alugar'
    ],
    guestReply: 'Para fazer sua reserva, fale com a *Sofia*: \u{1F4DE} *+55 13 99615-5505* ou acesse nosso site: \u{1F310} *www.torresguest.com.br* \u{1F3E8}',
  },
];

function classifyMessage(text) {
  const normalized = normalizeText(text);
  for (const category of CATEGORIES) {
    for (const keyword of category.keywords) {
      if (normalized.includes(normalizeText(keyword))) {
        return category;
      }
    }
  }
  return null;
}

module.exports = { classifyMessage };
