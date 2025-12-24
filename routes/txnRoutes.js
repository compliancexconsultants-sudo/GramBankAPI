// routes/txnRoutes.js
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const Otp = require("../models/Otp"); // new: OTP model
const auth = require("../middleware/auth");
const router = express.Router();
const FraudAccount = require("../models/FraudAccount");
const accountSid = process.env.TWILIO_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const messagingServiceSid = process.env.TWILIO_MSG_SID;
const twilioClient = require("twilio")(accountSid, authToken);

// ---- Helper: simple fraud rules ----
function simpleFraudCheck({ amount, balance_before, location_delta_km, is_foreign_device, txns_last_24h }) {
  if (!balance_before || isNaN(balance_before)) balance_before = 0;
  if (amount > balance_before * 0.8 && balance_before > 0) return { is_fraud: true, reason: "Large txn relative to balance" };
  if (location_delta_km && location_delta_km > 100) return { is_fraud: true, reason: "Location jump" };
  if (is_foreign_device && is_foreign_device === 1) return { is_fraud: true, reason: "Foreign device" };
  if (txns_last_24h && txns_last_24h > 10) return { is_fraud: true, reason: "Too many txns in 24h" };
  return { is_fraud: false, reason: null };
}

// ---- Utility: mask account show last 4 digits ----
function maskAccount(acc) {
  if (!acc) return "****";
  const s = acc.toString();
  const last4 = s.slice(-4);
  return "****" + last4;
}

// ---- Ensure phone in E.164 (simple +91 fallback) ----
function formatPhone(phone) {
  if (!phone) return phone;
  if (phone.startsWith("+")) return phone;
  // default to India if 10-digit number
  if (/^\d{10}$/.test(phone)) return "+91" + phone;
  return phone;
}

/**
 * POST /api/txns/send-otp
 * Protected. Sends OTP to user's registered phone (or phone passed in body).
 */
router.post("/send-otp", auth, async (req, res) => {
  try {
    const user = req.user;
    // allow client override phone (if you stored phone separately in AsyncStorage)
    let { phone } = req.body;
    phone = phone || user.phone || user.mobile || user.phoneNumber;

    if (!phone) return res.status(400).json({ error: "No phone number available to send OTP" });

    const formattedPhone = formatPhone(phone);

    // generate 4-digit OTP
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // save OTP record
    await Otp.create({ phone: formattedPhone, code, expiresAt });

    // send via Twilio
    try {
      await twilioClient.messages.create({
        to: formattedPhone,
        body: `Your GramBank transaction OTP is ${code}. It will expire in 5 minutes.`,
        from: '+13326997688',
      });
      return res.json({ message: "OTP sent successfully", otp: code });
    } catch (smsErr) {
      console.error("Twilio send error:", smsErr);
      // return success with otp for dev fallback (remove in prod)
      return res.json({ message: "OTP generated (SMS failed)", otp: code });
    }
  } catch (err) {
    console.error("Send txn OTP error:", err);
    res.status(500).json({ error: "Failed to send transaction OTP" });
  }
});

/**
 * POST /api/txns/send
 * Protected. Body: { to_account, ifsc, beneficiary_name, amount, otp, phone(optional) }
 * Verifies OTP then processes transaction. Sends debit SMS on success.
 */
