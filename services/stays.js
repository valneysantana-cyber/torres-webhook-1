'use strict';

const { STAYS_BASE_URL, STAYS_USERNAME, STAYS_PASSWORD } = require('../config');
const { getCurrentISODateBRT } = require('../utils/formatters');

function getStaysAuth() {
  return Buffer.from(`${STAYS_USERNAME}:${STAYS_PASSWORD}`).toString('base64');
}

async function fetchReservations({ from, to, dateType = 'arrival' } = {}) {
  if (!STAYS_USERNAME || !STAYS_PASSWORD) {
    console.error('Missing Stays credentials');
    return [];
  }

  const base = STAYS_BASE_URL.replace(/\/$/, '');
  const url  = `${base}/booking/reservations?from=${from}&to=${to}&dateType=${dateType}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${getStaysAuth()}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Failed to fetch reservations', response.status, text);
      return [];
    }

    const data = await response.json();
    console.log(`[stays] ${dateType} ${from}\u2192${to}: ${Array.isArray(data) ? data.length : '?'} records`);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('Error fetching reservations', err);
    return [];
  }
}

/**
 * Look up a single reservation by its confirmation code.
 * Tries the direct /booking/reservations/:code endpoint first;
 * falls back to scanning arrivals from the last 90 days.
 */
async function fetchReservationByCode(code) {
  if (!STAYS_USERNAME || !STAYS_PASSWORD) {
    console.error('Missing Stays credentials');
    return null;
  }

  const base = STAYS_BASE_URL.replace(/\/$/, '');
  const auth = getStaysAuth();

  // --- attempt 1: direct endpoint ---
  try {
    const res = await fetch(`${base}/booking/reservations/${code}`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
    });
    if (res.ok) {
      const data = await res.json();
      if (data && (data._id || data.id)) return data;
    }
  } catch (err) {
    console.error('Direct reservation lookup failed', err);
  }

  // --- attempt 2: scan last 90 days of arrivals ---
  const today        = getCurrentISODateBRT();
  const ninetyAgo   = new Date();
  ninetyAgo.setDate(ninetyAgo.getDate() - 90);
  const fromDate     = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(ninetyAgo);

  const reservations = await fetchReservations({ from: fromDate, to: today, dateType: 'arrival' });
  const upper        = code.toUpperCase();

  return (
    reservations.find((r) => {
      const id   = String(r._id || r.id || '').toUpperCase();
      const conf = String(r.confirmationCode || r.code || r.reservationCode || '').toUpperCase();
      return id === upper || conf === upper;
    }) || null
  );
}

/**
 * Returns today's check-ins AND mid-stay guests (arrived before today,
 * checkout >= today).  This fixes the missing-guest report bug.
 */
async function fetchTodayAllActiveGuests() {
  const today = getCurrentISODateBRT();

  // today's arrivals
  const arrivals = await fetchReservations({ from: today, to: today, dateType: 'arrival' });

  // prior arrivals (up to 30 days ago) that haven't checked out yet
  const thirtyAgo  = new Date();
  thirtyAgo.setDate(thirtyAgo.getDate() - 30);
  const yesterday  = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const fromDate    = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(thirtyAgo);
  const toDate      = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(yesterday);

  const priorArrivals = await fetchReservations({ from: fromDate, to: toDate, dateType: 'arrival' });

  const arrivalIds = new Set(arrivals.map((r) => String(r._id || r.id)));
  const midStay    = priorArrivals.filter((r) => {
    if (arrivalIds.has(String(r._id || r.id))) return false;
    const checkout = (r.checkOutDate || r.checkout || '').split('T')[0];
    return checkout >= today;
  });

  return { arrivals, midStay };
}

async function fetchTodayCheckinReservations() {
  const today = getCurrentISODateBRT();
  return fetchReservations({ from: today, to: today, dateType: 'arrival' });
}

async function fetchTodayCheckoutReservations() {
  const today = getCurrentISODateBRT();
  return fetchReservations({ from: today, to: today, dateType: 'departure' });
}

module.exports = {
  fetchReservations,
  fetchReservationByCode,
  fetchTodayAllActiveGuests,
  fetchTodayCheckinReservations,
  fetchTodayCheckoutReservations,
};
