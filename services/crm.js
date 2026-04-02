'use strict';
/**
 * crm.js — CRM service client for TorresGuest
 * Thin wrapper around the CRM API running on the VPS (CRM_API_URL).
 */
const { CRM_API_URL } = require('../config');

/**
 * Save a message to the CRM.
 * @param {string} phone  Guest phone (e.g. "5511999999999")
 * @param {'user'|'assistant'} role
 * @param {string} content  Message text
 */
async function saveMessage(phone, role, content) {
  if (!CRM_API_URL) return null;
  try {
    const res = await fetch(`${CRM_API_URL}/guest/${phone}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, content }),
    });
    if (!res.ok) {
      console.error('[crm] saveMessage failed', res.status, await res.text());
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error('[crm] saveMessage error', err.message);
    return null;
  }
}

/**
 * Retrieve the last 10 messages for a guest (oldest first).
 * @param {string} phone
 * @returns {Promise<Array<{phone,role,content,ts}>>}
 */
async function getContext(phone) {
  if (!CRM_API_URL) return [];
  try {
    const res = await fetch(`${CRM_API_URL}/guest/${phone}/context`);
    if (!res.ok) {
      console.error('[crm] getContext failed', res.status);
      return [];
    }
    return await res.json();
  } catch (err) {
    console.error('[crm] getContext error', err.message);
    return [];
  }
}

module.exports = { saveMessage, getContext };