router.post("/send", auth, async (req, res) => {
  try {
    const user = req.user;
    const { to_account, ifsc, beneficiary_name, amount, otp, phone } = req.body;


    if (!to_account || !ifsc || !amount) return res.status(400).json({ error: "Missing transaction details" });
    const amt = Number(amount);
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: "Invalid amount" });

    // ---- Verify OTP ----
    const phoneToCheck = formatPhone(phone || user.phone || user.mobile || user.phoneNumber);
    if (!otp) return res.status(400).json({ error: "OTP required" });

    const otpRecord = await Otp.findOne({ phone: phoneToCheck }).sort({ createdAt: -1 });
    if (!otpRecord) return res.status(400).json({ error: "No OTP found for this phone" });
    if (otpRecord.expiresAt < new Date()) return res.status(400).json({ error: "OTP expired" });
    if (otpRecord.code !== otp) return res.status(400).json({ error: "Invalid OTP" });

    // ---- Check fraud blacklist by account ----
    const blacklisted = await FraudAccount.findOne({ accountNumber: to_account });
    if (blacklisted) {
      // alert user via SMS about blocked txn (optional)
      try {
        const msg = `Alert: A transfer to account ${maskAccount(to_account)} has been blocked for safety. If this was not you, contact GramBank immediately.`;
        const sendMessage = await twilioClient.messages.create({
          to: phoneToCheck, body: msg, from: '+13326997688',
        });
      } catch (e) {
        console.error("Twilio alert error:", e);
      }

      return res.json({
        message: "🚨 Fraudulent account detected from DB",
        is_fraud: true,
        txn_blocked: true,
        fraud_reason: "Account reported by users",
        balance_before: user.balance,
        balance_after: user.balance,
      });
    }

    // ---- Check sufficient balance ----
    if (user.balance < amt) return res.status(400).json({ error: "Insufficient balance" });

    // ---- Basic fraud rules (extendable) ----
    const balance_before = user.balance;
    const fraudCheck = simpleFraudCheck({ amount: amt, balance_before });
    if (fraudCheck.is_fraud) {
      // create a flagged transaction but do NOT perform debit if you want to block large txns
      const flaggedTxn = new Transaction({
        txn_id: `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        user_id: user._id,
        to_account,
        ifsc,
        beneficiary_name,
        amount: amt,
        balance_before,
        balance_after: balance_before, // no deduction if blocked
        is_fraud: true,
        fraud_reason: fraudCheck.reason,
      });
      await flaggedTxn.save();
      let messageSended
      // optional: send alert SMS to user indicating txn flagged
      try {
        const alertMsg = `⚠️ GramBank Alert: A ${fraudCheck.reason} transaction of ₹${amt.toFixed(2)} to ${maskAccount(to_account)} was flagged and blocked. Available balance: ₹${balance_before.toFixed(2)}.`;
        messageSended = await twilioClient.messages.create({
          to: phoneToCheck, body: alertMsg, from: '+13326997688',
        });
      } catch (e) {
        console.error("Twilio alert error:", e);
      }

      return res.json({
        message: "Transaction flagged as suspicious",
        is_fraud: true,
        txn_blocked: true,
        fraud_reason: fraudCheck.reason,
        balance_before,
        balance_after: balance_before,
        messageSended: messageSended ? messageSended.sid : 'twilio error'
      });
    }

    // ---- Proceed with normal transaction: debit and save ----
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

    // update user balance
    user.balance = balance_after;
    user.transactionsCount = (user.transactionsCount || 0) + 1;
    await user.save();

    const receiver = await User.findOne({ accountNumber: to_account });

    if (receiver) {
      const receiver_balance_before = receiver.balance;
      const receiver_balance_after = +(receiver.balance + amt).toFixed(2);

      receiver.balance = receiver_balance_after;
      receiver.transactionsCount = (receiver.transactionsCount || 0) + 1;
      await receiver.save();

      // Create credit-side transaction
      const creditTxn = new Transaction({
        txn_id: `${txn.txn_id}-CREDIT`,
        user_id: receiver._id,
        from_account: user.accountNumber,
        to_account: receiver.accountNumber,   // <-- ADD THIS
        amount: amt,
        balance_before: receiver_balance_before,
        balance_after: receiver_balance_after,
        is_fraud: false,
        type: "CREDIT",
      });
      await creditTxn.save();

      // Optional receiver SMS
      try {
        const phoneNumber = formatPhone(receiver.phoneNumber)
        const creditMsg = `GramBank: Your A/c ${maskAccount(
          receiver.accountNumber
        )} credited ₹${amt.toFixed(2)} from ${maskAccount(user.accountNumber)}. Avl bal ₹${receiver_balance_after.toFixed(2)}.`;
        await twilioClient.messages.create({
          to: phoneNumber,
          body: creditMsg,
          from: "+13326997688",
        });
      } catch (e) {
        console.error("Receiver SMS error:", e);
      }
    }

    let messageBody
    // ---- Send bank-style debit SMS to user ----
    try {
      const smsBody = `GramBank: Your A/c ${maskAccount(user.accountNumber || user._id)} debited ₹${amt.toFixed(2)} to ${beneficiary_name || maskAccount(to_account)} A/c ${maskAccount(to_account)}. Avl bal ₹${balance_after.toFixed(2)}. - GramBank`;
      messageBody = await twilioClient.messages.create({
        to: phoneToCheck, body: smsBody, from: '+13326997688',
      });
    } catch (smsErr) {
      console.error("Twilio debit SMS error:", smsErr);
    }

    return res.json({
      message: "Transaction successful",
      txn_id: txn.txn_id,
      balance_before,
      balance_after,
      is_fraud: false,
      messageBody: messageBody ? messageBody?.sid : null
    });
  } catch (err) {
    console.error("Send txn error:", err);
    res.status(500).json({ error: "Server error" });
  }
});
/**
 * POST /api/txns/upi/send
 * Body: { upiId, amount, otp, phone(optional) }
 */
router.post("/upi/send", auth, async (req, res) => {
  try {
    const user = req.user;
    const { upiId, amount, otp, phone } = req.body;

    if (!upiId || !amount) return res.status(400).json({ error: "UPI ID & Amount required" });

    const amt = Number(amount);
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: "Invalid amount" });

    // ---------- OTP VERIFY ----------
    const phoneToCheck = formatPhone(phone || user.phoneNumber);
    if (!otp) return res.status(400).json({ error: "OTP required" });

    const otpRecord = await Otp.findOne({ phone: phoneToCheck }).sort({ createdAt: -1 });
    if (!otpRecord) return res.status(400).json({ error: "No OTP found for this phone" });
    if (otpRecord.expiresAt < new Date()) return res.status(400).json({ error: "OTP expired" });
    if (otpRecord.code !== otp) return res.status(400).json({ error: "Invalid OTP" });

    // ---------- FIND RECEIVER ----------
    const receiver = await User.findOne({ upiId });
    if (!receiver) return res.status(404).json({ error: "Receiver UPI not found" });

    // ---------- BALANCE CHECK ----------
    if (user.balance < amt) return res.status(400).json({ error: "Insufficient balance" });

    const balance_before = user.balance;
    const balance_after = +(balance_before - amt).toFixed(2);

    // ---------- FRAUD RULES ----------
    const fraudCheck = simpleFraudCheck({ amount: amt, balance_before });
    if (fraudCheck.is_fraud) {
      await Transaction.create({
        txn_id: `UPI-${Date.now()}`,
        user_id: user._id,
        to_upi: upiId,
        amount: amt,
        balance_before,
        balance_after: balance_before,
        is_fraud: true,
        fraud_reason: fraudCheck.reason
      });

      return res.json({
        message: "UPI transaction flagged",
        is_fraud: true,
        txn_blocked: true,
        fraud_reason: fraudCheck.reason
      });
    }

    // ---------- DEBIT ----------
    const txnId = `UPI-${Date.now()}`;
    await Transaction.create({
      txn_id: txnId,
      user_id: user._id,
      to_upi: upiId,
      amount: amt,
      balance_before,
      balance_after,
      is_fraud: false,
      type: "DEBIT"
    });

    user.balance = balance_after;
    user.transactionsCount += 1;
    await user.save();

    // ---------- CREDIT ----------
    const r_before = receiver.balance;
    const r_after = +(receiver.balance + amt).toFixed(2);

    await Transaction.create({
      txn_id: `${txnId}-CREDIT`,
      user_id: receiver._id,
      from_account: user.accountNumber,
      to_upi: receiver.upiId,
      amount: amt,
      balance_before: r_before,
      balance_after: r_after,
      is_fraud: false,
      type: "CREDIT"
    });

    receiver.balance = r_after;
    receiver.transactionsCount += 1;
    await receiver.save();

    // ---------- SMS ----------
    try {
      await twilioClient.messages.create({
        to: phoneToCheck,
        body: `GramBank: ₹${amt} debited via UPI to ${upiId}. Avl bal ₹${balance_after}.`,
        from: "+13326997688",
      });

      await twilioClient.messages.create({
        to: formatPhone(receiver.phoneNumber),
        body: `GramBank: ₹${amt} credited to your account via UPI from ${maskAccount(user.accountNumber)}. Avl bal ₹${r_after}.`,
        from: "+13326997688",
      });
    } catch (e) {
      console.error("SMS error:", e);
    }

    return res.json({
      message: "UPI Transaction Successful",
      txn_id: txnId,
      balance_before,
      balance_after,
      receiver: receiver.upiId
    });

  } catch (err) {
    console.error("UPI send error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


/* History, alerts, seed-fraud, balance, report routes — leave as before (no changes) */
/* You already had these; re-add them unchanged below or keep existing ones in file. */

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
        amount = Math.floor(currentBal * (0.85 + Math.random() * 0.1));
        location_delta_km = Math.floor(Math.random() * 5);
        is_foreign_device = 0;
        reason = "Large txn relative to balance";
      } else if (type === 1) {
        amount = Math.floor(500 + Math.random() * 1500);
        location_delta_km = 150 + Math.floor(Math.random() * 500);
        is_foreign_device = 0;
        reason = "Location jump";
      } else {
        amount = Math.floor(300 + Math.random() * 2000);
        location_delta_km = Math.floor(Math.random() * 30);
        is_foreign_device = 1;
        reason = "Foreign device";
      }

      if (amount > currentBal) amount = Math.floor(currentBal * 0.9);
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

    const recentTxns = await Transaction.find({ user_id: user._id })
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      name: user.name,
      aadhaarNumber: user.aadhaarNumber,
      balance: user.balance,
      upiId: user.upiId,        // ⭐ Added
      upiQR: user.upiQR,        // ⭐ Added
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
