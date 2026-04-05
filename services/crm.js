'use strict';
/**
 * crm.js — CRM service client for TorresGuest
 * Thin wrapper around the CRM API running on the VPS (CRM_API_URL).
 */
const { CRM_API_URL, CRM_API_KEY } = require('../config');
const CRM_BASIC_AUTH = process.env.CRM_BASIC_AUTH; // Basic auth for nginx proxy (port 80)

function crmHeaders() {
  const h = {
    'Content-Type': 'application/json',
  };
  if (CRM_API_KEY) h['x-api-key'] = CRM_API_KEY;
  if (CRM_BASIC_AUTH) h['Authorization'] = CRM_BASIC_AUTH;
  return h;
}

/**
 * Save a message to the CRM.
 * @param {string} phone Guest phone (e.g. "5511999999999")
 * @param {'user'|'assistant'} role
 * @param {string} content Message text
 */
async function saveMessage(phone, role, content) {
  if (!CRM_API_URL) return null;
  try {
    const res = await fetch(`${CRM_API_URL}/guest/${phone}/message`, {
      method: 'POST', headers: crmHeaders(), body: JSON.stringify({ role, content }),
    });
    if (!res.ok) { console.error('[crm] saveMessage failed', res.status, await res.text()); return null; }
    return await res.json();
  } catch (err) { console.error('[crm] saveMessage error', err.message); return null; }
}

/**
 * Retrieve the last N messages for a guest (oldest first).
 * @param {string} phone
 * @param {number} [limit=10]
 * @returns {Promise<Array<{phone,role,content,ts}>>}
 */
async function getContext(phone, limit = 10) {
  if (!CRM_API_URL) return [];
  try {
    const res = await fetch(`${CRM_API_URL}/guest/${phone}/context?limit=${limit}`, {
      headers: crmHeaders(),
    });
    if (!res.ok) { console.error('[crm] getContext failed', res.status); return []; }
    return await res.json();
  } catch (err) { console.error('[crm] getContext error', err.message); return []; }
}

/**
 * Get guest profile (loyalty level, totalNights, preferences, etc.)
 * @param {string} phone
 * @returns {Promise<object|null>}
 */
async function getProfile(phone) {
  if (!CRM_API_URL) return null;
  try {
    const res = await fetch(`${CRM_API_URL}/guest/${phone}/profile`, {
      headers: crmHeaders(),
    });
    if (!res.ok) { console.error('[crm] getProfile failed', res.status); return null; }
    return await res.json();
  } catch (err) { console.error('[crm] getProfile error', err.message); return null; }
}

/**
 * Update guest profile with partial data (name, preferences, etc.)
 * @param {string} phone
 * @param {object} data Partial profile fields to update
 * @returns {Promise<object|null>}
 */
async function updateProfile(phone, data) {
  if (!CRM_API_URL) return null;
  try {
    const res = await fetch(`${CRM_API_URL}/guest/${phone}/profile`, {
      method: 'PUT', headers: crmHeaders(), body: JSON.stringify(data),
    });
    if (!res.ok) { console.error('[crm] updateProfile failed', res.status, await res.text()); return null; }
    return await res.json();
  } catch (err) { console.error('[crm] updateProfile error', err.message); return null; }
}

/**
 * Register a checkout to update loyalty level.
 * @param {string} phone
 * @param {object} opts { nights, name, apartment }
 */
async function registerCheckout(phone, opts = {}) {
  if (!CRM_API_URL) return null;
  try {
    const res = await fetch(`${CRM_API_URL}/guest/${phone}/checkout`, {
      method: 'POST', headers: crmHeaders(), body: JSON.stringify(opts),
    });
    if (!res.ok) { console.error('[crm] registerCheckout failed', res.status, await res.text()); return null; }
    return await res.json();
  } catch (err) { console.error('[crm] registerCheckout error', err.message); return null; }
}

module.exports = { saveMessage, getContext, getProfile, updateProfile, registerCheckout };
