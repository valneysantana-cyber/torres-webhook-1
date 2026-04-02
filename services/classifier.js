'use strict';

const { normalizeText } = require('../utils/formatters');

const CATEGORIES = [
  {
    level: 'CRÍTICO', emoji: '🔴', name: 'Urgência',
    keywords: ['urgente','socorro','travado','presa','preso','bloqueada','bloqueado','emergencia','emergência','imediato','imediatamente','nao consigo','não consigo'],
    guestReply: 'Entendido! Acionei nossa equipe com prioridade máxima — alguém entrará em contato com você em instantes! 🚨',
  },
  {
    level: 'CRÍTICO', emoji: '🔴', name: 'Manutenção',
    keywords: ['ar condicionado','ar-condicionado','chuveiro','agua quente','água quente','vazamento','vazando','tv nao','tv não','televisao nao','televisão não','sem sinal','internet caiu','internet nao funciona','internet não funciona','fechadura','porta nao abre','porta não abre','sem energia','sem luz','barulho alto','barulho excessivo','nao funciona','não funciona'],
    guestReply: 'Entendido! Acionei nossa equipe de manutenção agora mesmo — vamos resolver isso o mais rápido possível. 🔧',
  },
  {
    level: 'OPERACIONAL', emoji: '🟡', name: 'Acesso / Check-in',
    keywords: ['nao consigo entrar','não consigo entrar','nao abriu','não abriu','perdi a chave','perdi o cartao','perdi o cartão','cartao parou','cartão parou','fora do horario','fora do horário','cheguei cedo','guardar mala','deixar mala','early check','late check'],
    guestReply: 'Claro! Vou acionar nossa recepção agora mesmo para te atender. Alguém entrará em contato em breve! 😊',
  },
  {
    level: 'OPERACIONAL', emoji: '🟡', name: 'Financeiro / Administrativo',
    keywords: ['cancelar','cancelamento','nota fiscal','reembolso','devolucao','devolução','estorno','desconto','negociar','alterar data','mudar data','trocar data','alterar valor','mudar valor','desistir da reserva'],
    guestReply: 'Entendido! Encaminhei sua solicitação para nossa equipe administrativa — eles entrarão em contato em breve. 📋',
  },
  {
    level: 'OPERACIONAL', emoji: '🟡', name: 'Itens / Governança',
    keywords: ['papel higienico','papel higiênico','toalha extra','mais toalha','roupa de cama','lencol','lençol','fronha','travesseiro','cobertor','manta','edredom','sabonete','shampoo','condicionador','secador de cabelo','secador','ferro de passar','cabide','lixo cheio','faltando','falta ','preciso de','precisamos de','trazer','subir','enviar para o quarto'],
    guestReply: 'Claro! Vou acionar nossa equipe de governança agora mesmo para te atender o mais rápido possível. 😊',
  },
  {
    level: 'OPERACIONAL', emoji: '🟡', name: 'Reclamação',
    keywords: ['reclamacao','reclamação','insatisfeito','insatisfeita','pessimo','péssimo','horrivel','horrível','nao gostei','muito ruim','inaceitavel','inaceitável','quarto sujo','limpeza ruim'],
    guestReply: 'Lamentamos muito pelo inconveniente. Encaminhei para nossa gerência — entrarão em contato para resolver isso da melhor forma. 🙏',
  },
  {
    level: 'OPERACIONAL', emoji: '🟡', name: 'Pagamento',
    keywords: ['problema com pagamento','problema no pagamento','pagamento nao','pagamento não','nao consegui pagar','não consegui pagar','erro no pagamento','nao caiu','não caiu','nao processou','não processou'],
    guestReply: 'Entendido! Encaminhei para nossa equipe financeira — entrarão em contato para resolver em breve. 💰',
  },
  {
    level: 'OPERACIONAL', emoji: '🟡', name: 'Serviços Especiais',
    keywords: ['transfer aeroporto','problema estacionamento','reservar restaurante','reserva de restaurante','aniversario','aniversário','decoracao','decoração','surpresa no quarto'],
    guestReply: 'Com prazer! Vou acionar nossa equipe para organizar tudo para você. Entrarão em contato em breve! 🎉',
  },
];

function classifyMessage(text) {
  const norm = normalizeText(text);
  for (const cat of CATEGORIES) {
    for (const kw of cat.keywords) {
      if (norm.includes(kw)) {
        return { level: cat.level, emoji: cat.emoji, name: cat.name, guestReply: cat.guestReply };
      }
    }
  }
  return null;
}

module.exports = { classifyMessage };
