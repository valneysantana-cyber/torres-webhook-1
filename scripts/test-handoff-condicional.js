// Aviso à equipe só quando a resposta PROMETE repasse/retorno — oferta condicional não conta.
// Rodar: node scripts/test-handoff-condicional.js
const { promisesHandoff } = require('../services/smmClassifier');
const casos = [
  // [resposta, esperado, descrição]
  ["Check-out is until 11 AM. If you need to leave later, let me know and I'll connect you with our team to check availability and cost.", false, 'EN oferta condicional'],
  ['O check-out é até as 11h. Se precisar sair mais tarde, me avisa que vou verificar com a equipe.', false, 'PT oferta condicional'],
  ['Caso precise de berço, posso encaminhar o pedido à equipe.', false, 'PT caso precise'],
  ['Qualquer coisa, te aviso por aqui.', false, 'PT qualquer coisa'],
  ['Já avisei a nossa equipe, que acompanha a liberação do apartamento e te responde por aqui.', true, 'PT já avisei'],
  ['Vou verificar com a Sofia e te retorno.', true, 'PT vou verificar'],
  ["I'll forward this to our team right away.", true, 'EN forward'],
  ['O check-in é a partir das 15h. Encaminhei seu pedido de chegada antecipada à equipe. Se precisar de algo mais, me avisa.', true, 'promessa + oferta depois'],
  ['Água custa R$ 7,50. Me confirma quando pagar pra eu registrar aqui!', true, 'frigobar: registrar pagamento'],
  ['Água custa R$ 7,50 e Coca-Cola R$ 8,90. O PIX é o CNPJ.', false, 'só informação'],
  ['O Wi-Fi é TorresGuest e a senha está na bancada.', false, 'informação simples'],
];
let ok = 0;
for (const [r, esp, d] of casos) {
  const got = promisesHandoff(r);
  if (got === esp) { ok++; console.log('✅ ' + d); } else { console.log('❌ ' + d + ' — esperado ' + esp + ', veio ' + got); }
}
console.log(ok + '/' + casos.length);
process.exit(ok === casos.length ? 0 : 1);
