process.env.CRM_API_URL = 'http://127.0.0.1:38771';
process.env.CRM_API_KEY = 'stub-key-nao-e-segredo';
process.env.OPENAI_API_KEY = '';           // garante que NAO ha IA: se cair na IA, reply=null
process.env.ANTHROPIC_API_KEY = '';
const http = require('http');
let MODE = 'notincl';
const srv = http.createServer((req, res) => {
  if (MODE === 'http500') { res.writeHead(500); return res.end('boom'); }
  const body = MODE === 'notincl' ? { known: true, breakfast: 'not_included', reason: 'booking:flag-semcafe' }
             : MODE === 'incl'    ? { known: true, breakfast: 'included',     reason: 'partner-sem-regra' }
             : { known: false, reason: 'reservation-not-found', escalate: true };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
});
(async () => {
  await new Promise(r => srv.listen(38771, '127.0.0.1', r));
  const { classifyAndRespond } = require('../services/smmClassifier');
  const torres = { tenantId: 'torres', settings: { breakfast: { enabled: true, type: 'conditional_by_reservation', hours: '06:30-10:00', location: 'restaurante do lobby do hotel', paidPricePerPerson: 45 }, knowledgeBase: 'kb qualquer' } };
  const outro  = { tenantId: 'glauco', settings: { breakfast: { enabled: true, type: 'included', hours: '07h às 10h', location: 'restaurante' }, knowledgeBase: 'kb' } };
  const casos = [
    ['notincl', 'torres PT — reserva SEM cafe (Calebe)', { text: 'bom dia, minha reserva tem cafe da manha?', tenant: torres, lang: 'pt', allowAi: true, reservationCode: 'QF04J', guestName: 'Calebe', channel: 'booking', bookingConfirmed: true }],
    ['notincl', 'torres PT — pergunta SEM a palavra "manha"', { text: 'o cafe esta incluso na diaria?', tenant: torres, lang: 'pt', allowAi: true, reservationCode: 'QF04J', channel: 'booking', bookingConfirmed: true }],
    ['notincl', 'torres ES — desayuno', { text: 'el desayuno esta incluido?', tenant: torres, lang: 'es', allowAi: true, reservationCode: 'QF04J', channel: 'booking', bookingConfirmed: true }],
    ['incl',    'torres PT — reserva COM cafe', { text: 'tem cafe da manha?', tenant: torres, lang: 'pt', allowAi: true, reservationCode: 'PF03J', channel: 'whatsapp', bookingConfirmed: true }],
    ['unknown', 'torres PT — reserva NAO identificada', { text: 'tem cafe da manha incluso?', tenant: torres, lang: 'pt', allowAi: true, guestName: 'Fulano Inexistente', channel: 'booking', bookingConfirmed: true }],
    ['http500', 'torres PT — CRM FORA DO AR (codigo novo, sem cache)', { text: 'tem cafe da manha?', tenant: torres, lang: 'pt', allowAi: true, reservationCode: 'ZZ99Z', channel: 'booking', bookingConfirmed: true }],
    ['notincl', 'NAO deve virar cafe: cafeteira no quarto', { text: 'tem cafeteira no apartamento?', tenant: torres, lang: 'pt', allowAi: true, reservationCode: 'QF04J', channel: 'booking', bookingConfirmed: true }],
    ['notincl', 'torres PT — "tem que pagar o cafe?"', { text: 'tem que pagar o cafe?', tenant: torres, lang: 'pt', allowAi: true, reservationCode: 'QF04J', channel: 'booking', bookingConfirmed: true }],
    ['http500', 'OUTRO tenant (cafe estatico "included") — CRM fora', { text: 'tem cafe da manha?', tenant: outro, lang: 'pt', allowAi: true, reservationCode: 'X1', channel: 'booking', bookingConfirmed: true }],
  ];
  let fail = 0;
  for (const [mode, nome, args] of casos) {
    MODE = mode;
    const r = await classifyAndRespond(args);
    const txt = String(r.reply || '(NULL)').replace(/\n/g, ' ⏎ ');
    const afirmaIncluso = /est[áa] incluso|is included|est[áa] incluido|est inclus/i.test(txt) && !/n[ãa]o est|not included|no est[áa]|n'est pas/i.test(txt);
    const esperaIncluso = mode === 'incl';
    let ok = afirmaIncluso === esperaIncluso && !!r.reply;
    if (/cafeteira/.test(args.text)) ok = !/^breakfast:/.test(String(r.source));
    if (/CRM FORA DO AR/.test(nome)) ok = /n\u00e3o vou te passar/.test(txt) && r.dispatchAlert === true;
    if (!ok) fail++;
    console.log((ok ? '  ✅ ' : '  ❌ ') + nome);
    console.log('       source=' + r.source + '  alerta=' + (r.dispatchAlert ? 'SIM' : 'não'));
    console.log('       ' + txt.slice(0, 165));
  }
  srv.close();
  console.log('\n=== ' + (casos.length - fail) + ' pass / ' + fail + ' fail ===');
  process.exit(fail ? 1 : 0);
})();
