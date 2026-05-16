'use strict';

process.env.TZ = 'America/Sao_Paulo';

module.exports = {
  VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN || 'torres-webhook-2026',
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
  PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  PORT: Number(process.env.PORT) || 8000,

  STAYS_BASE_URL: process.env.STAYS_API_BASE_URL || 'https://valney.stays.net/external/v1',
  STAYS_USERNAME: process.env.STAYS_API_LOGIN || process.env.STAYS_API_USER,
  STAYS_PASSWORD: process.env.STAYS_API_PASSWORD || process.env.STAYS_API_PASS,

  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_TRANSCRIBE_MODEL: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
  OPENAI_TTS_MODEL: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
  OPENAI_TTS_VOICE: process.env.OPENAI_TTS_VOICE || 'alloy',
  OPENAI_CHAT_MODEL: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',

  HUMAN_NUMBER_PRIMARY: '+55 11 99907-3135',
  HUMAN_NUMBER_SECONDARY: '+55 13 99615-5505',
  CONFIRMATION_TTL_MS: 10 * 60 * 1000,

  DISPATCH_NUMBER: process.env.DISPATCH_NUMBER || '5511999073135',
  DAILY_REPORT_EMAILS: process.env.DAILY_REPORT_EMAILS || 'valney@conciergecloud.com.br',

  DISPATCH_SECRET: process.env.DISPATCH_SECRET || null,

  CRM_API_URL: process.env.CRM_API_URL || null,
  CRM_API_KEY: process.env.CRM_API_KEY || null,

  IG_ACCESS_TOKEN: process.env.IG_ACCESS_TOKEN,
  IG_APP_ID: process.env.IG_APP_ID || '1667526337778117',
  IG_APP_SECRET: process.env.IG_APP_SECRET,
  IG_BUSINESS_ACCOUNT_ID: process.env.IG_BUSINESS_ACCOUNT_ID || '26082124804742800',

  FB_PAGE_ACCESS_TOKEN: process.env.FB_PAGE_ACCESS_TOKEN,
  FB_PAGE_ID: process.env.FB_PAGE_ID,

  // ---- Email Integration (IMAP/SMTP) ----------------------------------------
  GMAIL_IMAP_USER: process.env.GMAIL_IMAP_USER || '',
  GMAIL_IMAP_PASSWORD: process.env.GMAIL_IMAP_PASSWORD || '',
  GMAIL_SMTP_USER: process.env.GMAIL_SMTP_USER || '',
  GMAIL_SMTP_PASSWORD: process.env.GMAIL_SMTP_PASSWORD || '',
  EMAIL_MONITOR_ENABLED: process.env.EMAIL_MONITOR_ENABLED || 'false',
  EMAIL_AUTO_REPLY: process.env.EMAIL_AUTO_REPLY || 'false',

  // ---- MongoDB + Reservation Integration ------------------------------------
  MONGODB_URI: process.env.MONGODB_URI || '',
  WHATSAPP_GUEST_REPLY: process.env.WHATSAPP_GUEST_REPLY || 'true',
  // Pipeline IMAP → OTA guest message handling: desativado por padrão 12/05/2026
  // após SMM (Central de Mensagens Stays) assumir o papel de responder no canal
  // de origem (Booking/Airbnb/Expedia). Pipeline IMAP continua processando
  // notificações de NOVA RESERVA (route 1 — Stays.net) pra disparar pré-checkin.
  // Setar OTA_GUEST_MESSAGE_DISABLED=false pra reativar o caminho legacy.
  OTA_GUEST_MESSAGE_DISABLED: process.env.OTA_GUEST_MESSAGE_DISABLED || 'true',
};

// ─── S8 fix 16/05/2026 — boot-time assertion crítico ───
// Sem CRM_API_URL/CRM_API_KEY o bot não resolve tenant via fetchTenantById
// (services/tenant.js:34, :208 fazem early-return null silencioso).
// Sintoma observado em prod: hóspedes legítimos caíam em cc_sales (tenant
// prospect) e o bot virava "vendedor B2B" no meio do atendimento.
// Documentado em `feedback_crm_api_url_required.md`. Agora fail-fast no boot
// em ambientes não-locais.
(function assertCriticalEnv() {
  const missing = [];
  if (!process.env.CRM_API_URL) missing.push('CRM_API_URL');
  if (!process.env.CRM_API_KEY) missing.push('CRM_API_KEY');
  if (missing.length === 0) {
    console.log('[boot] ✅ CRM_API_URL/CRM_API_KEY configurados');
    return;
  }
  const isProd = process.env.NODE_ENV === 'production'
              || !!process.env.RENDER
              || !!process.env.RENDER_SERVICE_ID;
  const msg = '[boot] ⚠️  ENV CRÍTICAS AUSENTES: ' + missing.join(', ')
            + ' — tenant resolution vai falhar silenciosamente → hóspedes caem em cc_sales.';
  if (isProd) {
    console.error(msg);
    console.error('[boot] FATAL em produção. Setando essas envs no Render é mandatório. Exiting.');
    process.exit(1);
  } else {
    console.warn(msg + ' (dev/local — não abortando)');
  }
})();
