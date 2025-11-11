// routes/txnRoutes.js
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const auth = require("../middleware/auth");
const fraudList = require("../fraudList");
const router = express.Router();
const FraudAccount = require("../models/FraudAccount");

/**
 * Simple fraud detector (rule-based):
 * - amount > balance_before * 0.8  => suspicious (large)
 * - location_delta_km > 100       => suspicious (location jump)
 * - is_foreign_device == 1        => suspicious
 * - txns_last_24h > 10            => suspicious (too frequent)
 *
 * Returns { is_fraud: boolean, reason: string|null }
 */
function simpleFraudCheck({ amount, balance_before, location_delta_km, is_foreign_device, txns_last_24h }) {
  if (!balance_before || isNaN(balance_before)) balance_before = 0;
  if (amount > balance_before * 0.8 && balance_before > 0) return { is_fraud: true, reason: "Large txn relative to balance" };
  if (location_delta_km && location_delta_km > 100) return { is_fraud: true, reason: "Location jump" };
  if (is_foreign_device && is_foreign_device === 1) return { is_fraud: true, reason: "Foreign device" };
  if (txns_last_24h && txns_last_24h > 10) return { is_fraud: true, reason: "Too many txns in 24h" };
  return { is_fraud: false, reason: null };
}

/**
 * POST /api/txns/send
 * Protected: requires JWT. Body must include to_account, ifsc, beneficiary_name, amount, optional meta fields.
 */
router.post("/send", auth, async (req, res) => {
  try {
    const user = req.user;
    const { to_account, ifsc, beneficiary_name, amount } = req.body;

    if (!to_account || !ifsc || !amount)
      return res.status(400).json({ error: "Missing transaction details" });

    const amt = Number(amount);
    if (amt <= 0) return res.status(400).json({ error: "Invalid amount" });

    // ✅ Step 1: Check against known fraud accounts
    const blacklisted = await FraudAccount.findOne({ accountNumber: to_account });
    if (blacklisted) {
      return res.json({
        message: "🚨 Fraudulent account detected from DB",
        is_fraud: true,
        txn_blocked: true,
        fraud_reason: "Account reported by users",
        balance_before: user.balance,
        balance_after: user.balance,
      });
    }

    // ✅ Step 2: Check balance
    if (user.balance < amt)
      return res.status(400).json({ error: "Insufficient balance" });

    // ✅ Step 3: Normal transaction
    const balance_before = user.balance;
    const balance_after = +(balance_before - amt).toFixed(2);

    const txn = new Transaction({
      txn_id: `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      user_id: user._id,
      to_account,
      ifsc,
      beneficiary_name,
      amount: amt,
      balance_before,
      balance_after,
      is_fraud: false,
    });

    await txn.save();
    user.balance = balance_after;
    user.transactionsCount = (user.transactionsCount || 0) + 1;
    await user.save();

    res.json({
      message: "Transaction successful",
      txn_id: txn.txn_id,
      balance_before,
      balance_after,
      is_fraud: false,
    });
  } catch (err) {
    console.error("Send txn error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/txns/history
 * Return transaction history for the logged-in user (most recent first).
 * Protected.
 */
router.get("/history", auth, async (req, res) => {
  try {
    const user = req.user;
    const txns = await Transaction.find({ user_id: user._id }).sort({ createdAt: -1 }).limit(200);
    res.json(txns);
  } catch (err) {
    console.error("History error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/txns/alerts
 * Return only suspicious/fraud transactions for the user.
 */
router.get("/alerts", auth, async (req, res) => {
  try {
    const user = req.user;
    const alerts = await Transaction.find({ user_id: user._id, is_fraud: true }).sort({ createdAt: -1 });
    res.json(alerts);
  } catch (err) {
    console.error("Alerts error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/txns/seed-fraud
 * For demo: seeds ~10 fraudulent transactions for the logged-in user.
 * Protected. Creates mix of flagged txns (large amount/location jump/foreign).
 */
router.post("/seed-fraud", auth, async (req, res) => {
  try {
    const user = req.user;
    const seeds = [];
    const nowBal = user.balance || 5000;
    let currentBal = nowBal;

    for (let i = 0; i < 10; i++) {
      const type = i % 3;
      let amount, location_delta_km, is_foreign_device, reason;
      if (type === 0) {
        // Large relative amount
        amount = Math.floor(currentBal * (0.85 + Math.random() * 0.1)); // 85-95% of balance
        location_delta_km = Math.floor(Math.random() * 5);
        is_foreign_device = 0;
        reason = "Large txn relative to balance";
      } else if (type === 1) {
        amount = Math.floor(500 + Math.random() * 1500);
        location_delta_km = 150 + Math.floor(Math.random() * 500); // big jump
        is_foreign_device = 0;
        reason = "Location jump";
      } else {
        amount = Math.floor(300 + Math.random() * 2000);
        location_delta_km = Math.floor(Math.random() * 30);
        is_foreign_device = 1;
        reason = "Foreign device";
      }

      if (amount > currentBal) amount = Math.floor(currentBal * 0.9); // ensure possible
      const balance_before = currentBal;
      const balance_after = +(currentBal - amount).toFixed(2);
      currentBal = balance_after;

      const txn = new Transaction({
        txn_id: `SEED-${Date.now()}-${i}`,
        user_id: user._id,
        to_account: `BEN${Math.floor(Math.random() * 10000)}`,
        ifsc: "SEED0000",
        beneficiary_name: "Seed Beneficiary",
        amount,
        balance_before,
        balance_after,
        hour: new Date().getHours(),
        day: new Date().getDay(),
        txns_last_24h: 20,
        avg_amount_7d: 2000,
        location_delta_km,
        is_foreign_device,
        is_fraud: true,
        fraud_reason: reason
      });
      seeds.push(txn);
    }

    // Save all and update user balance
    await Transaction.insertMany(seeds);
    user.balance = currentBal;
    user.transactionsCount = (user.transactionsCount || 0) + seeds.length;
    await user.save();

    res.json({ message: `Seeded ${seeds.length} suspicious transactions`, currentBalance: user.balance });
  } catch (err) {
    console.error("Seed fraud error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/balance", auth, async (req, res) => {
  try {
    const user = req.user;

    // Fetch last 5 transactions
    const recentTxns = await Transaction.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      name: user.name,
      aadhaarNumber: user.aadhaarNumber,
      balance: user.balance,
      recent: recentTxns.map((txn) => ({
        txn_id: txn.txn_id,
        amount: txn.amount,
        type: txn.type,
        createdAt: txn.createdAt,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch balance data" });
  }
});

// POST /api/txns/report
router.post("/report", auth, async (req, res) => {
  try {
    const { accountNumber, ifsc, reason } = req.body;
    if (!accountNumber) return res.status(400).json({ error: "Account number required" });

    const existing = await FraudAccount.findOne({ accountNumber });
    if (existing) return res.json({ message: "Account already reported" });

    const report = new FraudAccount({
      accountNumber,
      ifsc,
      reason,
      reportedBy: req.user._id,
    });
    await report.save();

    res.json({ message: "Fraudulent account reported successfully" });
  } catch (err) {
    console.error("Fraud report error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


module.exports = router;
