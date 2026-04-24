'use strict';

/**
 * Reservation.js — MongoDB model for OTA reservation data
 *
 * Stores guest contact info (phone, email), reservation dates, property,
 * and booking metadata extracted from Stays.net notification emails.
 *
 * This data is used to:
 * 1. Enrich responses with guest context (name, dates, property)
 * 2. Send WhatsApp replies directly to the guest's phone
 * 3. Track reservation history for CRM purposes
 */

const mongoose = require('mongoose');

const reservationSchema = new mongoose.Schema({
  // ── Multi-tenant routing ──
  tenantId: { type: String, default: 'torres', index: true },   // tenant dono desta reserva
  listingStaysId: { type: String, default: null, index: true }, // Stays ObjectId do listing (resolve owner)
  listingName: { type: String, default: null },

  // ── Guest Info ──
  guestName: { type: String, required: true, index: true },
  guestPhone: { type: String, default: null },       // +55 11 99907-3135
  guestPhoneClean: { type: String, default: null, index: true },   // 5511999073135 (ready for WhatsApp API)
  guestEmail: { type: String, default: null },        // relay email (xxx@guest.booking.com)

  // ── Reservation Details ──
  bookingNumber: { type: String, index: true },       // OTA confirmation number
  staysReservationId: { type: String, index: true },  // Stays.net internal ID (e.g., LU02J)
  confirmationCode: { type: String, index: true },    // Synonym: gravado por stays_sync E pelo email parser (=staysReservationId)
  staysId: { type: String, index: true },             // Stays Mongo ObjectId (gravado por stays_sync depois)
  checkin: { type: String },                          // "01 jul 2026"
  checkout: { type: String },                         // "02 jul 2026"
  numGuests: { type: Number, default: 1 },
  numRooms: { type: Number, default: 1 },
  numNights: { type: Number, default: 1 },

  // ── Property & Financial ──
  property: { type: String },                         // "Hotel em Perdizes - FLAT404"
  accommodation: { type: String },                    // "404"
  totalValue: { type: String },                       // "R$ 519,35"
  commission: { type: String },                       // "R$ 67,52"

  // ── OTA & Source ──
  ota: { type: String, default: 'booking' },          // booking, airbnb, expedia
  channel: { type: String, default: 'API booking.com' },

  // ── Status ──
  status: {
    type: String,
    enum: ['reservado', 'confirmado', 'checkin', 'checkout', 'cancelado', 'no-show'],
    default: 'reservado',
  },

  // ── WhatsApp auto-send tracking (dedupe between emailMonitor and stays_sync) ──
  autoCheckinSentAt: { type: Date, default: null },

  // ── Delayed welcome kit ──
  // First-contact guests have a closed Meta 24h service window, so free-text
  // welcome kit (sendWelcomeKit) is silently dropped by Meta despite HTTP 200.
  // We now mark it pending when the check-in template is sent; the WhatsApp
  // handler fires it as soon as the guest sends any message (which opens the
  // window). See project_meta_service_window.md.
  welcomeKitPending: { type: Boolean, default: false },
  welcomeKitTemplateSentAt: { type: Date, default: null },  // when the check-in template went out (opens 72h capture window)
  welcomeKitSentAt: { type: Date, default: null },          // when the welcome kit free-text was actually delivered
  welcomeKitContext: { type: Object, default: null },       // { firstName, listingName, checkInDate, nights, totalValue }

  // ── Cancellation retention flow ──
  // Preenchidos quando reserva é cancelada e o hóspede recebe o template de retenção.
  cancellationRetentionSentAt: { type: Date, default: null },
  cancellationOta: { type: String, default: null },                  // "Booking.com", "Airbnb", etc. — usado na var {{2}} do template
  cancellationReason: { type: String, default: null },               // 'pending' = aguardando resposta; texto livre = motivo recebido
  cancellationReasonReceivedAt: { type: Date, default: null },       // quando o hóspede respondeu no WhatsApp
  cancellationDispatchedToHostAt: { type: Date, default: null },     // quando o motivo foi repassado pro dispatchNumber

  // ── Timestamps ──
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
  collection: 'reservations',
});

// Compound index for fast lookup by guest name + booking number
reservationSchema.index({ guestName: 1, bookingNumber: 1 });
// Index for looking up by phone
reservationSchema.index({ guestPhoneClean: 1 });
// TTL: auto-delete reservations older than 1 year (optional cleanup)
// reservationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

/**
 * Find reservation by guest name (case-insensitive partial match).
 * Returns the most recent reservation for that guest.
 */
reservationSchema.statics.findByGuestName = function (name) {
  const regex = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return this.findOne({ guestName: regex }).sort({ createdAt: -1 });
};

/**
 * Find reservation by booking number.
 */
reservationSchema.statics.findByBookingNumber = function (bookingNum) {
  return this.findOne({ bookingNumber: bookingNum });
};

/**
 * Find reservation by Stays.net reservation ID.
 */
reservationSchema.statics.findByStaysId = function (staysId) {
  return this.findOne({ staysReservationId: staysId });
};

/**
 * Find reservation by guest relay email.
 */
reservationSchema.statics.findByGuestEmail = function (email) {
  return this.findOne({ guestEmail: email.toLowerCase() }).sort({ createdAt: -1 });
};

/**
 * Find a reservation whose cancellation template was sent recently and is still
 * awaiting the guest's reason text. Used by the WhatsApp handler to intercept
 * the next incoming message from that phone and record it as the reason.
 *
 * @param {string} phoneClean - 5511999073135 (matches guestPhoneClean)
 * @param {number} windowMs   - how far back to look (default 72h)
 */
reservationSchema.statics.findPendingRetentionByPhone = function (phoneClean, windowMs = 72 * 3600 * 1000) {
  const since = new Date(Date.now() - windowMs);
  return this.findOne({
    guestPhoneClean: phoneClean,
    cancellationReason: 'pending',
    cancellationRetentionSentAt: { $gte: since },
  }).sort({ cancellationRetentionSentAt: -1 });
};

/**
 * Find a reservation whose check-in template was sent recently but the welcome
 * kit free-text still hasn't been delivered (Meta 24h window). Called when the
 * guest sends any WhatsApp message — the window just opened, so we can send
 * the welcome kit in the same thread.
 *
 * 48h window: past that, check-in is likely close/already done and the
 * welcome kit becomes noise.
 */
reservationSchema.statics.findPendingWelcomeKitByPhone = function (phoneClean, windowMs = 48 * 3600 * 1000) {
  const since = new Date(Date.now() - windowMs);
  return this.findOne({
    guestPhoneClean: phoneClean,
    welcomeKitPending: true,
    welcomeKitTemplateSentAt: { $gte: since },
  }).sort({ welcomeKitTemplateSentAt: -1 });
};

/**
 * Upsert reservation — update if exists (by bookingNumber or staysReservationId), create if not.
 */
reservationSchema.statics.upsertReservation = async function (data) {
  const query = data.bookingNumber
    ? { bookingNumber: data.bookingNumber }
    : data.staysReservationId
      ? { staysReservationId: data.staysReservationId }
      : { guestName: data.guestName, checkin: data.checkin };

  const update = { ...data, updatedAt: new Date() };
  const options = { upsert: true, new: true, setDefaultsOnInsert: true };

  return this.findOneAndUpdate(query, update, options);
};

module.exports = mongoose.model('Reservation', reservationSchema);
