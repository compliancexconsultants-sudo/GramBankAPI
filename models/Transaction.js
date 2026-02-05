const mongoose = require("mongoose");

const txnSchema = new mongoose.Schema({
  txn_id: { type: String, required: true, unique: true },

  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  // ---- DESTINATION ----
  to_account: { type: String },        // bank account
  to_upi: { type: String },            // UPI ID
  from_account: { type: String },

  ifsc: { type: String },
  beneficiary_name: { type: String },

  // ---- MONEY ----
  amount: { type: Number, required: true },
  balance_before: { type: Number, required: true },
  balance_after: { type: Number, required: true },

  // ---- META ----
  type: { type: String, enum: ["DEBIT", "CREDIT"], required: true },

  hour: Number,
  day: Number,
  txns_last_24h: Number,
  avg_amount_7d: Number,
  location_delta_km: Number,
  is_foreign_device: { type: Number, default: 0 },

  // ---- FRAUD ----
  is_fraud: { type: Boolean, default: false },
  fraud_reason: { type: String, default: null },

  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Transaction", txnSchema);
