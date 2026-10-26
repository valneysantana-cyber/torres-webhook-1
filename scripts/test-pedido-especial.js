// Teste do caso Helio (405, 26/10/2026): pedido de vinho + regressões dos matchers tocados.
// Rodar: node scripts/test-pedido-especial.js
const m = require('../utils/matchers');
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let ok = 0, fail = 0;
const t = (nome, cond) => { if (cond) ok++; else { fail++; console.log('  ❌ ' + nome); } };

// --- casos reais do Helio ---
const vinho = 'Tudo bem por aqui! Gostaria de um vinhozinho para a chegada, estou na puc, no congresso, entao estou indo ai para dar entrada e checkin deixar o carro e aproveitar 30’ para um vinho 🍷 rsrsrs';
t('vinho → pedido especial', m.shouldSendSpecialRequest(norm(vinho)));
t('"Nao ha vinhos no cardapio" → pedido especial', m.shouldSendSpecialRequest(norm('Nao ha vinhos no cardapio')));
t('"Nao ha vinhos no cardapio" → idioma pt', m.detectLanguage('Nao ha vinhos no cardapio') === 'pt');
t('"Dont have wine" → pedido especial', m.shouldSendSpecialRequest(norm('Dont have wine')));
t('"Peço por aqui ou direto na recepção?" → NÃO é segurança', !m.shouldSendSecurity(norm('Peço por aqui ou direto na recepção?')));

// --- regressões ---
t('"tem estacionamento?" → estacionamento', m.shouldSendParking(norm('tem estacionamento?')));
t('"posso deixar o carro?" → estacionamento', m.shouldSendParking(norm('posso deixar o carro?')));
t('"posso deixar o carro?" → NÃO é pedido especial', !m.shouldSendSpecialRequest(norm('posso deixar o carro?')));
t('"tem segurança 24h?" → segurança', m.shouldSendSecurity(norm('tem segurança 24h?')));
t('"a recepção funciona 24 horas?" → segurança', m.shouldSendSecurity(norm('a recepção funciona 24 horas?')));
t('"bebi um vinho do frigobar" → NÃO é pedido especial', !m.shouldSendSpecialRequest(norm('bebi um vinho do frigobar')));
t('"tomei 2 aguas" → frigobar', m.shouldSendFrigobarPix(norm('tomei 2 aguas')));
t('"cardapio do restaurante" → NÃO é pedido especial', !m.shouldSendSpecialRequest(norm('cardapio do restaurante')));
t('"quero flores no quarto para surpresa" → pedido especial', m.shouldSendSpecialRequest(norm('quero flores no quarto para surpresa')));
t('idioma: "Where is the parking?" → en', m.detectLanguage('Where is the parking?') === 'en');
t('idioma: "Necesito una factura por favor" → es', m.detectLanguage('Necesito una factura por favor') === 'es');
t('idioma: "Quel est le poste de la réception ?" → fr', m.detectLanguage('Quel est le poste de la réception ?') === 'fr');
t('idioma: "Preciso de ajuda por favor" → pt', m.detectLanguage('Preciso de ajuda por favor') === 'pt');
t('idioma: "Do you have towels?" → en', m.detectLanguage('Do you have towels?') === 'en');

console.log((fail ? '❌ ' : '✅ ') + ok + '/' + (ok + fail) + ' ok');
process.exit(fail ? 1 : 0);
