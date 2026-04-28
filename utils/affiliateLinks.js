'use strict';

/**
 * Affiliate links com tracking UTM consistente — ConciergeCloud / TorresGuest.
 *
 * Por que existe:
 *  - Centralizar URLs e UTMs em um só lugar; templates importam o helper.
 *  - Cada link inclui utm_source=whatsapp_bot, utm_medium=concierge_template,
 *    utm_campaign=<template>, utm_content=<merchant> para análise por
 *    template no GA4 + dashboard /admin/afiliacoes.
 *  - Encurtar URLs longas (Awin/Lomadee/CJ) com helper opcional `short()`
 *    quando integrarmos go.conciergecloud.com.br no futuro.
 *
 * Adicionar nova marca: incluir em LINKS abaixo, depois templates importam
 * via `affiliate('food','don_maitre','welcome_kit')`.
 */

const SITE = 'https://conciergecloud.com.br';

// Mapa direto pra páginas/seções do próprio site (sempre seguro)
const PAGE = {
  travel: `${SITE}/travel.html`,
  hosts: `${SITE}/anfitrioes.html`,
  restaurant: `${SITE}/restaurante.html`,
  guide: `${SITE}/guia.html`,
};

/**
 * Adiciona UTMs a uma URL.
 * @param {string} baseUrl
 * @param {{source?:string, medium?:string, campaign?:string, content?:string, term?:string}} utm
 */
function withUTM(baseUrl, utm = {}) {
  const u = new URL(baseUrl);
  const map = {
    utm_source: utm.source || 'whatsapp_bot',
    utm_medium: utm.medium || 'concierge_template',
    utm_campaign: utm.campaign || 'generic',
    utm_content: utm.content || 'unknown',
  };
  if (utm.term) map.utm_term = utm.term;
  Object.entries(map).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}

/**
 * Helper principal: gera link tracked pra uma intenção e merchant.
 * @param {'travel'|'hosts'|'restaurant'|'guide'} intent
 * @param {string} merchant ex: 'don_maitre', 'expedia', 'tokstok'
 * @param {string} campaign template name (ex: 'welcome_kit', 'post_checkout')
 */
function affiliate(intent, merchant, campaign) {
  const base = PAGE[intent] || SITE;
  return withUTM(base, { campaign, content: merchant });
}

/**
 * URLs prontas mais usadas em templates do bot.
 * Se o link de afiliado externo (Awin, Hotmart, etc) precisar ser usado
 * direto (sem passar por nosso site), adicionar aqui com helper específico.
 */
const links = {
  donMaitre: (campaign = 'welcome_kit') =>
    affiliate('restaurant', 'don_maitre', campaign),
  travel: (campaign = 'post_checkout') =>
    affiliate('travel', 'travel_landing', campaign),
  hosts: (campaign = 'post_checkout') =>
    affiliate('hosts', 'hosts_landing', campaign),
  guide: (campaign = 'welcome_kit') =>
    affiliate('guide', 'guest_guide', campaign),
};

module.exports = {
  PAGE,
  withUTM,
  affiliate,
  links,
};
