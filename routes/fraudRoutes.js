const express = require("express");
const router = express.Router();

const FraudAccount = require("../models/FraudAccount");
const Transaction = require("../models/Transaction");
const User = require("../models/User");

/* ======================================================
   FRAUD DASHBOARD STATS (TOP CARDS)
   GET /api/fraud/stats
====================================================== */
router.get("/stats", async (req, res) => {
  try {
    const suspiciousTransactions = await Transaction.countDocuments({
      is_fraud: true,
    });

    const flaggedUsers = await Transaction.distinct("user_id", {
      is_fraud: true,
    });

    const highRisk = await FraudAccount.countDocuments();

    res.json({
      highRisk,
      flaggedUsers: flaggedUsers.length,
      suspiciousTransactions,
    });
  } catch (err) {
    console.error("Fraud stats error:", err);
    res.status(500).json({ error: "Failed to load fraud stats" });
  }
});

/* ======================================================
   FRAUD ALERTS TABLE
   GET /api/fraud/alerts
====================================================== */
router.get("/alerts", async (req, res) => {
  try {
    const alerts = await Transaction.find({ is_fraud: true })
      .populate("user_id", "name accountNumber")
      .sort({ createdAt: -1 });

    res.json(alerts);
  } catch (err) {
    console.error("Fraud alerts error:", err);
    res.status(500).json({ error: "Failed to fetch fraud alerts" });
  }
});

/* ======================================================
   BLACKLISTED / REPORTED FRAUD ACCOUNTS
   GET /api/fraud/accounts
====================================================== */
router.get("/accounts", async (req, res) => {
  try {
    const accounts = await FraudAccount.find()
      .populate("reportedBy", "name accountNumber")
      .sort({ createdAt: -1 });

    res.json(accounts);
  } catch (err) {
    console.error("Fraud accounts error:", err);
    res.status(500).json({ error: "Failed to fetch fraud accounts" });
  }
});

/* ======================================================
   FREEZE USER ACCOUNT
   POST /api/fraud/freeze-user
   Body: { userId }
====================================================== */
router.post("/freeze-user", async (req, res) => {
  try {
    const { userId } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      { status: "Frozen" },
      { new: true }
    );

    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({
      message: "User frozen successfully",
      user,
    });
  } catch (err) {
    console.error("Freeze user error:", err);
    res.status(500).json({ error: "Failed to freeze user" });
  }
});

/* ======================================================
   UNFREEZE USER ACCOUNT
   POST /api/fraud/unfreeze-user
   Body: { userId }
====================================================== */
router.post("/unfreeze-user", async (req, res) => {
  try {
    const { userId } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      { status: "Active" },
      { new: true }
    );

    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({
      message: "User unfrozen successfully",
      user,
    });
  } catch (err) {
    console.error("Unfreeze user error:", err);
    res.status(500).json({ error: "Failed to unfreeze user" });
  }
});

/* ======================================================
   ESCALATE TRANSACTION (MARK HIGH RISK)
   POST /api/fraud/escalate
   Body: { transactionId }
====================================================== */
router.post("/escalate", async (req, res) => {
  try {
    const { transactionId } = req.body;

    const txn = await Transaction.findByIdAndUpdate(
      transactionId,
      {
        fraud_level: "HIGH",
        is_fraud: true,
      },
      { new: true }
    );

    if (!txn)
      return res.status(404).json({ error: "Transaction not found" });

    res.json({
      message: "Transaction escalated successfully",
      transaction: txn,
    });
  } catch (err) {
    console.error("Escalate fraud error:", err);
    res.status(500).json({ error: "Failed to escalate transaction" });
  }
});

module.exports = router;
