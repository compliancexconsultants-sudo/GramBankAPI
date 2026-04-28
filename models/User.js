// models/User.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },

  aadhaarNumber: {
    type: String,
    required: true,
    unique: true,
    match: /^\d{12}$/
  },

  panNumber: {
    type: String,
    required: true,
    match: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/
  },

  mpinHash: { type: String, required: true },

  balance: { type: Number, default: 15000 },
  transactionsCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },

  accountNumber: {
    type: String,
    required: true,
    unique: true
  },
  status: {
    type: String,
    enum: ["ACTIVE", "FROZEN"],
    default: "ACTIVE"
  },

  phoneNumber: {
    type: String,
    required: true,
    unique: true,
    match: /^[6-9]\d{9}$/
  },

  // ⭐ NEW FIELDS
  upiId: {
    type: String,
    required: true,
    unique: true
  },

  upiQR: {
    type: String,
    required: true // IMGBB hosted QR URL
  }
});

module.exports = mongoose.model("User", userSchema);
