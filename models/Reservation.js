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
  // ── Guest Info ──
  guestName: { type: String, required: true, index: true },
  guestPhone: { type: String, default: null },       // +55 11 99907-3135
  guestPhoneClean: { type: String, default: null },   // 5511999073135 (ready for WhatsApp API)
  guestEmail: { type: String, default: null },        // relay email (xxx@guest.booking.com)

  // ── Reservation Details ──
  bookingNumber: { type: String, index: true },       // OTA confirmation number
  staysReservationId: { type: String, index: true },  // Stays.net internal ID (e.g., LU02J)
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
