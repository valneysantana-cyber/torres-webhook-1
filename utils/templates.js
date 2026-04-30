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
function joinLinesWithBudget(lines, maxChars = 900) {
  if (!Array.isArray(lines) || lines.length === 0) return ' (nenhum)';
  const sep = ' · ';
  let out = '';
  let kept = 0;
  for (const line of lines) {
    const candidate = (out ? out + sep : '') + line;
    if (candidate.length > maxChars) break;
    out = candidate;
    kept++;
  }
  if (kept < lines.length) {
    const more = lines.length - kept;
    out += `${sep}…e mais ${more} hóspede${more > 1 ? 's' : ''}`;
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
