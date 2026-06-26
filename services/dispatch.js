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

const { DISPATCH_NUMBER, DAILY_REPORT_EMAILS } = require('../config')
const { sendDailyReportEmail } = require('./dailyReportEmail')
const { getCurrentDateBRT, resolveGuestName } = require('../utils/formatters');
const { fetchTodayAllActiveGuests } = require('./stays');
const { sendWhatsAppText, sendDailyReportTemplate } = require('./whatsapp');
const { buildDailyReportVars, buildDailyReportV2Vars } = require('../utils/templates');

// Feature flag — quando true, daily report usa Meta template (funciona fora janela 24h).
// Desligar pra rollback emergencial: `WA_DAILY_REPORT_USE_TEMPLATE=false` no Render.
const USE_TEMPLATE = (process.env.WA_DAILY_REPORT_USE_TEMPLATE || 'true').toLowerCase() !== 'false';

// Feature flag v2 (introduzida 04/05): quando true, usa template `daily_report_v2`
// com 1 placeholder por hóspede (cada {{N}} = 1 linha). Resultado: relatório
// linha-por-linha mesmo via template (sem depender de janela 24h aberta).
// Ativar: setar AMBAS no Render:
//   - WA_DAILY_REPORT_USE_V2=true
//   - WA_DAILY_REPORT_TEMPLATE_NAME=daily_report_v2
const USE_V2 = (process.env.WA_DAILY_REPORT_USE_V2 || 'false').toLowerCase() === 'true';

function resolveApartmentName(r, listingsMap) {
  const nested = r.listing || r.unit || r.accommodation || {};
  const fromNested = nested.internalName || nested.nickname || nested.name || nested.title || nested.unitNumber;
  if (fromNested) return fromNested;
  const id = r._idlisting || r.listingId || r.unitId || r.accommodationId || nested._id || nested.id;
  if (id && listingsMap && listingsMap.get(id)) return listingsMap.get(id);
  // Fallback resiliente (13/06/2026): se o listingsMap (env LISTING_NAMES_JSON) estiver
  // vazio/malformado, usar o nome que a própria reserva já carrega. Evita "Apto desconhecido"
  // em massa quando o env quebra (incidente env duplo-encodado 13/06).
  const fromReservation =
    (typeof r.listingName === 'string' && r.listingName.trim()) ||
    (typeof r.accommodation === 'string' && r.accommodation.trim()) ||
    (typeof r.property === 'string' && r.property.trim());
  if (fromReservation) return fromReservation;
  return 'Apto desconhecido';
}

