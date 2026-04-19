
  // INSTAGRAM_ACCESS_TOKEN: process.env.INSTAGRAM_ACCESS_TOKEN,

  // ---- Email Integration (IMAP/SMTP) ----------------------------------------
  GMAIL_IMAP_USER:           process.env.GMAIL_IMAP_USER      || '',
  GMAIL_IMAP_PASSWORD:       process.env.GMAIL_IMAP_PASSWORD   || '',
  GMAIL_SMTP_USER:           process.env.GMAIL_SMTP_USER       || '',
  GMAIL_SMTP_PASSWORD:       process.env.GMAIL_SMTP_PASSWORD   || '',
  EMAIL_MONITOR_ENABLED:     process.env.EMAIL_MONITOR_ENABLED || 'false',
  EMAIL_AUTO_REPLY:          process.env.EMAIL_AUTO_REPLY      || 'false',
};
'use strict';

process.env.TZ = 'America/Sao_Paulo';

module.exports = {
  VERIFY_TOKEN:              process.env.WHATSAPP_VERIFY_TOKEN || 'torres-webhook-2026',
  WHATSAPP_TOKEN:            process.env.WHATSAPP_TOKEN,
  PHONE_NUMBER_ID:           process.env.WHATSAPP_PHONE_NUMBER_ID,
  PORT:                      Number(process.env.PORT) || 8000,

  STAYS_BASE_URL:            process.env.STAYS_API_BASE_URL || 'https://valney.stays.net/external/v1',
  STAYS_USERNAME:            process.env.STAYS_API_LOGIN || process.env.STAYS_API_USER,
  STAYS_PASSWORD:            process.env.STAYS_API_PASSWORD || process.env.STAYS_API_PASS,

  OPENAI_API_KEY:            process.env.OPENAI_API_KEY,
  OPENAI_TRANSCRIBE_MODEL:   process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
  OPENAI_TTS_MODEL:          process.env.OPENAI_TTS_MODEL       || 'gpt-4o-mini-tts',
  OPENAI_TTS_VOICE:          process.env.OPENAI_TTS_VOICE       || 'alloy',
  OPENAI_CHAT_MODEL:         process.env.OPENAI_CHAT_MODEL      || 'gpt-4o-mini',

  HUMAN_NUMBER_PRIMARY:      '+55 11 99907-3135',
  HUMAN_NUMBER_SECONDARY:    '+55 13 99615-5505',
  CONFIRMATION_TTL_MS:       10 * 60 * 1000,

  // Números que recebem o relatório diário (separados por vírgula na env var)
  DISPATCH_NUMBER:           process.env.DISPATCH_NUMBER || '5511999073135',

  // Secret token to protect POST /internal/dispatch
  DISPATCH_SECRET:           process.env.DISPATCH_SECRET || null,

  // TorresGuest CRM API (Fase 1) — VPS endpoint
  CRM_API_URL:               process.env.CRM_API_URL  || null,
  CRM_API_KEY:               process.env.CRM_API_KEY  || null,

  // ---- Instagram (Fase 4) --------------------------------------------------
  // Token de acesso gerado via Instagram Business Login (portal.meta.com)
  // Troque por token de longa duração (60 dias) via exchangeForLongLivedToken()
  IG_ACCESS_TOKEN:           process.env.IG_ACCESS_TOKEN,
  IG_APP_ID:                 process.env.IG_APP_ID            || '1667526337778117',
  IG_APP_SECRET:             process.env.IG_APP_SECRET,
  IG_BUSINESS_ACCOUNT_ID:   process.env.IG_BUSINESS_ACCOUNT_ID || '26082124804742800',

  // ---- Facebook Page (Fase 4) ----------------------------------------------
  // Page Access Token: Meta Business Suite → Configurações → Contas → Páginas
  FB_PAGE_ACCESS_TOKEN:      process.env.FB_PAGE_ACCESS_TOKEN,
  FB_PAGE_ID:                process.env.FB_PAGE_ID,
};
