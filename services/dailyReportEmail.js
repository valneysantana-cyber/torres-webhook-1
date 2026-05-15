/**
 * services/dailyReportEmail.js — envia relatório diário por email como BACKUP
 * ao WhatsApp dispatch. Independente da janela 24h Meta — funciona 100%.
 *
 * Multi-tenant: cada tenant aponta seu próprio email no DB (campo notifyEmails).
 * Fallback: DAILY_REPORT_EMAILS env (csv) pra TorresGuest hardcoded.
 */
const nodemailer = require('nodemailer');
const { GMAIL_SMTP_USER, GMAIL_SMTP_PASSWORD } = require('../config');

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: GMAIL_SMTP_USER, pass: GMAIL_SMTP_PASSWORD },
    });
  }
  return transporter;
}

/**
 * Converte mensagem WhatsApp (com *bold* e emojis) em HTML bonito pra email.
 */
function whatsAppTextToHtml(text) {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // *bold* → <strong>bold</strong>
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');

  // Quebra linhas em <br> ou <li>
  const lines = html.split('\n');
  const out = [];
  let inList = false;
  for (const line of lines) {
    if (line.trim().startsWith('• ') || line.trim().startsWith(' • ')) {
      if (!inList) { out.push('<ul style="padding-left:18px;margin:6px 0">'); inList = true; }
      out.push(`<li style="margin:3px 0">${line.replace(/^\s*•\s*/, '')}</li>`);
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      if (line.trim() === '') out.push('<br>');
      else out.push(`<div style="margin:4px 0">${line}</div>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

/**
 * Envia o relatório diário por email.
 *
 * @param {string[]} recipients  emails (csv ou array)
 * @param {string}   subject     ex: "🏨 TorresGuest — Relatório Diário 15/05/2026"
 * @param {string}   whatsappText  msg formato WhatsApp (mesma que vai via free-text)
 * @returns {Promise<{ok: boolean, messageId?: string, error?: string}>}
 */
async function sendDailyReportEmail(recipients, subject, whatsappText) {
  if (!GMAIL_SMTP_USER || !GMAIL_SMTP_PASSWORD) {
    console.warn('[dailyReportEmail] SMTP creds missing — skipping email backup');
    return { ok: false, error: 'smtp_creds_missing' };
  }
  if (!recipients || (Array.isArray(recipients) && recipients.length === 0)) {
    console.warn('[dailyReportEmail] no recipients — skipping');
    return { ok: false, error: 'no_recipients' };
  }
  const to = Array.isArray(recipients) ? recipients.join(', ') : recipients;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:'Segoe UI',Inter,Arial,sans-serif;color:#1f2937;max-width:640px;margin:0 auto;padding:20px;background:#f9fafb">
  <div style="background:#fff;border-radius:12px;padding:28px;border-top:4px solid #F0A500;box-shadow:0 2px 8px rgba(0,0,0,.06)">
    ${whatsAppTextToHtml(whatsappText)}
  </div>
  <div style="margin-top:16px;color:#6b7280;font-size:.82rem;text-align:center">
    Backup automático do dispatch WhatsApp · ConciergeCloud<br>
    Não responda a este email — atendimento via WhatsApp.
  </div>
</body></html>`;

  try {
    const info = await getTransporter().sendMail({
      from: `"ConciergeCloud" <${GMAIL_SMTP_USER}>`,
      to,
      subject,
      text: whatsappText,
      html,
    });
    console.log(`[dailyReportEmail] sent to ${to} · msgId=${info.messageId}`);
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error('[dailyReportEmail] send error:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendDailyReportEmail };
