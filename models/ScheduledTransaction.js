const mongoose = require("mongoose");

const scheduledTxnSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  txn_id: { type: String, required: true, unique: true },

  to_account: { type: String },
  to_upi: { type: String },
  from_account: { type: String },
  ifsc: { type: String },
  beneficiary_name: { type: String },

  amount: { type: Number, required: true },
  balance_before: { type: Number, required: true },
  balance_after: { type: Number, required: true },

  type: { type: String, enum: ["DEBIT", "CREDIT"], required: true },

  status: {
    type: String,
    enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED", "EXPIRED"],
    default: "PENDING"
  },

  scheduled_at: { type: Date, required: true },
  processed_at: { type: Date },

  delay_reason: { type: String, default: null },

  fraud_check_passed: { type: Boolean, default: true },

  createdAt: { type: Date, default: Date.now },
});

scheduledTxnSchema.index({ scheduled_at: 1, status: 1 });
scheduledTxnSchema.index({ user_id: 1, status: 1 });

module.exports = mongoose.model("ScheduledTransaction", scheduledTxnSchema);