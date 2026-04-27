'use strict';

/**
 * Strip accents and lowercase — used internally so regexes without accents
 * still match inputs like "água", "café", "olá", etc.
 */
function stripAccents(t) {
  return (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isNumericSelection(text, ...options) {
    // Fix: require the option to appear as a standalone number (word boundary).
      // "5" → match; "PS5" or "PS5 na TV" → NO match (digit not isolated).
        return options.some(opt => new RegExp('(?:^|\\s)' + opt + '(?:\\s|[.,!?]|$)').test(text.trim()));
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
  return (
    isNumericSelection(text, '8') ||
    /(checkin|check-in|checkout|check-out|horario de checkin|horario de checkout|entrada|saida|sa\u00edda)/.test(text)
  );
}

function shouldSendTransfer(text) {
  // \b evita matchar "transferisse"/"transferir"/"transferência" (que indicam pedir
  // transferência pra outro atendente, não transfer aeroporto). Caso real 27/04:
  // "transferisse para atendimento humano" caiu aqui antes do shouldSendHuman.
  return isNumericSelection(text, '9') || /\b(transfer|aeroporto|uber|taxi|traslado)\b/.test(text);
}

function shouldSendHuman(text) {
  return (
    isNumericSelection(text, '10') ||
    /\b(falar com atendente|falar com atendimento|falar com humano|atendente humano|atendimento humano|quero falar com alguem|quero falar com uma pessoa|quero falar com humano|preciso de atendimento humano|me chama um atendente|me encaminha para atendente|me encaminhe para atendente|suporte humano|me transfere para humano|me transfira para humano|me transfere para atendente|me transfira para atendente|transfere para humano|transfira para humano|transfere para atendente|transfira para atendente)\b/.test(text)
  );
}

function shouldHandleCancellationRequest(text) {
  // Hospede ATIVAMENTE pedindo pra cancelar a reserva (diferente de cancellation
  // retention que captura motivo APOS cancellation event no Stays). Aqui é
  // proatividade: se hospede manda "quero cancelar minha reserva" via WhatsApp,
  // direcionamos pra plataforma de origem ou pra humano.
  return /\b(quero cancelar|preciso cancelar|gostaria de cancelar|posso cancelar|cancelar minha reserva|cancelar a reserva|cancelar a hospedagem|cancelamento da reserva|desistir da reserva|desistir da hospedagem|desistir da estadia|nao vou conseguir ir|nao posso mais ir|nao consigo ir mais)\b/.test(text);
}

function shouldRedirectToReservationSite(text) {
  return /\b(reservar|nova reserva|fazer reserva|quero reservar|quero fazer uma reserva|como faco minha reserva|consigo reservar|posso reservar|fechar reserva|fechar hospedagem|disponibilidade|tem vaga|tem disponibilidade|ha vaga|valor da diaria|preco|diaria|quarto disponivel|acomodacao|hospedagem|ficar do dia|entrada dia|saida dia|checkin dia|checkout dia)\b/.test(text);
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
  return /\b(oi|ola|ol\u00e1|bom dia|boa tarde|boa noite|e ai|eai|hey|hello|hi|como vai|tudo bem)\b/.test(text);
}

function shouldSendThanks(text) {
  return /\b(obrigado|obrigada|valeu|agradeco|agrade\u00e7o|thanks|thank you)\b/.test(text);
}

// FIX: these were called but never defined in the original monolith
function shouldSendCurrentDate(text) {
  return /(que dia|qual o dia|data de hoje|hoje e dia|que data)/.test(text);
}

function shouldSendCurrentTime(text) {
  return /(que horas|qual a hora|horas sao|hora atual|que hora e|que hora sao)/.test(text);
}

function shouldHandleReservationConfirmation(text) {
  return (
    isNumericSelection(text, '11') ||
    // pedido explícito de confirmação
    /(confirmar|confirmacao|status|codigo).*reserva/.test(text) ||
    // hóspede diz que JÁ TEM uma reserva
    /\b(tenho|ja tenho|ja fiz|fiz a|temos)\b.{0,20}\breserva\b/.test(text) ||
    // "minha reserva" / "nossa reserva"
    /\b(minha|nossa)\b.{0,10}\breserva\b/.test(text) ||
    // "como confirmo" / "quero confirmar"
    /\b(como|quero|preciso).{0,15}\bconfirm/.test(text)
  );
}

function detectLanguage(text) {
  if (!text) return 'pt';
  const t = text.toLowerCase();
  if (/(hello|hi|hey|good morning|good afternoon|good evening|thanks|thank you|price|book|booking|reservation|where|address|location|located|hotel|check in|check-in|check out|checkout|wifi|pool|gym|breakfast|parking)/.test(t)) {
    return 'en';
  }
  if (/(hola|buenos dias|buenas tardes|buenas noches|gracias|precio|direccion|direcci\u00f3n|ubicacion|ubicaci\u00f3n|donde|hotel|check in|check-in|check out|checkout|wifi|piscina|gimnasio|desayuno|estacionamiento)/.test(t)) {
    return 'es';
  }
  return 'pt';
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

// ─── Frigobar / Minibar ────────────────────────────────────────────────────────────────────────

/**
 * Items that can be in the frigobar — tested on ACCENT-STRIPPED text.
 * Includes common variants: com/sem gás, refri, latinha, garrafinha, etc.
 */
const FRIGOBAR_ITEMS_REGEX = /(agua com gas|agua sem gas|agua|refri|refrigerante|coca cola|coca|guarana|suco|fanta|cerveja|vinho|energetico|red bull|monster|chocolate|bala|drops|halls|chiclete|latinha|garrafinha|garrafao|garrafinha)/;

/**
 * Returns true if the guest is asking how to pay for a frigobar item.
 *
 * FIX 2026-04-09: expandido para capturar perguntas de pagamento que não
 * mencionam explicitamente "frigobar" — ex: "preciso saber como eu pago",
 * "como eu pago o consumo", etc. No contexto deste bot de hotel, qualquer
 * pergunta genérica sobre como pagar refere-se ao consumo do quarto.
 *
 * IMPORTANTE: nunca informar checkout da recepção — sempre responder com
 * FRIGOBAR_PIX_RESPONSE (PIX + lista de produtos).
 */
function shouldSendFrigobarPix(text) {
  const t = stripAccents(text);
  // Responde com cardapio + PIX para qualquer mencao ao frigobar que NAO seja
  // pedido de reposicao nem contexto de reserva.
  // Ex: "tem frigobar?", "o que tem no frigobar", "como eu pago o frigobar", "cardapio"
  const isFrigobarMention = /frigobar|minibar|mini.?bar/.test(t);
  const isPaymentOrMenu = /(como.*(pago?|pagar)|preciso.*pag|quanto.*(custa|vale|e)|pix|cardapio)/.test(t);
  const isReservationContext = /(reserva|hosped|estadia|diaria|apartamento|check.?in|check.?out|quarto|bilhete|booking)/.test(t);
  const isRestockIntent = /(repor|reposi|vazio|acabou?|esgotou?|faltou?|sem (bebida|item|agua|cerveja|refrigerante|estoque)|precis.*(repor|abastecer|encher|completar))/.test(t);
  return (isFrigobarMention || isPaymentOrMenu) && !isReservationContext && !isRestockIntent;
}
function shouldRequestFrigobarRestock(text) {
  const t = stripAccents(text);
  // Only trigger when user explicitly asks to restock/refill the minibar
  return /frigobar/.test(t) &&
    /(repor|reposi|vazio|acabou?|esgotou?|faltou?|sem (bebida|item|agua|cerveja|refrigerante|estoque)|precis.*(repor|abastecer|encher|completar))/.test(t);
}


module.exports = {
  isNumericSelection,
  shouldSendMenu,
  shouldSendWifi,
  shouldSendBreakfast,
  shouldSendPool,
  shouldSendParking,
  shouldSendSnacks,
  shouldSendTowels,
  shouldSendRestaurant,
  shouldSendCheckin,
  shouldSendTransfer,
  shouldSendHuman,
  shouldHandleCancellationRequest,
  shouldRedirectToReservationSite,
  shouldSendSecurity,
  shouldSendLocation,
  shouldSendLongStay,
  shouldSendCleaning,
  shouldSendInternet,
  shouldSendLuggage,
  shouldSendGreeting,
  shouldSendThanks,
  shouldSendCurrentDate,
  shouldSendCurrentTime,
  shouldHandleReservationConfirmation,
  detectLanguage,
  extractReservationCode,
  shouldSendFrigobarPix,
  shouldRequestFrigobarRestock,
};
