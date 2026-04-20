'use strict';

/**
 * db.js — MongoDB connection via Mongoose
 *
 * Connects to MongoDB Atlas (or local) using the MONGODB_URI env var.
 * Used to store reservation data parsed from Stays.net notification emails.
 */

const mongoose = require('mongoose');
const { MONGODB_URI } = require('../config');

let isConnected = false;

/**
 * Connect to MongoDB. Safe to call multiple times — will only connect once.
 * @returns {Promise<void>}
 */
async function connectDB() {
  if (isConnected) {
    console.log('[db] Already connected to MongoDB');
    return;
  }

  if (!MONGODB_URI) {
    console.error('[db] MONGODB_URI not set — reservation storage DISABLED');
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });

    isConnected = true;
    console.log('[db] ✅ Connected to MongoDB');

    mongoose.connection.on('error', (err) => {
      console.error('[db] MongoDB connection error:', err.message);
      isConnected = false;
    });

    mongoose.connection.on('disconnected', () => {
      console.log('[db] MongoDB disconnected');
      isConnected = false;
    });

  } catch (err) {
    console.error('[db] ❌ Failed to connect to MongoDB:', err.message);
  }
}

/**
 * Check if MongoDB is connected.
 * @returns {boolean}
 */
function isDBConnected() {
  return isConnected && mongoose.connection.readyState === 1;
}

module.exports = { connectDB, isDBConnected };
