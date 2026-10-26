// Caso Vladimir (26/10/2026): IA chutou água R$ 5 / refrigerante R$ 7. O prompt agora leva o cardápio oficial.
// Rodar: node scripts/test-precos-frigobar-prompt.js
const { frigobarPriceBlock } = require('../services/openai');
let ok = 0, fail = 0;
const t = (n, c) => { if (c) ok++; else { fail++; console.log('  ❌ ' + n); } };
const torres = frigobarPriceBlock({ tenantId: 'torres', settings: {} });
t('torres: água 7,50', torres.includes('Água – R$ 7,50'));
t('torres: refri 350 8,90', torres.includes('Refrigerante 350ml – R$ 8,90'));
t('torres: refri 200/220 5,50', torres.includes('Refrigerante 200/220ml – R$ 5,50'));
t('torres: regra de não estimar', /NUNCA estime/.test(torres));
t('sem tenant (default torres) também recebe', frigobarPriceBlock(null).includes('Água – R$ 7,50'));
t('outro tenant sem frigobar: vazio', frigobarPriceBlock({ tenantId: 'casa-x', settings: {} }) === '');
const custom = frigobarPriceBlock({ tenantId: 'casa-y', settings: { frigobar: { enabled: true }, responses: { FRIGOBAR_PIX: { pt: 'Água – R$ 3,00' } } } });
t('outro tenant com cardápio próprio usa o dele', custom.includes('Água – R$ 3,00') && !custom.includes('7,50'));
console.log((fail ? '❌ ' : '✅ ') + ok + '/' + (ok + fail) + ' ok');
process.exit(fail ? 1 : 0);