async function dailyCheckinDispatch() {
  try {
    const today = getCurrentDateBRT();
    const {
      arrivals: checkinsHojeRaw,
      midStay: emEstadiaRaw,
      departures: checkoutsHojeRaw = [],
      listingsMap,
    } = await fetchTodayAllActiveGuests();

    // FIX 26/06: o 1704 (glauco-vaz) vem na conta Stays da torres E pelo recepcao-extra → duplicava.
    // Removemos do pull principal as unidades cobertas pelo recepcao-extra (fonte única delas).
    const EXTRA_UNITS = new Set((process.env.DAILY_REPORT_EXTRA_UNITS || '1704').split(',').map((s) => s.trim()).filter(Boolean));
    const _isExtraUnit = (r) => EXTRA_UNITS.has(String(resolveApartmentName(r, listingsMap)).trim());
    const checkinsHoje  = checkinsHojeRaw.filter((r) => !_isExtraUnit(r));
    const emEstadia     = emEstadiaRaw.filter((r) => !_isExtraUnit(r));
    const checkoutsHoje = checkoutsHojeRaw.filter((r) => !_isExtraUnit(r));

    const formatLine = (r) => {
      const name = resolveGuestName(r);
      const apt = resolveApartmentName(r, listingsMap);
      const rawDate = r.checkOutDate || r.checkoutDate || r.endDate || '?';
      const checkout = rawDate !== '?' ? rawDate.split('-').reverse().join('/') : '?';
      const guests = r.guests || (r.guestsDetails && r.guestsDetails.length) || 1;
      return ` • ${name} → ${apt} — ${guests} hóspede${guests !== 1 ? 's' : ''} (saída: ${checkout})`;
    };

    // Unidades EXTRA do predio (outros tenants, ex.: 1704 glauco-vaz) — Opcao B (15/06/2026)
    let extraUnits = { arrivals:{count:0,lines:[]}, midStay:{count:0,lines:[]}, departures:{count:0,lines:[]}, active:0 };
    try {
      if (process.env.RECEPCAO_EXTRA_URL) {
        const _er = await fetch(process.env.RECEPCAO_EXTRA_URL, { headers: { 'x-recepcao-secret': process.env.RECEPCAO_EXTRA_SECRET || '' } });
        if (_er.ok) { const _ed = await _er.json(); if (_ed && _ed.ok) extraUnits = _ed; }
        else console.error('[dispatch] recepcao-extra HTTP', _er.status);
      }
    } catch (e) { console.error('[dispatch] recepcao-extra error', e.message); }
    const exA = (extraUnits.arrivals   && extraUnits.arrivals.lines)   ? extraUnits.arrivals.lines   : [];
    const exM = (extraUnits.midStay    && extraUnits.midStay.lines)    ? extraUnits.midStay.lines    : [];
    const exD = (extraUnits.departures && extraUnits.departures.lines) ? extraUnits.departures.lines : [];
    const checkinsCount  = checkinsHoje.length  + exA.length;
    const estadiaCount   = emEstadia.length     + exM.length;
    const checkoutsCount = checkoutsHoje.length + exD.length;

    const fmtCheckins  = checkinsCount  === 0 ? [' (nenhum check-in hoje)']      : [...checkinsHoje.map(formatLine),  ...exA];
    const fmtEstadia   = estadiaCount   === 0 ? [' (nenhum hóspede em estadia)'] : [...emEstadia.map(formatLine),     ...exM];
    const fmtCheckouts = checkoutsCount === 0 ? [' (nenhum check-out hoje)']     : [...checkoutsHoje.map(formatLine), ...exD];

    const departureIds = new Set(checkoutsHoje.map((r) => String(r._id || r.id)));
    const checkinsAtivos = checkinsHoje.filter((r) => !departureIds.has(String(r._id || r.id)));
    const totalAtivos = checkinsAtivos.length + emEstadia.length + (extraUnits.active || 0);

    const numbers = DISPATCH_NUMBER.split(',').map(n => n.trim()).filter(Boolean);

    // Free-text formatado — usado tanto no path híbrido (após template) quanto no legado.
    // Cada hóspede em sua própria linha; só passa pra quem tem janela 24h aberta com o bot.
    const freeTextMessage = [
      `🏨 *TorresGuest — Relatório Diário*`,
      `📅 ${today}`,
      ``,
      `🛎 *Check-ins de hoje (${checkinsCount}):*`,
      fmtCheckins.join('\n'),
      ``,
      `🏠 *Em estadia (${estadiaCount}):*`,
      fmtEstadia.join('\n'),
      ``,
      `🚪 *Check-outs de hoje (${checkoutsCount}):*`,
      fmtCheckouts.join('\n'),
      ``,
      `📊 *Total de hóspedes ativos hoje: ${totalAtivos}*`,
      `✅ Relatório gerado automaticamente.`,
    ].join('\n');

    // EMAIL BACKUP — disparado em paralelo (não bloqueia WhatsApp).
    // Cobre o gap da janela 24h Meta: anfitrião sem janela aberta no WhatsApp
    // ainda recebe o relatório completo no email.
    const emailRecipients = (DAILY_REPORT_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
    if (emailRecipients.length > 0) {
      const emailSubject = `🏨 TorresGuest — Relatório Diário ${today}`;
      sendDailyReportEmail(emailRecipients, emailSubject, freeTextMessage)
        .then(r => console.log('[dispatch] Email backup →', r.ok ? `✓ ${emailRecipients.length} recipients` : `✗ ${r.error}`))
        .catch(err => console.error('[dispatch] Email backup error:', err.message));
    }

    if (USE_TEMPLATE) {
      // Path HÍBRIDO — template Meta `daily_report_v1` (cobertura universal, funciona fora janela 24h)
      // + free-text logo em seguida (entrega formato visual rico só pra quem tem janela 24h aberta).
      // O template usa lista inline com ` · ` por restrição Meta (#132018: vars não podem ter \n).
      // O free-text pode usar \n livremente. Quem tem janela aberta recebe AMBOS — o último renderiza
      // melhor no chat (cada hóspede em sua linha). Quem não tem janela só recebe template.
      const buildVars = USE_V2 ? buildDailyReportV2Vars : buildDailyReportVars;
      const params = buildVars({
        today,
        checkinsHoje: fmtCheckins,
        emEstadia: fmtEstadia,
        checkoutsHoje: fmtCheckouts,
        totalAtivos,
      });
      const tmplResults = [];
      const freeResults = [];
      for (const num of numbers) {
        const tr = await sendDailyReportTemplate(num, params);
        tmplResults.push({ num, ok: !!tr.ok, msgId: tr.messageId, err: tr.error?.error?.message || tr.error });
        // Free-text complementar — só faz sentido pro path v1 (que envia template com
        // formato `·` inline). v2 já entrega cada hóspede numa linha, free-text seria
        // duplicação visual no chat de quem tem janela 24h aberta. Decisão Valney 04/05.
        if (!USE_V2) {
          try {
            const fr = await sendWhatsAppText(num, freeTextMessage);
            freeResults.push({ num, ok: !!fr?.ok, msgId: fr?.messageId });
          } catch (e) {
            freeResults.push({ num, ok: false, err: e.message });
          }
        }
      }
      console.log('[dispatch] Relatório diário (template) → ', tmplResults);
      if (!USE_V2) {
        console.log('[dispatch] Relatório diário (free-text complementar) → ', freeResults);
      } else {
        console.log('[dispatch] v2 ativo — free-text complementar SKIPADO (template já entrega linha-por-linha)');
      }
    } else {
      // Path LEGADO — só free-text (rollback emergencial via WA_DAILY_REPORT_USE_TEMPLATE=false).
      // Só entrega pra números com janela 24h aberta — usar com cuidado.
      for (const num of numbers) {
        await sendWhatsAppText(num, freeTextMessage);
      }
      console.log('[dispatch] Relatório diário (free-text legado) enviado para', numbers);
    }
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

/**
 * Relay the guest's cancellation reason to the host's DISPATCH_NUMBER so they
 * can decide (manually) whether to reach out, offer something, or just track
 * the motive for future pricing/listing decisions. Called from the WhatsApp
 * handler right after recording the reason text.
 */
async function sendCancellationReasonToHost({ guestName, staysId, ota, reason, phone }) {
  try {
    const mensagem = [
      `📊 *Motivo de cancelamento — ${ota || 'reserva'}*`,
      ``,
      `👤 Hóspede: *${guestName || 'não identificado'}*`,
      `🏷 Reserva: ${staysId || '—'}`,
      `📱 Telefone: +${phone || '—'}`,
      ``,
      `💬 Resposta do hóspede:`,
      `"${(reason || '').slice(0, 500)}"`,
      ``,
      `💡 Decida se quer ligar / oferecer algo — nenhuma ação automática foi disparada.`,
    ].join('\n');
    const numbers = DISPATCH_NUMBER.split(',').map(n => n.trim()).filter(Boolean);
    for (const num of numbers) {
      await sendWhatsAppText(num, mensagem);
    }
    console.log('[dispatch] Cancellation reason sent to', numbers);
  } catch (err) {
    console.error('[dispatch] sendCancellationReasonToHost failed:', err.message);
  }
}

module.exports = {
  dailyCheckinDispatch,
  sendEscalationAlert,
  sendFrigobarRestockNotification,
  sendTransferAlert,
  sendRoomRequestNotification,
  sendCancellationReasonToHost,
};
