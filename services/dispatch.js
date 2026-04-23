'use strict';

/**
 * dailyCheckinDispatch
 * Sends a WhatsApp summary of ALL active guests to the operations number.
 * Three sections:
 * - 🛎 Check-ins de hoje    (arrivals)
 * - 🏠 Em estadia           (mid-stay: arrived before today, checkout > today)
 * - 🚪 Check-outs de hoje   (checkout === today, from arrivals or priorArrivals)
 *
 * Trigger via cron — NOT on server boot.
 */

const { DISPATCH_NUMBER } = require('../config')
const { getCurrentDateBRT, resolveGuestName } = require('../utils/formatters');
const { fetchTodayAllActiveGuests } = require('./stays');
const { sendWhatsAppText } = require('./whatsapp');

function resolveApartmentName(r, listingsMap) {
  const nested = r.listing || r.unit || r.accommodation || {};
  const fromNested = nested.internalName || nested.nickname || nested.name || nested.title || nested.unitNumber;
  if (fromNested) return fromNested;
  const id = r._idlisting || r.listingId || r.unitId || r.accommodationId || nested._id || nested.id;
  if (id && listingsMap && listingsMap.get(id)) return listingsMap.get(id);
  return 'Apto desconhecido';
}

async function dailyCheckinDispatch() {
  try {
    const today = getCurrentDateBRT();
    const {
      arrivals: checkinsHoje,
      midStay: emEstadia,
      departures: checkoutsHoje = [],
      listingsMap,
    } = await fetchTodayAllActiveGuests();

    const formatLine = (r) => {
      const name = resolveGuestName(r);
      const apt = resolveApartmentName(r, listingsMap);
      const rawDate = r.checkOutDate || r.checkoutDate || r.endDate || '?';
      const checkout = rawDate !== '?' ? rawDate.split('-').reverse().join('/') : '?';
      const guests = r.guests || (r.guestsDetails && r.guestsDetails.length) || 1;
      return ` • ${name} → ${apt} — ${guests} hóspede${guests !== 1 ? 's' : ''} (saída: ${checkout})`;
    };

    const fmtCheckins  = checkinsHoje.length  === 0 ? ' (nenhum check-in hoje)'        : checkinsHoje.map(formatLine).join('\n');
    const fmtEstadia   = emEstadia.length     === 0 ? ' (nenhum hóspede em estadia)'   : emEstadia.map(formatLine).join('\n');
    const fmtCheckouts = checkoutsHoje.length === 0 ? ' (nenhum check-out hoje)'       : checkoutsHoje.map(formatLine).join('\n');

    // Total ativo = quem fica no hotel após o fim do dia.
    // Exclui check-outs (já de saída) e diárias (entra+sai no mesmo dia).
    const departureIds = new Set(checkoutsHoje.map((r) => String(r._id || r.id)));
    const checkinsAtivos = checkinsHoje.filter((r) => !departureIds.has(String(r._id || r.id)));
    const totalAtivos = checkinsAtivos.length + emEstadia.length;

    const mensagem = [
      `🏨 *TorresGuest — Relatório Diário*`,
      `📅 ${today}`,
      ``,
      `🛎 *Check-ins de hoje (${checkinsHoje.length}):*`,
      fmtCheckins,
      ``,
      `🏠 *Em estadia (${emEstadia.length}):*`,
      fmtEstadia,
      ``,
      `🚪 *Check-outs de hoje (${checkoutsHoje.length}):*`,
      fmtCheckouts,
      ``,
      `📊 *Total de hóspedes ativos hoje: ${totalAtivos}*`,
      `✅ Relatório gerado automaticamente.`,
    ].join('\n');

    const numbers = DISPATCH_NUMBER.split(',').map(n => n.trim()).filter(Boolean);
    for (const num of numbers) {
      await sendWhatsAppText(num, mensagem);
    }
    console.log('[dispatch] Relatório diário enviado para', numbers);
  } catch (err) {
    console.error('[dispatch] Erro no dailyCheckinDispatch:', err.message);
  }
}

