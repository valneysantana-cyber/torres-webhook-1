'use strict';
/**
 * utils/loyalty.js
 * Níveis de fidelidade TorresGuest
 *
 * Visitante  : 1–3 noites
 * Frequente  : 4–9 noites
 * VIP        : 10–19 noites
 * Embaixador : 20+ noites
 */

const LEVELS = [
  { name: 'Embaixador', minNights: 20, emoji: '\u{1F451}', benefit: 'Late check-out até 14h, upgrade de quarto quando disponível e cortesia de boas-vindas.' },
  { name: 'VIP',        minNights: 10, emoji: '\u{2B50}',  benefit: 'Late check-out até 13h e desconto especial em estadias futuras.' },
  { name: 'Frequente',  minNights: 4,  emoji: '\u{1F3E0}', benefit: 'Prioridade em pedidos de limpeza e preferência de apartamento.' },
  { name: 'Visitante',  minNights: 0,  emoji: '\u{1F31F}', benefit: null },
];

/**
 * Calcula o nível com base no total de noites.
 * @param {number} totalNights
 * @returns {{ name: string, minNights: number, emoji: string, benefit: string|null }}
 */
function calcLevel(totalNights = 0) {
  return LEVELS.find(l => totalNights >= l.minNights) || LEVELS[LEVELS.length - 1];
}

/** @param {number} totalNights @returns {string} */
function getLevelName(totalNights = 0) {
  return calcLevel(totalNights).name;
}

/** @param {number} totalNights @returns {string} */
function getLevelEmoji(totalNights = 0) {
  return calcLevel(totalNights).emoji;
}

/**
 * Gera um bloco de texto de perfil para injetar no prompt do GPT.
 * @param {{ name?: string, level?: string, totalNights?: number, totalStays?: number, preferredApartment?: string, notes?: string }} profile
 * @returns {string}
 */
function buildProfilePromptBlock(profile) {
  if (!profile || (!profile.level && !profile.totalNights)) return '';

  const lines = [];
  if (profile.name)              lines.push(`Nome do hóspede: ${profile.name}`);
  if (profile.level)             lines.push(`Nível de fidelidade: ${profile.level} ${getLevelEmoji(profile.totalNights || 0)}`);
  if (profile.totalNights > 0)   lines.push(`Total de noites conosco: ${profile.totalNights}`);
  if (profile.totalStays > 1)    lines.push(`Número de estadias: ${profile.totalStays}`);
  if (profile.preferredApartment) lines.push(`Apartamento preferido: ${profile.preferredApartment}`);
  if (profile.notes)             lines.push(`Observações: ${profile.notes}`);

  const level   = calcLevel(profile.totalNights || 0);
  if (level.benefit) lines.push(`Benefícios do nível: ${level.benefit}`);

  return lines.length > 0
    ? `Perfil do hóspede (use para personalizar o atendimento):\n${lines.join('\n')}\n\n`
    : '';
}

module.exports = { LEVELS, calcLevel, getLevelName, getLevelEmoji, buildProfilePromptBlock };—
