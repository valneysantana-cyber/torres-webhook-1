'use strict';

const { normalizeText } = require('../utils/formatters');

const CATEGORIES = [
  {
    level: 'CRITICO', emoji: '🔴', name: 'Urgência',
    keywords: ['urgente','socorro','travado','presa','preso','bloqueada','bloqueado','emergencia','emergência','imediato','imediatamente','nao aguenta','não aguenta','precisando agora','acidente','machuc','sangr','desmaio','mal estar'],
    guestReply: 'Entendido! Acionei nossa equipe com prioridade máxima — alguém entrará em contato com você em instantes! 🔴',
  },
  {
    level: 'CRITICO', emoji: '🔴', name: 'Manutenção',
    keywords: [
      'ar condicionado','ar-condicionado','chuveiro','agua quente','água quente',
      'vazamento','vazando',
      'tv nao','tv não','tv com problema','tv sem','tv quebr','tv acionand','tv ruim','tv nao ta','tv não ta',
      'televisao nao','televisão não','televisao com','televisão com','televisao sem','televisão sem',
      'problema na tv','problema com a tv','sem sinal na tv','televisao','televisão',
      'internet caiu','internet nao funciona','internet não funciona','wifi caiu','wifi nao','wifi não',
      'fechadura','porta nao abre','porta não abre','porta travada',
      'sem energia','sem luz','queda de energia',
      'barulho alto','barulho excessivo','barulho demais',
      'nao funciona','não funciona','nao liga','não liga','nao acende','não acende',
      'geladeira','frigobar','microondas',
      'tomada','interruptor','lampada','lâmpada',
      'torneira','pia','entupid','vaso entupid','privada',
      'aquecedor','aquecimento','chuveiro frio','agua gelada','água gelada',
      'infiltracao','infiltração','goteira',
      'janela quebr','vidro quebr','cama quebr','colchao','colchão',
      'ar quente','calor no quarto','mofo','cheiro ruim','cheiro estranho',
      'descarga','sanitario','sanitário','problema no banheiro'
    ],
    guestReply: 'Entendido! Acionei nossa equipe de manutenção agora mesmo — vamos resolver isso o mais rápido possível. 🔧',
  },
  {
    level: 'OPERACIONAL', emoji: '🟡', name: 'Acesso / Check-in',
    keywords: ['nao consigo entrar','não consigo entrar','nao abriu','não abriu','perdi a chave','perdi o cartao','perdi o cartão','cartao parou','cartão parou','cartao nao','cartão não','problema com a chave','chave nao','chave não','esqueci a chave','nao abre','não abre'],
    guestReply: 'Claro! Vou acionar nossa recepção agora mesmo para te atender. Alguém entrará em contato em breve! 😊',
  },
  {
    level: 'OPERACIONAL', emoji: '🟡', name: 'Limpeza',
    keywords: ['limpeza','limpar','sujo','suja','toalha','roupa de cama','lencol','lençol','fronha','travesseiro','falta toalha','sem toalha','quarto sujo','banheiro sujo','lixo','amenidades','sabonete','shampoo','papel higienico','papel higiênico','mais toalha'],
    guestReply: 'Anotei! Vou solicitar nosso serviço de limpeza para o seu apartamento. Em breve alguém passará por lá. 🧹',
  },
  {
    level: 'OPERACIONAL', emoji: '🟡', name: 'Reclamação',
    keywords: ['pessimo','pésimo','péssimo','horrivel','horrível','absurdo','inaceitavel','inaceitável','decepcionado','decepção','revoltado','nao to gostando','não to gostando','mal atendido','falta de respeito','quero reclamar','muito ruim','insatisfeito'],
    guestReply: 'Lamentamos muito pelo inconveniente. Encaminhei para nossa gerência — entrarão em contato para resolver isso da melhor forma. 🙏',
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
