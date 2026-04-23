'use strict';

const { STAYS_BASE_URL, STAYS_USERNAME, STAYS_PASSWORD } = require('../config');
const { getCurrentISODateBRT } = require('../utils/formatters');

function getStaysAuth() {
  return Buffer.from(`${STAYS_USERNAME}:${STAYS_PASSWORD}`).toString('base64');
}

async function staysFetch(path) {
  if (!STAYS_USERNAME || !STAYS_PASSWORD) {
    console.error('Missing Stays credentials');
    return null;
  }
  const base = STAYS_BASE_URL.replace(/\/$/, '');
  const url  = `${base}${path}`;
  try {
    const res = await fetch(url,  {
      method: 'GET',
      headers: {
        Authorization: `Basic ${getStaysAuth()}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[stays] GET ${path} → ${res.status}`, text.slice(0, 300));
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`[stays] GET ${path} error`, err.message);
    return null;
  }
}

async function fetchReservations({ from, to, dateType = 'arrival' } = {}) {
  const data = await staysFetch(`/booking/reservations?from=${from}&to=${to}&dateType=${dateType}`);
  if (!Array.isArray(data)) return [];
  console.log(`[stays] ${dateType} ${from}→${to}: ${data.length} records`);
  return data;
}

/**
 * Fetches the FULL details of a single reservation by its MongoDB _id.
 * The list endpoint returns only summary data (no client.name, no listing object).
 * This endpoint returns the complete record.
 */
async function fetchReservationDetails(mongoId) {
  const data = await staysFetch(`/booking/reservations/${mongoId}`);
  return data || null;
}

/**
 * Fetches all property listings and returns a Map of  _id → display name.
 * Used to resolve `_idlisting` (MongoDB ObjectID) to a human-readable apartment name.
 */
async function fetchListingsMap() {
let list = [];
for (const ep of ['/listing', '/listing?limit=100', '/listing/listingSearch']) {
  const data = await staysFetch(ep);
  if (data) {
    const items = Array.isArray(data) ? data : (data?.result || data?.listings || data?.data || data?.items || []);
    if (items.length > 0) { list = items; console.log(`[stays] listings em ${ep}: ${items.length}`); break; }
  }
}
  const map  = new Map();
  for (const l of list) {
    const id   = String(l._id || l.id || '');
    const name = l.internalName || l.nickname || l.name || l.title || l.unitName || l.propertyName || id;
    if (id) map.set(id, name);
  }
  console.log(`[stays] listings cache: ${map.size} entries`);
  if(map.size===0&&process.env.LISTING_NAMES_JSON){try{const n=JSON.parse(process.env.LISTING_NAMES_JSON);for(const[id,name]of Object.entries(n))map.set(String(id),String(name));console.log('[stays] listings from env: '+map.size+' entries');}catch(e){console.error('[stays] LISTING_NAMES_JSON error:',e.message);}}
  return map;
}

/**
 * Look up a single reservation by its confirmation code (e.g. "IG05J").
 * Tries the direct /booking/reservations/:code endpoint first;
 * falls back to scanning arrivals from the last 90 days.
 * When found, fetches full details so client.name is populated.
 */
async function fetchReservationByCode(code) {
  if (!STAYS_USERNAME || !STAYS_PASSWORD) return null;

  // --- attempt 1: direct endpoint (code might be MongoDB _id or shortId) ---
  const direct = await staysFetch(`/booking/reservations/${code}`);
  if (direct && (direct._id || direct.id)) return direct;

  // --- attempt 2: scan last 90 days of arrivals ---
  const today      = getCurrentISODateBRT();
  const ninetyAgo  = new Date();
  ninetyAgo.setDate(ninetyAgo.getDate() - 90);
  const fromDate   = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(ninetyAgo);
  const upper      = code.toUpperCase();

  const reservations = await fetchReservations({ from: fromDate, to: today, dateType: 'arrival' });
  const found = reservations.find((r) => {
    const id   = String(r._id || r.id || '').toUpperCase();
    const conf = String(r.confirmationCode || r.code || r.reservationCode || '').toUpperCase();
    return id === upper || conf === upper;
  });

  if (!found) return null;

  // Enrich with full details (to get client.name etc.)
  const fullDetails = await fetchReservationDetails(String(found._id || found.id));
  return fullDetails || found;
}

/**
 * Returns today's check-ins AND mid-stay guests.
 * Fetches full details for each reservation so client.name is available.
 * Also fetches the listings map to resolve apartment names.
 *
 * Returns: { arrivals, midStay, listingsMap }
 */
async function fetchTodayAllActiveGuests() {
  const today = getCurrentISODateBRT();

  // Fetch summary lists
  const arrivals = await fetchReservations({ from: today, to: today, dateType: 'arrival' });

  const thirtyAgo = new Date();
  thirtyAgo.setDate(thirtyAgo.getDate() - 30);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const fromDate  = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(thirtyAgo);
  const toDate    = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(yesterday);

  const priorArrivals = await fetchReservations({ from: fromDate, to: toDate, dateType: 'arrival' });

  const arrivalIds = new Set(arrivals.map((r) => String(r._id || r.id)));
  const midStay    = priorArrivals.filter((r) => {
    if (arrivalIds.has(String(r._id || r.id))) return false;
    const checkout = (r.checkOutDate || r.checkout || '').split('T')[0];
    return checkout > today;
  });

  // Check-outs de hoje: reservas (de qualquer grupo) cujo checkout === today.
  // Inclui 1) quem chegou hoje e sai hoje (diária), 2) quem chegou antes e sai hoje.
  // Dedup por _id para não contar duas vezes nos totais.
  const departureCandidates = [...arrivals, ...priorArrivals].filter((r) => {
    const checkout = (r.checkOutDate || r.checkout || '').split('T')[0];
    return checkout === today;
  });
  const seenDepartures = new Set();
  const departures = departureCandidates.filter((r) => {
    const id = String(r._id || r.id || '');
    if (seenDepartures.has(id)) return false;
    seenDepartures.add(id);
    return true;
  });

  // Fetch full details for all reservations in parallel (to get client names).
  // Order matters so we can slice back to each bucket.
  const all = [...arrivals, ...midStay, ...departures];
  const enriched = await Promise.all(
    all.map(async (r) => {
      const mongoId = String(r._id || r.id || '');
      if (!mongoId) return r;
      const full = await fetchReservationDetails(mongoId);
      return full || r;
    })
  );

  // Fetch listings name map in parallel with the above
  const listingsMap = await fetchListingsMap();

  const enrichedArrivals   = enriched.slice(0, arrivals.length);
  const enrichedMidStay    = enriched.slice(arrivals.length, arrivals.length + midStay.length);
  const enrichedDepartures = enriched.slice(arrivals.length + midStay.length);

  return {
    arrivals:   enrichedArrivals,
    midStay:    enrichedMidStay,
    departures: enrichedDepartures,
    listingsMap,
  };
}

async function fetchTodayCheckinReservations() {
  const today = getCurrentISODateBRT();
  return fetchReservations({ from: today, to: today, dateType: 'arrival' });
}

async function fetchYesterdayCheckoutReservations() {
  const today = getCurrentISODateBRT();
  const d = new Date(today + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  const yesterday = d.toISOString().slice(0, 10);
  return fetchReservations({ from: yesterday, to: yesterday, dateType: 'departure' });
}

async function fetchTodayCheckoutReservations() {
  const today = getCurrentISODateBRT();
  return fetchReservations({ from: today, to: today, dateType: 'departure' });
}

module.exports = {
  fetchReservations,
  fetchReservationDetails,
  fetchListingsMap,
  fetchReservationByCode,
  fetchTodayAllActiveGuests,
  fetchTodayCheckinReservations,
  fetchTodayCheckoutReservations,
  fetchYesterdayCheckoutReservations,
};