async function sendEscalationAlert(guestPhone, originalMessage, classification) {
  try {
    const { level, emoji, name } = classification;
    const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const mensagem = [
      `${emoji} *TorresGuest — ALERTA ${level}*`,
      ``,
      `📱 *Hóspede:* +${guestPhone}`,
      `📋 *Categoria:* ${name}`,
      `⏰ *Horário (BRT):* ${now}`,
      ``,
      `💬 *Mensagem do hóspede:*`,
      `"${originalMessage}"`,
      ``,
      `👉 Por favor, entre em contato com o hóspede o quanto antes.`,
    ].join('\n');

    const numbers = DISPATCH_NUMBER.split(',').map(n => n.trim()).filter(Boolean);
    for (const num of numbers) {
      await sendWhatsAppText(num, mensagem);
    }
    console.log(`[dispatch] Alerta ${level} enviado para ${numbers.length} número(s) — categoria: ${name}`);
  } catch (err) {
    console.error('[dispatch] Erro no sendEscalationAlert:', err.message);
  }
}

async function sendFrigobarRestockNotification(guestPhone, originalMessage) {
  try {
    const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const mensagem = [
      '🧊 *TorresGuest — Reposição de Frigobar*',
      '',
      `📱 *Hóspede:* +${guestPhone}`,
      `⏰ *Horário (BRT):* ${now}`,
      '',
      '💬 *Solicitação:*',
      `"${originalMessage}"`,
      '',
      '👉 Por favor, acionar a governança para reposição.',
    ].join('\n');

    const numbers = DISPATCH_NUMBER.split(',').map(n => n.trim()).filter(Boolean);
    for (const num of numbers) {
      await sendWhatsAppText(num, mensagem);
    }
    console.log('[dispatch] Alerta de reposição de frigobar enviado');
  } catch (err) {
    console.error('[dispatch] Erro no sendFrigobarRestockNotification:', err.message);
  }
}

/**
 * Notifica o dispatch quando hóspede solicita táxi ou transfer com Robson/aeroporto.
 * Acionado sempre que shouldSendTransfer() = true.
 */
async function sendTransferAlert(guestPhone, originalMessage) {
  try {
    const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const mensagem = [
      '🚕 *TorresGuest — Solicitação de Táxi / Transfer*',
      '',
      `📱 *Hóspede:* +${guestPhone}`,
      `⏰ *Horário (BRT):* ${now}`,
      '',
      '💬 *Mensagem do hóspede:*',
      `"${originalMessage}"`,
      '',
      '👉 Entrar em contato com o hóspede para organizar o transfer/táxi com Robson.',
    ].join('\n');

    const numbers = DISPATCH_NUMBER.split(',').map(n => n.trim()).filter(Boolean);
    for (const num of numbers) {
      await sendWhatsAppText(num, mensagem);
    }
    console.log('[dispatch] Alerta de táxi/transfer enviado para', numbers);
  } catch (err) {
    console.error('[dispatch] Erro no sendTransferAlert:', err.message);
  }
}

/**
 * Notifica o dispatch quando hóspede solicita algo para o quarto
 * (toalhas, limpeza, snacks, itens de reposição, etc.).
 * Acionado para qualquer pedido de serviço ao apartamento.
 *
 * @param {string} guestPhone - número do hóspede
 * @param {string} originalMessage - mensagem original
 * @param {string} requestType - tipo do pedido (ex: 'Toalhas', 'Limpeza', 'Snacks')
 */
async function sendRoomRequestNotification(guestPhone, originalMessage, requestType) {
  try {
    const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const mensagem = [
      `🛎 *TorresGuest — Pedido ao Quarto: ${requestType}*`,
      '',
      `📱 *Hóspede:* +${guestPhone}`,
      `⏰ *Horário (BRT):* ${now}`,
      '',
      '💬 *Mensagem do hóspede:*',
      `"${originalMessage}"`,
      '',
      `👉 Acionar a governança para atender: *${requestType}*.`,
    ].join('\n');

    const numbers = DISPATCH_NUMBER.split(',').map(n => n.trim()).filter(Boolean);
    for (const num of numbers) {
      await sendWhatsAppText(num, mensagem);
    }
    console.log(`[dispatch] Alerta de pedido ao quarto (${requestType}) enviado para`, numbers);
  } catch (err) {
    console.error('[dispatch] Erro no sendRoomRequestNotification:', err.message);
  }
}

module.exports = {
  dailyCheckinDispatch,
  sendEscalationAlert,
  sendFrigobarRestockNotification,
  sendTransferAlert,
  sendRoomRequestNotification,
};
