'use strict';

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
  return (
    isNumericSelection(text, '8') ||
    /(checkin|check-in|checkout|check-out|horario de checkin|horario de checkout|entrada|saida|sa\u00edda)/.test(text)
  );
}

function shouldSendTransfer(text) {
  return isNumericSelection(text, '9') || /(transfer|aeroporto|uber|taxi|traslado)/.test(text);
}

function shouldSendHuman(text) {
  return (
    isNumericSelection(text, '10') ||
    /\b(falar com atendente|falar com atendimento|falar com humano|atendente humano|atendimento humano|quero falar com alguem|quero falar com uma pessoa|quero falar com humano|preciso de atendimento humano|me chama um atendente|me encaminha para atendente|me encaminhe para atendente|suporte humano)\b/.test(text)
  );
}

function shouldRedirectToReservationSite(text) {
  return /\b(reservar|reserva|nova reserva|fazer reserva|quero reservar|quero fazer uma reserva|como faco minha reserva|consigo reservar|posso reservar|fechar reserva|fechar hospedagem|disponibilidade|tem vaga|tem disponibilidade|ha vaga|valor da diaria|quanto custa|preco|diaria|quarto disponivel|acomodacao|hospedagem|ficar do dia|entrada dia|saida dia|checkin dia|checkout dia)\b/.test(text);
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
  return isNumericSelection(text, '11') || /(confirmar|confirmacao|status|codigo).*reserva/.test(text);
}

function detectLanguage(text) {
  if (!text) return 'pt';
  const t = text.toLowerCase();
  if (/(hello|hi|hey|good morning|good afternoon|good evening|thanks|thank you|price|book|booking|reservation|where|address|location|located|hotel|check in|check-in|check out|checkout|wifi|pool|gym|breakfast|parking)/.test(t)) {
    return 'en';
  }
  if (/(hola|buenos dias|buenas tardes|buenas noches|gracias|precio|reserva|direccion|direcci\u00f3n|ubicacion|ubicaci\u00f3n|donde|hotel|check in|check-in|check out|checkout|wifi|piscina|gimnasio|desayuno|estacionamiento)/.test(t)) {
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
};
