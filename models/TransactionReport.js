const mongoose = require("mongoose");

const transactionReportSchema = new mongoose.Schema({
  transaction_id: { type: String, required: true },
  txn_id: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction" },
  reporter_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  
  report_type: {
    type: String,
    enum: ["UNAUTHORIZED", "WRONG_RECIPIENT", "DUPLICATE", "NOT_RECEIVED", "OTHER", "FRAUD"],
    required: true
  },
  
  description: { type: String },
  amount: { type: Number },
  beneficiary_account: { type: String },
  beneficiary_upi: { type: String },
  transaction_date: { type: Date },
  
  status: {
    type: String,
    enum: ["PENDING", "UNDER_REVIEW", "RESOLVED", "REJECTED"],
    default: "PENDING"
  },
  
  resolution: { type: String },
  resolved_at: { type: Date },
  resolved_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  
  createdAt: { type: Date, default: Date.now },
});

transactionReportSchema.index({ transaction_id: 1 });
transactionReportSchema.index({ reporter_id: 1, status: 1 });

module.exports = mongoose.model("TransactionReport", transactionReportSchema);