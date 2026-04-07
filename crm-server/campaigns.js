'use strict';

const https = require('https');
const http  = require('http');

// ---- env vars ---------------------------------------------------------------
const RENDER_WEBHOOK_URL = process.env.RENDER_WEBHOOK_URL || 'https://torres-webhook-1.onrender.com';
const DISPATCH_SECRET    = process.env.DISPATCH_SECRET    || '';

// ---- campaign messages ------------------------------------------------------
function msgPostCheckout(name) {
    return `Ola, ${name}! Foi um prazer ter voce como hospede no TorresGuest. Esperamos que sua estadia tenha sido incrivel. Ficamos a disposicao para quando quiser voltar -- e pode contar com condicoes especiais para hospedes frequentes!`;
}

function msgBirthday(name) {
    return `Feliz Aniversario, ${name}! O time do TorresGuest deseja a voce um dia cheio de alegrias. Para celebrar, temos uma surpresa especial esperando por voce na sua proxima visita. Venha comemorar com a gente!`;
}

function msgNoVisit(name) {
    return `Ola, ${name}! Sentimos a sua falta por aqui no TorresGuest. Ja faz um tempo desde sua ultima visita e gostariamos de te convidar para voltar. Temos disponibilidade especial e condicoes exclusivas para hospedes como voce. Vamos agendar?`;
}

function msgStayAnniversary(name, years) {
    const periodo = years === 1 ? '1 ano' : years + ' anos';
  return `Ola, ${name}! Hoje faz exatamente ${periodo} desde a sua primeira estadia no TorresGuest. Que memoria especial! Obrigado por fazer parte da nossa historia. Aguardamos voce com muito carinho para uma nova visita em breve.`;
}

// ---- deduplication ----------------------------------------------------------
function alreadySent(guest, type) {
  if (!Array.isArray(guest.campaignsSent)) return false;
  // Cooldown: no_visit_3m=90d, post_checkout/birthday/stay_anniversary=365d
  const cooldownDays = { 'no_visit_3m': 90, 'post_checkout': 365, 'birthday': 365, 'stay_anniversary': 365 };
  const days = cooldownDays[type] || 90;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return guest.campaignsSent.some(function(c) { return c.type === type && c.date >= cutoff; });
}

async function markSent(db, phone, type) {
  const today = new Date().toISOString().slice(0, 10);
  await db.collection('guests').updateOne(
    { phone },
    { $push: { campaignsSent: { type, date: today } } }
      );
}

// ---- HTTP helper ------------------------------------------------------------
function sendCampaignHttp(to, message) {
    return new Promise(function(resolve, reject) {
          const url  = new URL('/internal/send-campaign', RENDER_WEBHOOK_URL);
          const body = JSON.stringify({ to, message });
    const isHttps = url.protocol === 'https:';
    const lib  = isHttps ? https : http;
    const options = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname,
      method:   'POST',
      headers: {
        'Content-Type':     'application/json',
        'Content-Length':   Buffer.byteLength(body),
        'x-dispatch-secret': DISPATCH_SECRET,
},
};
    const req = lib.request(options, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end',  function() { resolve({ status: res.statusCode, body: data }); });
});
    req.on('error', reject);
    req.write(body);
    req.end();
});
}

async function sendCampaign(db, phone, type, message) {
  try {
    const result = await sendCampaignHttp(phone, message);
    console.log('[campaign] ' + type + ' -> ' + phone + ' -- HTTP ' + result.status);
    await markSent(db, phone, type);
} catch (err) {
    console.error('[campaign] Erro ao enviar ' + type + ' para ' + phone + ':', err.message);
}
}

// ---- triggers ---------------------------------------------------------------
async function runPostCheckout(db) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yd = yesterday.toISOString().slice(0, 10);
  const guests = await db.collection('guests').find({ lastCheckout: { $regex: '^' + yd } }).toArray();
  for (const guest of guests) {
    if (!guest.phone) continue;
    if (alreadySent(guest, 'post_checkout')) continue;
    await sendCampaign(db, guest.phone, 'post_checkout', msgPostCheckout(guest.name || 'hospede'));
}
  console.log('[campaign] post_checkout: ' + guests.length + ' candidatos verificados');
}

async function runBirthday(db) {
  const today = new Date();
  const mmdd  = String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const guests = await db.collection('guests').find({ birthday: { $regex: mmdd } }).toArray();
  for (const guest of guests) {
    if (!guest.phone) continue;
    if (alreadySent(guest, 'birthday')) continue;
    await sendCampaign(db, guest.phone, 'birthday', msgBirthday(guest.name || 'hospede'));
}
  console.log('[campaign] birthday: ' + guests.length + ' candidatos verificados');
}

async function runNoVisit(db) {
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - 3);
  const cutoff = cutoffDate.toISOString().slice(0, 10);
  const guests = await db.collection('guests').find({
    lastCheckout: { $lte: cutoff },
    totalStays:   { $gte: 1 },
}).toArray();
  for (const guest of guests) {
    if (!guest.phone) continue;
    if (alreadySent(guest, 'no_visit_3m')) continue;
    await sendCampaign(db, guest.phone, 'no_visit_3m', msgNoVisit(guest.name || 'hospede'));
}
  console.log('[campaign] no_visit_3m: ' + guests.length + ' candidatos verificados');
}

async function runStayAnniversary(db) {
  const today = new Date();
  const mmdd  = '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const guests = await db.collection('guests').find({
    firstStayDate: { $regex: mmdd + '$' },
    totalStays:    { $gte: 1 },
}).toArray();
  for (const guest of guests) {
    if (!guest.phone || !guest.firstStayDate) continue;
    if (alreadySent(guest, 'stay_anniversary')) continue;
    const years = today.getFullYear() - parseInt(guest.firstStayDate.slice(0, 4), 10);
    if (years < 1) continue;
    await sendCampaign(db, guest.phone, 'stay_anniversary', msgStayAnniversary(guest.name || 'hospede', years));
}
  console.log('[campaign] stay_anniversary: ' + guests.length + ' candidatos verificados');
}

// ---- main entry point -------------------------------------------------------
async function dailyCampaignRun(db) {
  console.log('[campaign] Iniciando execucao diaria de campanhas...');
  try {
    await runPostCheckout(db);
    await runBirthday(db);
    await runNoVisit(db);
    await runStayAnniversary(db);
    console.log('[campaign] Execucao diaria concluida.');
} catch (err) {
    console.error('[campaign] Erro na execucao diaria:', err);
}
}

module.exports = { dailyCampaignRun };
