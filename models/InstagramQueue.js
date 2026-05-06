const mongoose = require('mongoose');

const InstagramQueueSchema = new mongoose.Schema({
  scheduledFor: { type: Date, required: true, index: true },

  status: {
    type: String,
    enum: ['pending', 'approved', 'rendering', 'ready', 'publishing', 'published', 'failed', 'skipped'],
    default: 'pending',
    index: true
  },

  pillar: {
    type: String,
    enum: ['launch', 'travel', 'hosts', 'affiliates', 'partners'],
    required: true,
    index: true
  },

  format: {
    type: String,
    enum: ['feed_carousel', 'feed_single', 'reel', 'story'],
    required: true
  },

  template: { type: String, required: true },

  data: { type: mongoose.Schema.Types.Mixed, required: true },

  caption: { type: String, maxlength: 2200, required: true },

  hashtags: { type: [String], validate: v => v.length <= 30 },

  rendered: {
    images: [String],
    video_url: String,
    rendered_at: Date,
    render_duration_ms: Number
  },

  published: {
    ig_media_id: String,
    permalink: String,
    published_at: Date
  },

  metrics: {
    impressions: { type: Number, default: 0 },
    reach: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    saves: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    last_synced: Date
  },

  approval: {
    approved_by: String,
    approved_at: Date,
    edited_at: Date,
    notes: String
  },

  lastError: { type: String, default: null },
  retryCount: { type: Number, default: 0 },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  collection: 'instagram_queue',
  timestamps: true
});

InstagramQueueSchema.index({ status: 1, scheduledFor: 1 });
InstagramQueueSchema.index({ 'published.published_at': -1 });
InstagramQueueSchema.index({ pillar: 1, scheduledFor: -1 });

InstagramQueueSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

InstagramQueueSchema.statics.findDueForRender = function() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(23, 59, 59, 999);
  return this.find({
    status: 'approved',
    scheduledFor: { $lte: tomorrow }
  }).sort({ scheduledFor: 1 });
};

InstagramQueueSchema.statics.findDueForPublish = function() {
  const now = new Date();
  return this.find({
    status: 'ready',
    scheduledFor: { $lte: now }
  }).sort({ scheduledFor: 1 }).limit(5);
};

InstagramQueueSchema.statics.findRecentPublished = function(days = 7) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return this.find({
    status: 'published',
    'published.published_at': { $gte: cutoff }
  }).sort({ 'published.published_at': -1 });
};

InstagramQueueSchema.statics.weekDigest = function(weekStart, weekEnd) {
  return this.find({
    scheduledFor: { $gte: weekStart, $lte: weekEnd },
    status: { $in: ['pending', 'approved'] }
  }).sort({ scheduledFor: 1 });
};

module.exports = mongoose.model('InstagramQueue', InstagramQueueSchema);
