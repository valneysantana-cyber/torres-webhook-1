'use strict';

/**
 * Helpers pra montar variáveis de templates Meta WhatsApp Cloud API.
 *
 * Por que existe:
 *  - Meta exige variáveis com `*`/`_` BALANCEADOS (senão dropa msg).
 *  - Meta tem limite de ~1024 chars por variável (margem segura: 900).
 *  - Centraliza sanitize + truncate pra todos templates futuros usarem.
 */

/**
 * Remove caracteres reservados Meta (* _ ~ `) do texto.
 * Templates rejeitam vars com formatting desbalanceado.
 */
function sanitizeMetaVar(s) {
  return String(s == null ? '' : s).replace(/[*_~`]/g, '');
}

/**
 * Concatena linhas em UMA única linha; se passar maxChars, trunca e adiciona "…e mais N".
 * Usado pelas seções dinâmicas (check-ins, em estadia, check-outs) do daily_report_v1.
 *
 * IMPORTANTE: Meta rejeita templates com erro #132018 quando uma variável de
 * body contém `\n`, `\t` ou 4+ espaços consecutivos. A versão anterior
 * separava itens com `\n` e o template falhava silenciosamente em runtime
 * (passou na aprovação porque o exemplo Meta era de 1 item por var).
 *
 * Solução: separador inline " · " (espaço-interpunct-espaço) entre itens. Cada
 * item já entra com prefix ` • Nome → Apto` então a leitura ainda fica clara
 * — fica em uma única linha longa. Pra reorganizar visualmente em múltiplas
 * linhas, criar template `daily_report_v2` com link pro dashboard ao invés
 * de listar hóspedes inline.
 *
 * @param {string[]} lines  Linhas já formatadas (cada uma com prefix ` • `).
 * @param {number}   maxChars  Limite seguro (default 900).
 * @returns {string}
 */
function joinLinesWithBudget(lines, maxChars = 350, maxItems = 8) {
  // FIX 15/05: limit DUPLO — chars E item count.
  // Meta #132005 (Translated text too long) dispara mesmo com 600 chars
  // porque a auto-tradução pra outros locales expande. Limitamos a 8 itens
  // E 350 chars (o que vier primeiro). Dashboard tem a lista completa.
  if (!Array.isArray(lines) || lines.length === 0) return ' (nenhum)';
  const sep = ' · ';
  let out = '';
  let kept = 0;
  for (const line of lines) {
    if (kept >= maxItems) break;
    const candidate = (out ? out + sep : '') + line;
    if (candidate.length > maxChars) break;
    out = candidate;
    kept++;
  }
  if (kept < lines.length) {
    const more = lines.length - kept;
    out += `${sep}…e mais ${more} (veja completo no painel)`;
  }
  return sanitizeMetaVar(out);
}

/**
 * Monta as 8 variáveis exigidas pelo template `daily_report_v1`.
 * Ordem importa — corresponde aos {{1}}…{{8}} do body.
 *
 * @param {{
 *   today: string,
 *   checkinsHoje: string[],
 *   emEstadia: string[],
 *   checkoutsHoje: string[],
 *   totalAtivos: number,
 * }} data
 * @returns {Array<{type:'text', text:string}>}
 */
function buildDailyReportVars({ today, checkinsHoje, emEstadia, checkoutsHoje, totalAtivos }) {
  return [
    { type: 'text', text: sanitizeMetaVar(today) },
    { type: 'text', text: String(checkinsHoje.length) },
    { type: 'text', text: joinLinesWithBudget(checkinsHoje) },
    { type: 'text', text: String(emEstadia.length) },
    { type: 'text', text: joinLinesWithBudget(emEstadia) },
    { type: 'text', text: String(checkoutsHoje.length) },
    { type: 'text', text: joinLinesWithBudget(checkoutsHoje) },
    { type: 'text', text: String(totalAtivos) },
  ];
}

/**
 * Monta as 18 variáveis exigidas pelo template `daily_report_v2`.
 *
 * Layout: 1 (data) + 1 (count_ci) + 6 (ci_lines) + 1 (count_es) + 3 (es_lines)
 *       + 1 (count_co) + 4 (co_lines) + 1 (total) = 18 vars.
 *
 * Limites menores que v1 imposed pelo Meta (#2388293 — proporção palavras/vars
 * tem que respeitar threshold). Body de v2 inclui texto institucional pra
 * compensar o aumento de placeholders vs v1 (8 vars).
 *
 * Cada linha de hóspede é UMA variável separada — o template body intercala {{N}}
 * com `\n` no body fixo, então o resultado renderiza linha-por-linha mesmo dentro
 * da restrição Meta #132018 (vars não podem ter `\n`/`\t`/4+ spaces).
 *
 * Slots vazios são preenchidos com ' ' (single space) — Meta rejeita string
 * vazia mas aceita 1 espaço; visualmente renderiza como linha em branco discreta.
 *
 * Se uma seção excede o limite (8 ci / 5 es / 5 co), o último slot vira
 * "…e mais N hóspede(s)" preservando a contagem total.
 *
 * @param {{
 *   today: string,
 *   checkinsHoje: string[],
 *   emEstadia: string[],
 *   checkoutsHoje: string[],
 *   totalAtivos: number,
 * }} data
 * @returns {Array<{type:'text', text:string}>}
 */
function buildDailyReportV2Vars({ today, checkinsHoje, emEstadia, checkoutsHoje, totalAtivos }) {
  const MAX_CI = 6, MAX_ES = 3, MAX_CO = 4;
  const padLines = (lines, max) => {
    const isEmpty = lines.length === 1 && lines[0].startsWith(' (nenhum');
    const src = isEmpty ? lines : lines;
    let out;
    if (src.length > max) {
      const more = src.length - (max - 1);
      out = src.slice(0, max - 1).map(l => sanitizeMetaVar(l).slice(0, 250));
      out.push(sanitizeMetaVar(`…e mais ${more} hóspede${more > 1 ? 's' : ''}`));
    } else {
      out = src.map(l => sanitizeMetaVar(l).slice(0, 250));
    }
    while (out.length < max) out.push('—');  // Meta example aprovou com '—'; runtime usa mesmo placeholder
    return out;
  };
  const realCount = (lines) => (lines.length === 1 && lines[0].startsWith(' (nenhum')) ? 0 : lines.length;
  const ciLines = padLines(checkinsHoje, MAX_CI);
  const esLines = padLines(emEstadia, MAX_ES);
  const coLines = padLines(checkoutsHoje, MAX_CO);

  return [
    { type: 'text', text: sanitizeMetaVar(today) },
    { type: 'text', text: String(realCount(checkinsHoje)) },
    ...ciLines.map(t => ({ type: 'text', text: t })),
    { type: 'text', text: String(realCount(emEstadia)) },
    ...esLines.map(t => ({ type: 'text', text: t })),
    { type: 'text', text: String(realCount(checkoutsHoje)) },
    ...coLines.map(t => ({ type: 'text', text: t })),
    { type: 'text', text: String(totalAtivos) },
  ];
}

module.exports = {
  sanitizeMetaVar,
  joinLinesWithBudget,
  buildDailyReportVars,
  buildDailyReportV2Vars,
};
