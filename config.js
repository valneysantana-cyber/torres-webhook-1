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
  OPENAI_TTS_MODEL:          process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
  OPENAI_TTS_VOICE:          process.env.OPENAI_TTS_VOICE || 'alloy',
  OPENAI_CHAT_MODEL:         process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
  HUMAN_NUMBER_PRIMARY:      '+55 11 99907-3135',
  HUMAN_NUMBER_SECONDARY:    '+55 13 99615-5505',
  CONFIRMATION_TTL_MS:       10 * 60 * 1000,
  // Números que recebem o relatório diário (separados por vírgula na env var)
  DISPATCH_NUMBER:           process.env.DISPATCH_NUMBER || '5511999073135',
  // Secret token to protect POST /internal/dispatch
  DISPATCH_SECRET:           process.env.DISPATCH_SECRET || null,
  // TorresGuest CRM API (Phase 1) — VPS endpoint
  CRM_API_URL:               process.env.CRM_API_URL || null,
  CRM_API_KEY:               process.env.CRM_API_KEY || null,
};
