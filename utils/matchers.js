'use strict';

/**
 * Strip accents and lowercase — used internally so regexes without accents
 * still match inputs like "água", "café", "olá", etc.
 */
function stripAccents(t) {
  return (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isNumericSelection(text, ...options) {
  // Fix 2026-05-04: o texto INTEIRO deve ser o dígito (com pontuação opcional).
  // Antes: '(?:^|\\s)3(?:\\s|...)' matchava "3 pessoas", "para as 3 pessoas?" etc.
  // Casos reais: Eliana ("...para as 3 pessoas?") → wantsPool=true → resposta sobre
  // piscina/academia. Vania ("...para 2 pessoas disponivel?") → wantsBreakfast=true
  // → resposta sobre cafe da manha. Total off-topic.
  // Agora so matcha "3", "3.", "3?", "3!" — resposta a menu numerado puro.
  const t = (text || '').trim();
  return options.some(opt => new RegExp('^' + opt + '[.,!?]?$').test(t));
}

function shouldSendMenu(text) {
  return isNumericSelection(text, '0') || /\b(menu|opcao|opcoes|ajuda|inicio|start|comecar)\b/.test(text);
}

function shouldSendWifi(text) {
  return isNumericSelection(text, '1') || /(wi\s*-?\s*fi|wifi|senha do wi fi|senha wifi|senha do wifi)/.test(text);
}

function shouldSendBreakfast(text) {
  if (isNumericSelection(text, '2')) return true;
  // Variações: "cafe da manha", "cafe manha" (sem da), "cafeda manha" (typo Ricardo
  // Airbnb 12/05/2026 "caféda manhã" grudado), "café-da-manhã" (com hífen),
  // "breakfast", "desjejum"
  return /(cafe?\s*(da|de)?\s*manh[aã]|breakfast|desjejum)/.test(text);
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
  if (isNumericSelection(text, '7')) return true;
  // 1) Match explícito de "restaurante do hotel/no hotel/no predio"
  if (/(restaurante do hotel|restaurante no hotel|restaurante do predio|restaurante no predio)/.test(text)) return true;
  // 2) Refeições / horários — termo "restaurante" + qualquer cue
  // Bug 12/05/2026 (Dio Cavalcanti): "O Restaurante fica aberto até que horas?"
  // não matchava → caía no AI fallback que devolveu "Agora são 21:50".
  if (/\brestaurante\b/.test(text) && /\b(aberto|abre|fechad|horario|hora|hrs|hr|que horas|ate que|funciona|funcionamento|servico|cardapio|menu|reserv)\b/.test(text)) return true;
  // 3) Refeições standalone (substantivo OU verbo: almoco/almocar, janta/jantar)
  if (/(almoc[oa]r?|jant(a|ar)|refeic\w+|cafe da manha|brunch)\b/.test(text)) return true;
  return false;
}

// Pedido/delivery — encaminha pra landing do Don Maitre (parceiro) com cupom.
// Avaliado ANTES de shouldSendRestaurant em PT_DISPATCH pra "pedir comida"
// não cair na resposta genérica de "restaurante do hotel".
function shouldSendFoodOrder(text) {
  return /(pedir comida|pedido de comida|fazer um pedido|fazer pedido|pedido no restaurante|cardapio|cardápio|pedir refei|delivery|ifood|i food|food order|order food|fome|estou com fome|comida no quarto|room service)/.test(text);
}

/**
 * Universal restaurant-menu matcher (PT / EN / FR / ES).
 * Avaliado ANTES do PT_DISPATCH pra capturar pedidos de cardápio em qualquer
 * idioma e enviar resposta i18n com link Don Maitre. Adicionado 2026-05-04.
 *
 * V2 2026-05-04 (após teste real Valney): regex original exigia "cardapio +
 * restaurante" juntos. "Preciso do cardápio" não matchava. Agora:
 *   - Matcha qualquer pedido de cardápio/menu/carta
 *   - EXCLUI menção a frigobar/minibar (cai em FRIGOBAR_PIX)
 *   - EXCLUI menu numerado interno do bot ("menu principal/inicial/opcoes")
 *
 * Examples that match (post-V2):
 *   PT: "cardapio", "preciso do cardapio", "me manda o cardapio"
 *   EN: "menu", "restaurant menu", "send me the menu"
 *   FR: "menu", "carte du restaurant", "envoyez la carte"
 *   ES: "carta", "menu del restaurante"
 *
 * Examples that DON'T match:
 *   "cardapio do frigobar" → frigobar
 *   "menu de opcoes / menu principal / menu inicial" → menu numerado do bot
 */
function shouldSendRestaurantMenuI18n(text) {
  const t = stripAccents(text);
  // Excludes que NÃO devem enviar restaurante
  if (/frigobar|minibar|mini.?bar/.test(t)) return false;
  if (/menu de opc|menu principal|menu inicial|menu de comand/.test(t)) return false;
  // Matches: cardapio (PT) é forte sozinho; menu/carta exigem ou contexto
  // "restaurant" ou ser a request principal (frase curta com 1-3 palavras).
  if (/cardapio/.test(t)) return true;
  if (/(menu.*restaurant|restaurant.*menu|restaurante.*menu|menu.*restaurante|carte.*restaurant|restaurant.*carte|carta.*restaurante|restaurante.*carta|carta del restaurante|carte du restaurant)/.test(t)) return true;
  // Frase curta com "menu" ou "carta" ≤ 4 palavras → provavelmente pedido de cardápio
  const words = t.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 4 && /\b(menu|carta)\b/.test(t)) return true;
  return false;
}

function shouldSendCheckin(text) {
  return (
    isNumericSelection(text, '8') ||
    /(checkin|check-in|checkout|check-out|horario de checkin|horario de checkout|entrada|saida|sa\u00edda)/.test(text)
  );
}

/**
 * Detecta interesse em SER anfitri\u00e3o de Airbnb (prospect/anfitri\u00e3o novo).
 * Encaminha pro curso "Desvendando o Airbnb" (Hotmart, afilia\u00e7\u00e3o ativa).
 *
 * Importante: matcher narrow pra evitar falso-positivo com h\u00f3spede atual da
 * TorresGuest que mencione "Airbnb" em outro contexto (ex: "wifi do airbnb",
 * "checkin do airbnb"). Por isso reject early se contexto guest-t\u00edpico.
 *
 * Adicionado 2026-05-06.
 */
function shouldSendHostingCourse(text) {
  // Reject cedo: contexto t\u00edpico de h\u00f3spede ATIVO (n\u00e3o prospect anfitri\u00e3o)
  if (/\b(wifi|wi.?fi|checkin|check.in|checkout|check.out|endereco|recepcao|piscina|cafe.{0,4}manha|toalha|estacionamento|frigobar|minibar|mini.?bar|sua reserva|minha reserva|meu apartamento|meu quarto)\b/.test(text)) {
    return false;
  }
  // Intent claras de quem quer SE TORNAR ou MELHORAR como anfitri\u00e3o
  return /(como ser anfitriao|ser anfitriao|virar anfitriao|tornar.{0,15}anfitriao|primeiro airbnb|abrir.{0,5}airbnb|ter um airbnb|montar.{0,5}airbnb|sou.{0,5}anfitriao|monetizar.{0,10}imovel|aluguel.{0,15}temporada|ganhar.{0,10}(com |no )airbnb|ganhar dinheiro.{0,15}airbnb|renda.{0,10}(com |no )airbnb|dicas.{0,10}airbnb|dicas.{0,10}anfitriao|curso.{0,10}airbnb|curso.{0,10}anfitriao|superhost|super host|profissionalizar.{0,15}airbnb)/.test(text);
}

// ── FAQ coverage gaps cobertos 06/05/2026 ──────────────────────────────────
// 4 críticos (Documents/HotelAccess/Safe/Invoice) + 6 médios (CommonAreas,
// Bedding, DateChange, HotelMaintenance, BreakfastCompanion, ParkingEarly).
// Todos validados via smoke test; matchers narrow pra evitar substring colisão
// (vide fix do classifier 06/05).

function shouldSendDocuments(text) {
  // "Preciso levar documento?", "que docs", "criança precisa documento", "RG/CNH/passaporte"
  return /\b(documento|documentos|preciso (de )?levar (rg|cnh|doc)|que documento|quais documento|levar rg|levar cnh|levar passaporte|crianca.{0,5}(precisa|documento)|menor.{0,5}documento|doc.{0,3}com foto)\b/.test(text);
}

function shouldSendHotelAccess(text) {
  // "Como faço pra entrar?", "É hotel ou TorresGuest?", "Como acesso", "Como chego"
  // Excludes "como acesso o wifi" — wifi tem matcher próprio
  if (/\b(wifi|wi.?fi|internet)\b/.test(text)) return false;
  return /\b(como (faco|faço|fazer) (pra |para )?(entrar|acessar)|como (eu )?entro|como acesso o hotel|hospedagem.{0,20}(hotel|torres|voces|com voces|ou voces)|reserva.{0,15}(com o hotel|com hotel|com torres|com voces|ou hotel)|fala(r)? com quem|com quem (eu )?falo na chegada|recepcao do hotel|primeiro acesso)\b/.test(text);
}

function shouldSendSafe(text) {
  // "Cofre", "como uso o cofre", "cofre travou"
  return /\b(cofre|caixa.forte|safe(box)?)\b/.test(text);
}

function shouldSendInvoice(text) {
  // "Nota fiscal", "NF", "recibo", "comprovante"
  return /\b(nota fiscal|nf|nfe|nfse|recibo|comprovante.{0,10}(pagamento|hospedagem)|emitir nota|emitem nota|preciso (de )?nota|preciso (de )?recibo)\b/.test(text);
}

function shouldSendCommonAreas(text) {
  // "Áreas comuns", "que áreas posso usar"
  // Avaliado APÓS shouldSendPool, shouldSendBreakfast, shouldSendRestaurant — mais específicos
  return /\b(areas? comuns?|que areas?|quais areas?|usar (o |as )?(estrutura|hotel|areas?)|estrutura do hotel|posso usar (o |as )?hotel|posso usar (o |as )?areas)\b/.test(text);
}

function shouldSendBedding(text) {
  // "Lençol", "fronha", "travesseiro extra", "edredom", "cobertor", "enxoval", "sofa-cama"
  // Avaliado APÓS shouldSendTowels (toalha tem matcher próprio)
  return /\b(lencol|fronha|travesseiro|cobertor|edredom|edredon|colcha|roupa de cama|trocar.{0,10}cama|mais.{0,5}travesseiro|mais.{0,5}cobertor|cama (mais )?dura|cama (mais )?mole|colchao|enxoval|sofa.?cama|sofa cama|cama extra|cama adicional)\b/.test(text);
}

function shouldHandleDateChange(text) {
  // "Quero remarcar", "alterar data", "mudar data", "trocar data"
  // NÃO confundir com cancelamento — explícito sobre alteração
  return /\b(remarcar|alterar.{0,5}data|alterar.{0,5}reserva|mudar.{0,5}data|trocar.{0,5}data|adiar.{0,10}reserva|antecipar.{0,10}reserva|estender.{0,10}reserva|prorrogar.{0,10}reserva|mudar (a )?reserva pra)\b/.test(text);
}

function shouldSendHotelMaintenance(text) {
  // Hóspede pergunta proativamente sobre obras/reformas no hotel
  // NÃO confundir com classifier 'Manutenção' (problema NO quarto)
  return /\b(tem obra|obra no hotel|reforma no hotel|vai ter obra|vai ter reforma|barulho de obra|construcao no predio|obra (no )?predio)\b/.test(text);
}

function shouldSendBreakfastCompanion(text) {
  // "Café acompanhante", "café extra", "visitante café", "levar visita café"
  // Avaliado APÓS shouldSendBreakfast
  return /\b(cafe.{0,15}(acompanhante|visitante|visita|extra|amigo|adicional)|acompanhante.{0,10}cafe|levar.{0,10}cafe|mais (uma )?pessoa.{0,10}cafe|cafe pra mais|cafe pra dois|cafe pra duas)\b/.test(text);
}

function shouldSendParkingEarly(text) {
  // "Posso deixar carro antes do checkin?", "estacionar antes"
  // Pre-condição: tem que falar de carro/estacionamento
  if (!/\b(carro|veiculo|estacion|estacionar|estacionamento)\w*/.test(text)) return false;
  // E menção a "antes" + check-in
  return /\bantes\s+(do\s+|de\s+|o\s+)?check/.test(text)
    || (/\b(antes|antecipad|adiantad)/.test(text) && /check.?in/.test(text));
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
  // S\u00f3 dispara quando a mensagem \u00e9 PURAMENTE agradecimento curto.
  // Antes (regex bruta) capturava "...por volta das 14h? obrigada!" e ignorava
  // a pergunta principal (caso Cecilia 01/05/2026, msgs 1-4 sem checkout).
  if (!text) return false;
  const stripped = String(text)
    .replace(/[\s.!?,;:\-]+/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '') // emojis
    .toLowerCase();
  if (stripped.length > 40) return false;
  return /^(obrigado|obrigada|valeu|agradeco|agrade\u00e7o|thanks|thankyou|tks|vlw|grato|grata|brigado|brigada|muitoobrigado|muitoobrigada){1,2}$/.test(stripped);
}

// FIX: these were called but never defined in the original monolith
function shouldSendCurrentDate(text) {
  return /(que dia|qual o dia|data de hoje|hoje e dia|que data)/.test(text);
}

function shouldSendCurrentTime(text) {
  return /(que horas|qual a hora|horas sao|hora atual|que hora e|que hora sao)/.test(text);
}

/**
 * Normalizador local: lowercase + remove diacríticos preservando a letra
 * base (â→a, ç→c, ã→a). Usar em matchers próprios em vez do normalizeText
 * global, que decompõe via NFD e gera espaço onde havia diacrítico
 * ("presença" vira "presenc a", "vão" vira "va o").
 */
function normalizeKeepLetters(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detecta pedido de antecipação de chegada de acompanhante da MESMA reserva
 * — titular avisa que outra pessoa da reserva chegará antes ou pede acesso
 * sem sua presença. Caso real 29/04: "A Camila chegará mais cedo do que eu,
 * precisando do acesso sem minha presença."
 *
 * Política TorresGuest permite, desde que o titular pré-envie documento +
 * nome completo + horário. NÃO é negar — é orientar.
 *
 * Conservador: exige (A) "sem minha presença" claro, OU (B) chegada antes
 * do titular explícita, OU (C) menção a acompanhante + sinal claro de
 * antecipação. Evita falso-positivo em "minha esposa quer entrar na piscina".
 *
 * IMPORTANTE: recebe `rawText` (não-normalizado) — usa normalizeKeepLetters
 * em vez do normalizeText global (que quebra "ç" e "~" em espaço).
 */
function shouldHandleEarlyCompanionArrival(rawText) {
  const t = normalizeKeepLetters(rawText);

  // A) acesso/entrada SEM a presença do titular — sinal forte e raro fora deste contexto
  if (/\bsem\s+(minha|nossa)\s+presenca\b/.test(t)) return true;
  if (/\b(acesso|entrar|entrada|ingresso)\b.{0,30}\bsem\s+(mim|o\s+titular|a\s+minha\s+presenca|a\s+nossa\s+presenca)\b/.test(t)) return true;
  if (/\b(deixar|permitir|liberar)\s+(?:[ao]s?\s+)?(entrar|acessar|entrada|acesso)\b.{0,30}\b(antes|sem\s+mim|sem\s+minha)\b/.test(t)) return true;

  // B) chegada de terceiro antes do titular — "chegará antes de mim", "vai chegar primeiro que eu"
  const arrivalVerb = /\b(cheg(a|ar|ara|ando|aria)|vai\s+chegar|vir|virao|chegando)\b/.test(t);
  const earlyAdverb = /\b(antes|primeiro|mais\s+cedo|cedo|antecipad)\b/.test(t);
  const beforeMe = /\b(do\s+que\s+eu|de\s+mim|antes\s+de\s+mim|que\s+eu\s+chegue|que\s+eu)\b/.test(t);
  if (arrivalVerb && earlyAdverb && beforeMe) return true;

  // C) acompanhante mencionado + intenção clara de antecipação/acesso prévio
  const companion = /\b(acompanhante|outra\s+hospede|outro\s+hospede|outra\s+pessoa\s+da\s+reserva|companheir[oa]|namorad[oa]|esposa|marido|esposo|conjuge|filh[oa]|irma[oa]|sobrinh[oa]|amig[oa]\s+(meu|minha))\b/.test(t);
  const earlyArrivalIntent = (arrivalVerb && earlyAdverb)
    || /\bantes\s+(de|da)\s+(mim|minha\s+chegada|nossa\s+chegada)\b/.test(t)
    || /\b(pode|poderia|poderiam)\s+(receber|liberar|deixar\s+entrar)\b/.test(t);
  if (companion && earlyArrivalIntent) return true;

  return false;
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
  // Fix 2026-05-04: "cardapio do restaurante" disparava aqui ("cardapio" matchava
  // isPaymentOrMenu). Agora qualquer mencao a restaurante/comida pulou para o
  // matcher correto (shouldSendFoodOrder → FOOD_ORDER_RESPONSE Don Maitre).
  // Caso reportado: hospede pergunta "cardapio do restaurante" → recebia frigobar.
  const isRestaurantContext = /(restaurante|delivery|ifood|i food|comida|refeicao|refeicoes|jantar|almoco|menu)/.test(t);
  return (isFrigobarMention || isPaymentOrMenu)
    && !isReservationContext
    && !isRestockIntent
    && !isRestaurantContext;
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
  shouldSendFoodOrder,
  shouldSendRestaurantMenuI18n,
  shouldSendCheckin,
  shouldSendHostingCourse,
  shouldSendDocuments,
  shouldSendHotelAccess,
  shouldSendSafe,
  shouldSendInvoice,
  shouldSendCommonAreas,
  shouldSendBedding,
  shouldHandleDateChange,
  shouldSendHotelMaintenance,
  shouldSendBreakfastCompanion,
  shouldSendParkingEarly,
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
  shouldHandleEarlyCompanionArrival,
  detectLanguage,
  extractReservationCode,
  shouldSendFrigobarPix,
  shouldRequestFrigobarRestock,
};
