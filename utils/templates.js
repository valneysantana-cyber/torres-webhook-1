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
 * Concatena linhas com newline; se passar maxChars, trunca e adiciona "…e mais N".
 * Usado pelas seções dinâmicas (check-ins, em estadia, check-outs) do daily_report_v1.
 *
 * @param {string[]} lines  Linhas já formatadas (cada uma com prefix ` • `).
 * @param {number}   maxChars  Limite seguro (default 900).
 * @returns {string}
 */
function joinLinesWithBudget(lines, maxChars = 900) {
  if (!Array.isArray(lines) || lines.length === 0) return ' (nenhum)';
  let out = '';
  let kept = 0;
  for (const line of lines) {
    const candidate = (out ? out + '\n' : '') + line;
    if (candidate.length > maxChars) break;
    out = candidate;
    kept++;
  }
  if (kept < lines.length) {
    const more = lines.length - kept;
    out += `\n • …e mais ${more} hóspede${more > 1 ? 's' : ''}`;
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

module.exports = {
  sanitizeMetaVar,
  joinLinesWithBudget,
  buildDailyReportVars,
};
