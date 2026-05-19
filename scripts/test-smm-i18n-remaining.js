'use strict';

/**
 * Smoke test — verifica i18n nas 9 replies que estavam PT-only após PR #112.
 * Roda local sem .env (warnings de boot são esperados, não bug de prod).
 *
 * Cobertura: PRE_CHECKIN_WHO_CAN, PARKING, FRIGOBAR_PIX, FOOD_ORDER,
 * THANKS, MENU, GREETING, CURRENT_DATE, CURRENT_TIME.
 */

const { classifyAndRespond } = require('../services/smmClassifier');
const {
  getResponseForTenant,
  getGreetingResponse,
  getCurrentDateResponse,
  getCurrentTimeResponse,
} = require('../responses/strings');

const HUMAN_NUMBER_SECONDARY = require('../config').HUMAN_NUMBER_SECONDARY;

let pass = 0;
let fail = 0;

function check(label, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
  }
}

async function main() {
  console.log('\n=== I18N entries diretas (getResponseForTenant) ===');
  const langs = ['en', 'es', 'fr'];
  const keys = ['PRE_CHECKIN_WHO_CAN', 'PARKING', 'FRIGOBAR_PIX', 'FOOD_ORDER', 'THANKS', 'MENU'];

  for (const key of keys) {
    for (const lang of langs) {
      const r = getResponseForTenant(key, lang, null);
      check(`${key}/${lang} returns string`, typeof r === 'string' && r.length > 10, r);
    }
  }

  console.log('\n=== Helpers dinâmicos ===');
  for (const lang of langs) {
    const g = getGreetingResponse(lang, 'Maria');
    check(`getGreetingResponse(${lang}) inclui nome`, g.includes('Maria') && g.length > 20);
    const d = getCurrentDateResponse(lang, '19/05/2026');
    check(`getCurrentDateResponse(${lang}) inclui data`, d.includes('19/05/2026') && !/Hoje é/.test(d), d);
    const t = getCurrentTimeResponse(lang, '14:30');
    check(`getCurrentTimeResponse(${lang}) inclui horário`, t.includes('14:30') && !/Agora são/.test(t), t);
  }
  // PT mantém forma original (default).
  check('getCurrentDateResponse(pt) usa "Hoje é"',
    getCurrentDateResponse('pt', '19/05/2026') === 'Hoje é 19/05/2026.');
  check('getCurrentTimeResponse(pt) usa "horário de Brasília"',
    /horário de Brasília/.test(getCurrentTimeResponse('pt', '14:30')));

  console.log('\n=== E2E classifyAndRespond — matcher PT + lang forçado (idioma do hóspede) ===');
  // Os matchers TorresGuest são PT-first por design (palavras-chave em PT). O que
  // este teste prova: quando matcher casa, a RESPOSTA sai no idioma certo via
  // i18n. Auto-detect ou callerLang controla qual i18n entrega.

  // Caso 1: greeting EN forçado via callerLang
  const r1 = await classifyAndRespond({
    text: 'oi',
    channel: 'bookingcom',
    guestName: 'John',
    lang: 'en',
  });
  check('greeting (lang=en) → resposta EN (no "Olá")',
    !!r1.reply && /Hello/i.test(r1.reply) && r1.source === 'greeting',
    `source=${r1.source} reply="${(r1.reply || '').slice(0, 60)}..."`);

  // Caso 2: thanks FR forçado
  const r2 = await classifyAndRespond({
    text: 'obrigado',
    channel: 'bookingcom',
    lang: 'fr',
  });
  check('thanks (lang=fr) → "Je vous en prie"',
    !!r2.reply && /Je vous en prie/i.test(r2.reply) && r2.source === 'thanks',
    `source=${r2.source} reply="${(r2.reply || '').slice(0, 60)}..."`);

  // Caso 3: menu ES forçado
  const r3 = await classifyAndRespond({
    text: 'menu',
    channel: 'bookingcom',
    lang: 'es',
  });
  check('menu (lang=es) → "¡Hola!" + "Wi-Fi"',
    !!r3.reply && /Hola/i.test(r3.reply) && r3.source === 'menu',
    `source=${r3.source}`);

  // Caso 4: parking EN forçado
  const r4 = await classifyAndRespond({
    text: 'estacionamento',
    channel: 'bookingcom',
    lang: 'en',
  });
  check('parking (lang=en) → resposta EN',
    !!r4.reply && r4.source === 'matcher:parking' && /valet service/i.test(r4.reply),
    `source=${r4.source} reply="${(r4.reply || '').slice(0, 80)}..."`);

  // Caso 5: PRE_CHECKIN_WHO_CAN EN forçado (input PT real Sofia 13/05)
  const r5 = await classifyAndRespond({
    text: 'meu marido pode fazer o pre-checkin?',
    channel: 'bookingcom',
    lang: 'en',
  });
  check('pre_checkin_who_can (lang=en) → resposta EN',
    !!r5.reply && r5.source === 'matcher:pre_checkin_who_can' && /Yes, any holder/i.test(r5.reply),
    `source=${r5.source} reply="${(r5.reply || '').slice(0, 80)}..."`);

  // Caso 6: frigobar PIX FR forçado
  const r6 = await classifyAndRespond({
    text: 'qual o pix do frigobar?',
    channel: 'bookingcom',
    lang: 'fr',
  });
  check('frigobar_pix (lang=fr) → "Menu — Minibar"',
    !!r6.reply && r6.source === 'matcher:frigobar_pix' && /CNPJ/i.test(r6.reply) && /Eau/i.test(r6.reply),
    `source=${r6.source} reply="${(r6.reply || '').slice(0, 80)}..."`);

  // Caso 7: food_order ES forçado. Texto PT puro sem palavras compartilhadas
  // pra evitar falso-positive do detectLanguage (ex: "no" PT vs "no" EN).
  const r7 = await classifyAndRespond({
    text: 'preciso de cardapio',
    channel: 'bookingcom',
    lang: 'es',
  });
  check('food_order (lang=es) → resposta ES',
    !!r7.reply && r7.source === 'matcher:food_order' && /Para pedir/i.test(r7.reply),
    `source=${r7.source} reply="${(r7.reply || '').slice(0, 80)}..."`);

  // Caso 8: current_date EN forçado
  const r8 = await classifyAndRespond({
    text: 'que dia e hoje',
    channel: 'bookingcom',
    lang: 'en',
  });
  check('current_date (lang=en) → "Today is"',
    !!r8.reply && r8.source === 'matcher:current_date' && /Today is/i.test(r8.reply),
    `source=${r8.source} reply="${(r8.reply || '').slice(0, 60)}..."`);

  // Caso 9: current_time FR forçado
  const r9 = await classifyAndRespond({
    text: 'que horas sao',
    channel: 'bookingcom',
    lang: 'fr',
  });
  check('current_time (lang=fr) → "Il est maintenant"',
    !!r9.reply && r9.source === 'matcher:current_time' && /Il est maintenant/i.test(r9.reply),
    `source=${r9.source} reply="${(r9.reply || '').slice(0, 60)}..."`);

  // Caso 10: auto-detect — texto puro EN com sinais → resposta EN
  const r10 = await classifyAndRespond({
    text: 'I would like the menu please',
    channel: 'bookingcom',
  });
  check('auto-detect EN no menu → resposta EN',
    !!r10.reply && r10.source === 'menu' && /Hello!/i.test(r10.reply),
    `source=${r10.source} reply="${(r10.reply || '').slice(0, 60)}..."`);

  // Caso 11: LV01J real (do PR #112) ainda funciona pós-refactor
  const r11 = await classifyAndRespond({
    text: "Hello, I'd like to request an invoice be sent to my email when I check out.",
    channel: 'bookingcom',
    guestName: 'Thais',
  });
  check('LV01J real (regressão PR #112) → matcher:invoice EN',
    !!r11.reply && r11.source === 'matcher:invoice' && !/\bnota fiscal\b/i.test(r11.reply),
    `source=${r11.source} reply="${(r11.reply || '').slice(0, 80)}..."`);

  console.log(`\n=== ${pass} pass / ${fail} fail ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
