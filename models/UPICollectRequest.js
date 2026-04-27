const mongoose = require("mongoose");

const upiCollectRequestSchema = new mongoose.Schema({
  request_id: { type: String, required: true, unique: true },

  // Who initiates the request (sender)
  requester_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  requester_name: { type: String, required: true },
  requester_upi: { type: String, required: true },
  requester_account: { type: String },

  // Who receives the request (target - will pay if approved)
  target_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  target_upi: { type: String, required: true },
  target_account: { type: String },

  amount: { type: Number, required: true },
  description: { type: String, default: "" },

  status: {
    type: String,
    enum: ["PENDING", "APPROVED", "REJECTED", "EXPIRED", "FAILED"],
    default: "PENDING"
  },

  intent: {
    type: String,
    enum: ["SEND", "REQUEST"],
    required: true
  },

  // Fraud detection fields
  is_suspicious: { type: Boolean, default: false },
  suspicious_flags: [{ type: String }],
  risk_score: { type: Number, default: 0 },
  warning_acknowledged: { type: Boolean, default: false },

  // Message verification
  message_validated: { type: Boolean, default: false },
  message_sent_at: { type: Date },

  expires_at: { type: Date, required: true },
  processed_at: { type: Date },

  createdAt: { type: Date, default: Date.now },
});

upiCollectRequestSchema.index({ target_id: 1, status: 1 });
upiCollectRequestSchema.index({ requester_id: 1, status: 1 });
upiCollectRequestSchema.index({ expires_at: 1, status: 1 });

module.exports = mongoose.model("UPICollectRequest", upiCollectRequestSchema);