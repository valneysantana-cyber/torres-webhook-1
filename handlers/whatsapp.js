'use strict';

const { CONFIRMATION_TTL_MS } = require('../config');
const {
  MENU_RESPONSE,
  HUMAN_ESCALATION_RESPONSE,
  CONFIRMATION_PROMPT,
  WIFI_RESPONSE,
  BREAKFAST_RESPONSE,
  POOL_RESPONSE,
  PARKING_RESPONSE,
  SNACKS_RESPONSE,
  TOWELS_RESPONSE,
  RESTAURANT_RESPONSE,
  CHECKIN_RESPONSE,
  SECURITY_RESPONSE,
  TRANSFER_RESPONSE,
  LONG_STAY_RESPONSE,
  CLEANING_RESPONSE,
  INTERNET_RESPONSE,
  LUGGAGE_RESPONSE,
  GREETING_RESPONSE,
  THANKS_RESPONSE,
  RESERVATION_NOT_FOUND,
  getReservationResponse,
  FRIGOBAR_PIX_RESPONSE,
  FRIGOBAR_RESTOCK_RESPONSE,
} = require('../responses/strings');
const { getFaqResponse } = require('../responses/faq');
const {
  normalizeText,
  getCurrentDateBRT,
  getCurrentTimeBRT,
  formatReservationMessage,
} = require('../utils/formatters');
const {
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
  shouldSendFrigobarPix,
  shouldRequestFrigobarRestock,
} = require('../utils/matchers');
const { fetchReservationByCode } = require('../services/stays');
const { getChatGptFallbackReply, transcribeAudioBuffer } = require('../services/openai');
const { getTenantByPhoneId, resolveTenantByGuestPhone } = require('../services/tenant');
const { downloadWhatsAppMedia, replyToGuest, markReadAndTyping, sendWelcomeKit, sendWhatsAppText } = require('../services/whatsapp');
const windowGuard = require('../services/windowGuard');
const { saveMessage, getContext, getProfile, updateProfile } = require('../services/crm');
const { classifyMessage } = require('../services/classifier');
const {
  sendEscalationAlert,
  sendFrigobarRestockNotification,
  sendTransferAlert,
  sendRoomRequestNotification,
  sendCancellationReasonToHost,
} = require('../services/dispatch');
let Reservation;
try { Reservation = require('../models/Reservation'); }
catch (e) { console.warn('[whatsapp] Reservation model not available:', e.message); }

// ───────────────────────────────────────────────────────────────────────────────
// Pending confirmation state (in-memory, per process)
// ───────────────────────────────────────────────────────────────────────────────
const pendingConfirmations = new Map();

function cleanupPendingConfirmations() {
  const now = Date.now();
  for (const [key, ts] of pendingConfirmations.entries()) {
    if (now - ts > CONFIRMATION_TTL_MS) pendingConfirmations.delete(key);
  }
}

function rememberPendingConfirmation(phone) {
  pendingConfirmations.set(phone, Date.now());
}

function isAwaitingCode(phone) {
  cleanupPendingConfirmations();
  return pendingConfirmations.has(phone);
}

// ───────────────────────────────────────────────────────────────────────────────
// Helper: responde ao hóspede E salva no CRM de uma vez (Fase 1 — memória completa)
// ───────────────────────────────────────────────────────────────────────────────
async function replyAndSave(from, text, opts = {}) {
  await replyToGuest(from, text, opts);
  saveMessage(from, 'assistant', text).catch(() => {});
  // Fire-and-forget: if this guest has a welcome kit pending (Meta 24h window
  // was closed when the check-in template fired), deliver it now — the inbound
  // msg that triggered this reply just opened the window.
  maybeDeliverDelayedWelcomeKit(from).catch(err =>
    console.error('[welcome-kit][delayed] dispatch failed:', err.message)
  );
}

/**
 * Idempotent: finds a reservation whose welcome kit is still pending within
 * the 48h window, sends it, and flips the pending flag. Safe to call after
 * every outbound reply — O(1) Mongo lookup + early return when nothing pending.
 */
