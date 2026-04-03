'use strict';

/**
 * dailyCheckinDispatch
 * Sends a WhatsApp summary of ALL active guests to the operations number.
 * Two sections:
 * - 🛎 Check-ins de hoje
 * - 🏨 Em estadia (mid-stay: arrived before today, checkout >= today)
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
  const id = r.listingId || r.unitId || r.accommodationId || nested._id || nested.id;
  if (id && listingsMap && listingsMap[id]) return listingsMap[id];
  return 'Apto desconhecido';
}

async function dailyCheckinDispatch() {
  try {
    const today = getCurrentDateBRT();
    const { arrivals: checkinsHoje, midStay: emEstadia, listingsMap } = await fetchTodayAllActiveGuests();

    const fmtCheckins = checkinsHoje.length === 0
      ? '  (nenhum check-in hoje)'
      : checkinsHoje.map(r => {
          const name = resolveGuestName(r);
          const apt = resolveApartmentName(r, listingsMap);
          const checkout = r.checkoutDate || r.endDate || '?';
          return `  • ${name} → ${apt} (saída: ${checkout})`;
        }).join('\n');

    const fmtEstadia = emEstadia.length === 0
      ? '  (nenhum hóspede em estadia)'
      : emEstadia.map(r => {
          const name = resolveGuestName(r);
          const apt = resolveApartmentName(r, listingsMap);
          const checkout = r.checkoutDate || r.endDate || '?';
          return `  • ${name} → ${apt} (saída: ${checkout})`;
        }).join('\n');

    const mensagem = [
      `🏨 *TorresGuest — Relatório Diário*`,
      `📅 ${today}`,
      ``,
      `🛎 *Check-ins de hoje:*`,
      fmtCheckins,
      ``,
      `🏠 *Em estadia:*`,
      fmtEstadia,
      ``,
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

module.exports = { dailyCheckinDispatch, sendEscalationAlert, sendFrigobarRestockNotification };
