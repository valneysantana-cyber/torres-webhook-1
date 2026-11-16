// Caso Solange (RD02J, 16/11/2026): reserva CANCELADA e a IA respondeu "sua reserva continua confirmada".
// Rodar: node scripts/test-status-reserva.js
const { reservationPromptBlock } = require('../services/openai');
const { classifyAndRespond, isCanceledReservation } = require('../services/smmClassifier');
let ok = 0, fail = 0;
const t = (n, c) => { if (c) ok++; else { fail++; console.log('  ❌ ' + n); } };
const R = (extra) => Object.assign({ code: 'RD02J', guestName: 'Solange Braga', checkInDate: '2026-11-17', checkOutDate: '2026-11-23' }, extra || {});

(async () => {
  // 1) reserva cancelada: nenhuma resposta automática, só aviso
  t('isCanceled: type canceled', isCanceledReservation({ type: 'canceled' }));
  t('isCanceled: status cancelled', isCanceledReservation({ status: 'Cancelled' }));
  t('isCanceled: booked não', !isCanceledReservation({ type: 'booked' }));
  t('isCanceled: sem reserva não', !isCanceledReservation(null));
  for (const texto of ['Foi um engano, agradeço o contato', 'menu', 'Olá, bom dia!', 'Qual o horário do café da manhã?']) {
    const r = await classifyAndRespond({ text: texto, channel: 'bookingcom', guestName: 'Solange Braga', allowAi: true,
      reservationCode: 'RD02J', reservation: R({ status: 'canceled' }), reservationLookup: 'found' });
    t('cancelada "' + texto + '": sem resposta', r.reply === null && r.source === 'noop:reserva-cancelada');
    t('cancelada "' + texto + '": avisa a equipe', r.dispatchAlert === true && /CANCELADA/.test(r.dispatchBody) && /RD02J/.test(r.dispatchBody));
  }

  // 2) prompt: situação só quando o chamador informa
  const conf = reservationPromptBlock({ reservation: R({ status: 'booked' }), reservationLookup: 'found' }, true, false);
  t('booked: situação CONFIRMADA', /situação: CONFIRMADA/.test(conf));
  t('booked: datas da reserva', /check-in 17\/11\/2026/.test(conf) && /check-out 23\/11\/2026/.test(conf));
  t('booked OTA: não escreve "unidade ?"', !/unidade \?/.test(conf));
  const canc = reservationPromptBlock({ reservation: R({ type: 'canceled' }), reservationLookup: 'found' }, true, false);
  t('canceled: situação CANCELADA', /situação: CANCELADA/.test(canc) && !/CONFIRMADA/.test(canc));
  const semSit = reservationPromptBlock({ reservation: R(), reservationLookup: 'found' }, true, false);
  t('OTA sem situação: proíbe afirmar confirmada', /PROIBIDO afirmar que a reserva "está confirmada"/.test(semSit) && !/situação:/.test(semSit));
  const pre = reservationPromptBlock({ reservation: R({ status: 'reserved' }), reservationLookup: 'found' }, true, false);
  t('reserved: pré-reserva, não confirmada', /PRÉ-RESERVA, ainda NÃO confirmada/.test(pre));

  // 3) conversa de plataforma sem reserva (consulta): não pede código, não confirma reserva
  const consulta = reservationPromptBlock({ reservationLookup: 'ota_sem_reserva' }, true, false);
  t('consulta OTA: proíbe dizer que há reserva', /NÃO tem reserva vinculada/.test(consulta) && /PROIBIDO/.test(consulta));
  t('consulta OTA: não pede código de 5 caracteres', !/5 caracteres/.test(consulta));

  // 4) WhatsApp da Sofia (torres-wa) não muda
  const wa = reservationPromptBlock({ reservation: Object.assign(R(), { listingName: 'FLAT504' }), reservationLookup: 'found' }, false, true);
  t('WhatsApp: mantém unidade e não ganha a proibição nova', /unidade FLAT504/.test(wa) && !/A SITUAÇÃO da reserva/.test(wa));
  const waNao = reservationPromptBlock({ reservationLookup: 'not_found' }, false, true);
  t('WhatsApp sem reserva: segue pedindo o código', /5 caracteres/.test(waNao));
  t('sem contexto: bloco vazio', reservationPromptBlock({}, true, false) === '');

  console.log((fail ? '❌ ' : '✅ ') + ok + '/' + (ok + fail) + ' ok');
  process.exit(fail ? 1 : 0);
})();
