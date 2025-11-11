// models/FraudAccount.js
const mongoose = require("mongoose");

const fraudAccountSchema = new mongoose.Schema({
  accountNumber: { type: String, required: true, unique: true },
  ifsc: { type: String },
  reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  reason: { type: String, default: "User reported fraudulent activity" },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("FraudAccount", fraudAccountSchema);