async function maybeDeliverDelayedWelcomeKit(from) {
  if (!Reservation) return;
  const pending = await Reservation.findPendingWelcomeKitByPhone(from);
  if (!pending) return;

  // Atomic claim: only the request that flips welcomeKitPending false wins.
  // Prevents double-send if multiple replies fire in the same tick.
  // Use the Mongoose model (not .collection) so the return shape is stable
  // across driver versions — native driver v5+ returns the doc directly,
  // v4- wraps in { value: doc }. Mongoose.findOneAndUpdate always returns
  // the doc or null, which is what we want.
  const claimedDoc = await Reservation.findOneAndUpdate(
    { _id: pending._id, welcomeKitPending: true },
    { $set: { welcomeKitPending: false } },
    { new: true }
  );
  if (!claimedDoc) return; // someone else grabbed it, or no match

  const ctx = claimedDoc.welcomeKitContext || pending.welcomeKitContext || {};
  console.log(`[welcome-kit][delayed] sending to ${from} (reservation ${pending.staysReservationId})`);
  // Brief delay so welcome kit doesn't crowd the bot's reply to the guest.
  await new Promise(res => setTimeout(res, 1200));
  const r = await sendWelcomeKit(from, ctx);
  if (r.ok) {
    await Reservation.updateOne({ _id: pending._id }, { $set: { welcomeKitSentAt: new Date() } });
    console.log(`[welcome-kit][delayed] OK messageId=${r.messageId}`);
  } else if (!r.skipped) {
    // Failure → release claim so next inbound msg retries
    await Reservation.updateOne({ _id: pending._id }, { $set: { welcomeKitPending: true } });
    console.error('[welcome-kit][delayed] FAIL, released claim:', JSON.stringify(r.error).slice(0, 300));
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// PT_DISPATCH
//
// Cada entrada pode ter um campo opcional `notify` — uma função async(from, body)
// que dispara uma notificação para a operação sem bloquear a resposta ao hóspede.
//
// Ajustes 2026-04-09:
//  - shouldSendTransfer: agora aciona sendTransferAlert (táxi/Robson)
//  - shouldSendTowels: agora aciona sendRoomRequestNotification
//  - shouldSendCleaning: agora aciona sendRoomRequestNotification
//  - shouldSendSnacks: agora aciona sendRoomRequestNotification
// ───────────────────────────────────────────────────────────────────────────────
const PT_DISPATCH = [
  { check: shouldSendWifi,        reply: () => WIFI_RESPONSE },
  { check: shouldSendBreakfast,   reply: () => BREAKFAST_RESPONSE },
  { check: shouldSendPool,        reply: () => POOL_RESPONSE },
  { check: shouldSendParking,     reply: () => PARKING_RESPONSE },
  {
    check: shouldSendSnacks,
    reply: () => SNACKS_RESPONSE,
    notify: (from, body) => sendRoomRequestNotification(from, body, 'Snacks / Conveniência'),
  },
  {
    check: shouldSendTowels,
    reply: () => TOWELS_RESPONSE,
    notify: (from, body) => sendRoomRequestNotification(from, body, 'Toalhas'),
  },
  { check: shouldSendRestaurant,  reply: () => RESTAURANT_RESPONSE },
  { check: shouldSendCheckin,     reply: () => CHECKIN_RESPONSE },
  { check: shouldSendSecurity,    reply: () => SECURITY_RESPONSE },
  {
    check: shouldSendTransfer,
    reply: () => TRANSFER_RESPONSE,
    notify: (from, body) => sendTransferAlert(from, body),
  },
  { check: shouldSendLocation,    reply: (lang) => getLocationResponse(lang) },
  { check: shouldSendLongStay,    reply: () => LONG_STAY_RESPONSE },
  {
    check: shouldSendCleaning,
    reply: () => CLEANING_RESPONSE,
    notify: (from, body) => sendRoomRequestNotification(from, body, 'Limpeza / Governança'),
  },
  { check: shouldSendInternet,    reply: () => INTERNET_RESPONSE },
  { check: shouldSendLuggage,     reply: () => LUGGAGE_RESPONSE },
  { check: shouldSendCurrentDate, reply: () => `Hoje e ${getCurrentDateBRT()}.` },
  { check: shouldSendCurrentTime, reply: () => `Agora sao ${getCurrentTimeBRT()}, horario de Brasilia.` },
  { check: shouldSendHuman,       reply: () => HUMAN_ESCALATION_RESPONSE },
];

// ───────────────────────────────────────────────────────────────────────────────
// Reservation confirmation flow
// ───────────────────────────────────────────────────────────────────────────────
async function maybeHandleReservationConfirmation({ rawText, normalizedText, from, camFromAudio = false }) {
  const expectingCode = isAwaitingCode(from);
  const explicitlyWantsConfirm = shouldHandleReservationConfirmation(normalizedText);
  const code = extractReservationCode(rawText);
  const wantsConfirmation = explicitlyWantsConfirm || (expectingCode && !!code);

  if (!wantsConfirmation) {
    if (expectingCode) pendingConfirmations.delete(from);
    return false;
  }

  if (!code) {
    rememberPendingConfirmation(from);
    await replyAndSave(from, CONFIRMATION_PROMPT, { alsoSendAudio: camFromAudio });
    return true;
  }

  const reservation = await fetchReservationByCode(code);
  if (reservation) {
    pendingConfirmations.delete(from);
    await replyAndSave(from, formatReservationMessage(reservation), { alsoSendAudio: camFromAudio });
  } else {
    rememberPendingConfirmation(from);
    await replyAndSave(from, RESERVATION_NOT_FOUND(code), { alsoSendAudio: camFromAudio });
  }
  return true;
}

// ───────────────────────────────────────────────────────────────────────────────
// Main entry point
// ───────────────────────────────────────────────────────────────────────────────
async function handleIncoming(payload) {
  if (!payload?.entry) return;

  for (const entry of payload.entry) {
    for (const change of (entry.changes || [])) {
      if (change.field !== 'messages') continue;

      const value = change.value || {};
      const messages = value.messages || [];
      const contactName = value.contacts?.[0]?.profile?.name || '';

      // Multi-tenant: identifica tenant pelo phone_number_id (Meta WhatsApp Business)
      const phoneNumberId = value.metadata?.phone_number_id || null;
      const tenant = await getTenantByPhoneId(phoneNumberId);
      if (tenant && !tenant._isDefault) {
        console.log(`[tenant] ${phoneNumberId} -> ${tenant.tenantId} (${tenant.name})`);
      }

      for (const message of messages) {
        const from = message.from;
        if (!from) continue;

        // ── UX imediato: visto azul antes de processar ──
        markReadAndTyping(from, message.id).catch(() => {});

        // ── Window guard: drena pendentes (mensagens que não puderam ser
        //    enviadas antes por janela 24h fechada). Esta inbound abre a janela,
        //    então enviamos as pendentes ANTES de processar o turno atual.
        //    Tolerante a falha — não interrompe o fluxo se algo der errado.
        windowGuard.drainPending(from, (text) => sendWhatsAppText(from, text))
          .then((n) => { if (n > 0) console.log(`[wg] drained ${n} pending message(s) for ${from}`); })
          .catch((err) => console.error('[wg] drain bg error:', err.message));

        let camFromAudio = false;
        let body = '';

        // ---- resolve body ------------------------------------------------
        if (message.type === 'text') {
          body = message.text?.body || '';
        } else if (message.type === 'audio') {
          camFromAudio = true;
          try {
            const mediaId = message.audio?.id;
            if (!mediaId) {
              await replyAndSave(from, 'Recebi seu audio, mas nao consegui identificar o arquivo. Pode tentar novamente? 🌄', { alsoSendAudio: camFromAudio });
              continue;
            }
            const audioBuffer = await downloadWhatsAppMedia(mediaId);
            const transcript = await transcribeAudioBuffer(audioBuffer, message.audio?.mime_type || 'audio/ogg');
            if (!transcript) {
              await replyAndSave(from, 'Recebi seu audio, mas nao consegui entender bem. Pode me mandar novamente ou escrever por texto? 😊', { alsoSendAudio: camFromAudio });
              continue;
            }
            body = transcript;
            console.log('[audio transcript]', { from, transcript });
          } catch (err) {
            console.error('Failed to process audio message', err);
            await replyAndSave(from, 'Recebi seu audio, mas tive uma falha para processar agora. Pode tentar novamente ou me escrever por texto? 😊', { alsoSendAudio: camFromAudio });
            continue;
          }
        } else {
          continue; // ignorar tipos nao suportados
        }

        const normalized = normalizeText(body);
        const language = detectLanguage(body);
        console.log('[incoming]', { from, body, normalized, language });

        // ── Fase 1: salvar mensagem do usuário no CRM (fire-and-forget) ──
        saveMessage(from, 'user', body).catch(() => {});

        // ── Fase 2: salvar nome do WhatsApp no perfil (fire-and-forget) ──
        if (contactName) updateProfile(from, { name: contactName }).catch(() => {});

        // ---- cancellation retention: capture reason (HIGHEST PRIORITY) ---
        // Must run BEFORE the escalation classifier and any keyword handler
        // because the guest's reason often contains words like "reserva",
        // "cancel", "checkout", which are intercepted by other flows (e.g.
        // observed 24/04 with Carlos Frederico JI03J — classifier caught
        // "Reserva INFO" first and the reason was lost).
        //
        // If this phone has a reservation with cancellationReason='pending'
        // sent in the last 72h, the NEXT text they send IS the reason.
        if (Reservation && body && body.trim().length > 0) {
          try {
            const pending = await Reservation.findPendingRetentionByPhone(from);
            if (pending) {
              const reason = body.trim().slice(0, 500);
              const firstName = (pending.guestName || '').split(' ')[0] || 'Hospede';
              pending.cancellationReason = reason;
              pending.cancellationReasonReceivedAt = new Date();
              try { await pending.save(); } catch (e) { console.warn('[retention] save reason failed:', e.message); }

              console.log(`[retention] captured reason from ${firstName} (${from}) staysId=${pending.staysReservationId}`);
              await replyAndSave(
                from,
                `Muito obrigado, ${firstName}! 🙏\n\nSeu feedback chegou aqui e vai nos ajudar a melhorar. Se mudar de ideia ou quiser reservar outra data, é só me chamar. 💙`,
                { alsoSendAudio: camFromAudio }
              );

              // Fire-and-forget: dispatch para o host
              sendCancellationReasonToHost({
                guestName: pending.guestName,
                staysId: pending.staysReservationId,
                ota: pending.cancellationOta || 'reserva',
                reason,
                phone: from,
              }).then(async () => {
                pending.cancellationDispatchedToHostAt = new Date();
                try { await pending.save(); } catch (e) {}
              }).catch(err => console.error('[retention] dispatch to host failed:', err.message));

              continue;
            }
          } catch (e) {
            console.error('[retention] lookup failed (fallthrough to normal flow):', e.message);
          }
        }

        // ---- check-in template quick-reply (template v3+) ---------------
        // Hospede tocou "Fazer agora" / "Na recepção" no template OU digitou
        // afirmativa/negativa em janela 48h após template enviado.
        // Match na resposta liberada pelo Meta (exato OU sinônimos comuns).
        if (Reservation && body && body.trim().length > 0 && body.trim().length < 80) {
          const txt = body.trim().toLowerCase();
          const isYes = /^(fazer agora|sim|quero|agora|ok|claro|fazer|sim por favor|quero sim|fazer pré|fazer pre|pode mandar|manda|me manda)/.test(txt);
          const isNo = /^(na recepção|na recepcao|recepção|recepcao|depois|presencial|prefiro recep|na hora|chego e faço|não|nao|deixa pra la|deixa)/.test(txt);
          if (isYes || isNo) {
            try {
              const recent = await Reservation.findOne({
                guestPhoneClean: from,
                autoCheckinSentAt: { $gte: new Date(Date.now() - 48 * 3600 * 1000) },
              }).sort({ autoCheckinSentAt: -1 }).lean();
              if (recent && recent.staysReservationId) {
                const publicUrl = process.env.PUBLIC_URL || 'https://conciergecloud.com.br';
                if (isYes) {
                  const url = `${publicUrl}/checkin/${recent.staysReservationId}`;
                  await replyAndSave(from,
                    `Perfeito! 📲 Aqui está seu pré-check-in:\n\n${url}\n\nLeva 2 minutos. Seus dados são protegidos conforme a LGPD. 🔒`,
                    { alsoSendAudio: camFromAudio }
                  );
                } else {
                  await replyAndSave(from,
                    `Combinado! 🏨 Quando chegar, é só ir direto à recepção do hotel.\n\n📄 *Importante:* leve um documento oficial com foto (RG, CNH ou passaporte) — é exigido pra liberar seu cartão de acesso.\n\nRecepção 24h. Qualquer dúvida, me chama por aqui. 😊`,
                    { alsoSendAudio: camFromAudio }
                  );
                }
                console.log(`[checkin-reply] phone=${from} choice=${isYes?'yes':'no'} reservation=${recent.staysReservationId}`);
                continue;
              }
            } catch (e) {
              console.warn('[checkin-reply] lookup failed (fallthrough):', e.message);
            }
          }
        }

        // ---- escalation classifier (prioridade máxima p/ fluxo normal) --
        const escalation = classifyMessage(body);
        if (escalation) {
          console.log('[classifier] escalacao detectada:', escalation.name, escalation.level);
          await replyAndSave(from, escalation.guestReply, { alsoSendAudio: camFromAudio });
          if (!escalation.noAlert) await sendEscalationAlert(from, body, escalation);
          continue;
        }

        // ---- greeting ---------------------------------------------------
        // Pure greeting only (no '?'). Greeting+question falls through to the AI.
        const words = normalized.trim().split(/\s+/);
        const isJustGreeting = shouldSendGreeting(normalized) && !body.includes('?') && words.length <= 5;
        if (isJustGreeting) {
          await replyAndSave(from, GREETING_RESPONSE(contactName), { alsoSendAudio: camFromAudio });
          continue;
        }

        // ---- thanks -----------------------------------------------------
        if (shouldSendThanks(normalized)) {
          await replyAndSave(from, THANKS_RESPONSE, { alsoSendAudio: camFromAudio });
          continue;
        }

        // ---- menu -------------------------------------------------------
        if (shouldSendMenu(normalized)) {
          console.log('[menu] sending menu response');
          await replyAndSave(from, MENU_RESPONSE, { alsoSendAudio: camFromAudio });
          pendingConfirmations.delete(from);
          continue;
        }

        // ---- reservation confirmation flow ------------------------------
        if (await maybeHandleReservationConfirmation({ rawText: body, normalizedText: normalized, from, camFromAudio })) {
          continue;
        }

        // ---- reservation site redirect ----------------------------------
        if (
          shouldRedirectToReservationSite(normalized) ||
          /\b\d{1,2}[\/.-]\d{1,2}\b/.test(body) ||
          /\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/.test(body)
        ) {
          await replyAndSave(from, getReservationResponse(language), { alsoSendAudio: camFromAudio });
          continue;
        }

        // ---- frigobar: PIX de pagamento ---------------------------------
        // IMPORTANTE: sempre responder com PIX + lista de produtos.
        // NUNCA informar que o pagamento é feito no checkout da recepção.
        // O matcher foi expandido (2026-04-09) para capturar perguntas
        // genéricas como "como eu pago" / "preciso saber como pago".
        if (shouldSendFrigobarPix(normalized)) {
          await replyAndSave(from, FRIGOBAR_PIX_RESPONSE, { alsoSendAudio: camFromAudio });
          continue;
        }

        // ---- frigobar: reposição -> avisa governança --------------------
        if (shouldRequestFrigobarRestock(normalized)) {
          await replyAndSave(from, FRIGOBAR_RESTOCK_RESPONSE, { alsoSendAudio: camFromAudio });
          await sendFrigobarRestockNotification(from, body);
          continue;
        }

        // ---- PT_DISPATCH ------------------------------------------------
        // Para entradas com campo `notify`, dispara a notificação em paralelo
        // sem bloquear a resposta ao hóspede (fire-and-forget via .catch).
        if (language === 'pt') {
          const match = PT_DISPATCH.find(({ check }) => check(normalized));
          if (match) {
            const dispatchReply = match.reply(language);
            await replyAndSave(from, dispatchReply, { alsoSendAudio: camFromAudio });
            if (match.notify) match.notify(from, body).catch(() => {});
            continue;
          }
        }

        // ---- AI fallback (contexto + perfil de fidelidade) -------------
        // Shared-infra: resolve tenant dono da reserva ativa deste hóspede
        // (uma WABA atende N tenants; sem isso todos caem em torres).
        const guestTenant = await resolveTenantByGuestPhone(from, tenant);
        const [context, profile] = await Promise.all([getContext(from), getProfile(from)]);
        const aiReply = await getChatGptFallbackReply(body, from, context, profile, guestTenant);
        if (aiReply) {
          await replyAndSave(from, aiReply, { alsoSendAudio: camFromAudio });
          continue;
        }

        // ---- FAQ --------------------------------------------------------
        const faqResponse = getFaqResponse(normalized);
        if (faqResponse) {
          await replyAndSave(from, faqResponse, { alsoSendAudio: camFromAudio });
          continue;
        }

        // ---- fallback final ---------------------------------------------
        await replyAndSave(from, `${HUMAN_ESCALATION_RESPONSE}\n\nSe quiser voltar ao menu, e so digitar "menu".`, { alsoSendAudio: camFromAudio });
      }
    }
  }
}

module.exports = { handleIncoming };
