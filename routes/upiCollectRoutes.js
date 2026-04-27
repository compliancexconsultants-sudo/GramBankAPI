const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const UPICollectRequest = require("../models/UPICollectRequest");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const FraudAccount = require("../models/FraudAccount");
const Otp = require("../models/Otp");
const { v4: uuidv4 } = require("uuid");
const accountSid = process.env.TWILIO_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioClient = require("twilio")(accountSid, authToken);

const MAX_REQUEST_AMOUNT = 100000;
const SUSPICIOUS_AMOUNT = 50000;
const REQUEST_EXPIRY_HOURS = 24;

function maskAccount(acc) {
  if (!acc) return "****";
  return "****" + acc.toString().slice(-4);
}

function formatPhone(phone) {
  if (!phone) return phone;
  if (phone.startsWith("+")) return phone;
  if (/^\d{10}$/.test(phone)) return "+91" + phone;
  return phone;
}

function isKnownRequester(requesterId, targetId) {
  return requesterId.toString() === targetId.toString();
}

async function checkSuspiciousRequest(requester, target, amount) {
  const flags = [];
  let riskScore = 0;
  let isSuspicious = false;

  const requesterUser = await User.findById(requester);
  const isKnown = isKnownRequester(requester, target);

  if (!isKnown) {
    flags.push("UNKNOWN_REQUESTER");
    riskScore += 30;
    isSuspicious = true;
  }

  const blacklistedRequester = await FraudAccount.findOne({ 
    $or: [
      { accountNumber: requesterUser?.accountNumber },
      { upiId: requesterUser?.upiId }
    ]
  });
  
  if (blacklistedRequester) {
    flags.push("BLACKLISTED_REQUESTER");
    riskScore += 50;
    isSuspicious = true;
  }

  if (amount > SUSPICIOUS_AMOUNT) {
    flags.push("HIGH_VALUE_REQUEST");
    riskScore += 25;
    isSuspicious = true;
  }

  if (amount > MAX_REQUEST_AMOUNT) {
    flags.push("EXCESSIVE_AMOUNT");
    riskScore += 40;
    isSuspicious = true;
  }

  const recentRequests = await UPICollectRequest.countDocuments({
    requester_id: requester,
    status: "PENDING",
    createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
  });

  if (recentRequests > 5) {
    flags.push("RAPID_REQUEST_PATTERN");
    riskScore += 20;
    isSuspicious = true;
  }

  return { isSuspicious, flags, riskScore };
}

router.post("/create", auth, async (req, res) => {
  try {
    const requester = req.user;
    const { target_upi, amount, description, intent } = req.body;

    if (!target_upi || !amount || !intent) {
      return res.status(400).json({ error: "Target UPI, amount, and intent required" });
    }

    if (!["SEND", "REQUEST"].includes(intent)) {
      return res.status(400).json({ error: "Invalid intent" });
    }

    const amt = Number(amount);
    if (isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const target = await User.findOne({ upiId: target_upi });
    if (!target) {
      return res.status(404).json({ error: "Target UPI not found" });
    }

    if (target._id.toString() === requester._id.toString()) {
      return res.status(400).json({ error: "Cannot create request for yourself" });
    }

    const fraudAnalysis = await checkSuspiciousRequest(
      requester._id,
      target._id,
      amt
    );

    const expiresAt = new Date(Date.now() + REQUEST_EXPIRY_HOURS * 60 * 60 * 1000);

    const collectRequest = await UPICollectRequest.create({
      request_id: `UPI-COLLECT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      requester_id: requester._id,
      requester_name: requester.name,
      requester_upi: requester.upiId,
      requester_account: requester.accountNumber,
      target_id: target._id,
      target_upi: target_upi,
      target_account: target.accountNumber,
      amount: amt,
      description: description || "",
      intent,
      is_suspicious: fraudAnalysis.isSuspicious,
      suspicious_flags: fraudAnalysis.flags,
      risk_score: fraudAnalysis.riskScore,
      expires_at: expiresAt
    });

    try {
      const notifyMsg = `GramBank: You have a UPI ${intent === "REQUEST" ? "payment request" : "send request"} of ₹${amt} from ${requester.name}. ${fraudAnalysis.isSuspicious ? "⚠️ This request has been flagged for review." : ""}`;
      await twilioClient.messages.create({
        to: formatPhone(target.phoneNumber),
        body: notifyMsg,
        from: "+17542900474"
      });
    } catch (e) {
      console.error("SMS notification error:", e);
    }

    res.status(201).json({
      message: "UPI collect request created",
      request_id: collectRequest.request_id,
      is_suspicious: fraudAnalysis.isSuspicious,
      risk_score: fraudAnalysis.riskScore,
      flags: fraudAnalysis.flags
    });
  } catch (err) {
    console.error("Create collect request error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/incoming", auth, async (req, res) => {
  try {
    const user = req.user;

    const requests = await UPICollectRequest.find({
      target_id: user._id,
      status: "PENDING",
      expires_at: { $gt: new Date() }
    })
      .select("-__v")
      .sort({ createdAt: -1 });

    res.json({
      count: requests.length,
      requests: requests.map(r => ({
        request_id: r.request_id,
        intent: r.intent,
        intent_display: r.intent === "SEND" ? "SEND MONEY" : "REQUEST PAYMENT",
        intent_description: r.intent === "SEND" 
          ? `You will SEND ₹${r.amount} to ${r.requester_name}` 
          : `You will RECEIVE ₹${r.amount} from ${r.requester_name}`,
        amount: r.amount,
        description: r.description,
        requester_name: r.requester_name,
        requester_upi: r.requester_upi,
        is_suspicious: r.is_suspicious,
        suspicious_flags: r.suspicious_flags,
        risk_score: r.risk_score,
        warning_acknowledged: r.warning_acknowledged,
        createdAt: r.createdAt,
        expires_at: r.expires_at
      }))
    });
  } catch (err) {
    console.error("Fetch incoming requests error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/sent", auth, async (req, res) => {
  try {
    const user = req.user;

    const requests = await UPICollectRequest.find({
      requester_id: user._id
    })
      .select("-__v")
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      count: requests.length,
      requests: requests.map(r => ({
        request_id: r.request_id,
        intent: r.intent,
        intent_display: r.intent === "SEND" ? "SEND MONEY" : "REQUEST PAYMENT",
        amount: r.amount,
        description: r.description,
        target_name: r.target_upi.split("@")[0],
        target_upi: r.target_upi,
        status: r.status,
        is_suspicious: r.is_suspicious,
        createdAt: r.createdAt,
        expires_at: r.expires_at
      }))
    });
  } catch (err) {
    console.error("Fetch sent requests error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/acknowledge-warning", auth, async (req, res) => {
  try {
    const { request_id } = req.body;
    const user = req.user;

    const request = await UPICollectRequest.findOne({
      request_id,
      target_id: user._id,
      status: "PENDING"
    });

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    request.warning_acknowledged = true;
    await request.save();

    res.json({ message: "Warning acknowledged" });
  } catch (err) {
    console.error("Acknowledge warning error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/send-otp", auth, async (req, res) => {
  try {
    const { request_id } = req.body;
    const user = req.user;

    const request = await UPICollectRequest.findOne({
      request_id,
      target_id: user._id,
      status: "PENDING"
    });

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    if (new Date() > request.expires_at) {
      request.status = "EXPIRED";
      await request.save();
      return res.status(400).json({ error: "Request has expired" });
    }

    const phone = user.phoneNumber;
    if (!phone) {
      return res.status(400).json({ error: "No phone number on file" });
    }

    const formattedPhone = formatPhone(phone);
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await Otp.create({ phone: formattedPhone, code, expiresAt });

    const actionWord = request.intent === "SEND" ? "SEND" : "RECEIVE";
    try {
      await twilioClient.messages.create({
        to: formattedPhone,
        body: `Your GramBank OTP for ${actionWord} request ₹${request.amount} is ${code}. Valid for 5 mins.`,
        from: "+17542900474"
      });
      return res.json({ message: "OTP sent", otp: code });
    } catch (smsErr) {
      console.error("Twilio error:", smsErr);
      return res.json({ message: "OTP generated (SMS failed)", otp: code });
    }
  } catch (err) {
    console.error("Send OTP error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/respond", auth, async (req, res) => {
  try {
    const { request_id, action, otp } = req.body;
    const user = req.user;

    if (!request_id || !action) {
      return res.status(400).json({ error: "Request ID and action required" });
    }

    if (!["APPROVE", "REJECT"].includes(action)) {
      return res.status(400).json({ error: "Invalid action" });
    }

    const request = await UPICollectRequest.findOne({
      request_id,
      target_id: user._id,
      status: "PENDING"
    });

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    if (new Date() > request.expires_at) {
      request.status = "EXPIRED";
      await request.save();
      return res.status(400).json({ error: "Request has expired" });
    }

    if (action === "REJECT") {
      request.status = "REJECTED";
      request.processed_at = new Date();
      await request.save();

      try {
        const rejectMsg = `GramBank: Your ${request.intent === "SEND" ? "send" : "payment"} request of ₹${request.amount} to ${request.target_name || maskAccount(request.target_upi)} was REJECTED.`;
        await twilioClient.messages.create({
          to: formatPhone(request.requester_id?.phoneNumber),
          body: rejectMsg,
          from: "+17542900474"
        });
      } catch (e) {
        console.error("SMS error:", e);
      }

      return res.json({
        message: "Request rejected",
        request_id: request.request_id,
        status: "REJECTED"
      });
    }

    if (action === "APPROVE") {
      const phoneToCheck = formatPhone(user.phoneNumber);
      
      if (!otp) {
        return res.status(400).json({ error: "OTP required to approve" });
      }

      const otpRecord = await Otp.findOne({ phone: phoneToCheck }).sort({ createdAt: -1 });
      if (!otpRecord) {
        return res.status(400).json({ error: "No OTP found" });
      }
      if (otpRecord.expiresAt < new Date()) {
        return res.status(400).json({ error: "OTP expired" });
      }
      if (otpRecord.code !== otp) {
        return res.status(400).json({ error: "Invalid OTP" });
      }

      const isSendMoney = request.intent === "SEND";
      const amount = request.amount;

      if (isSendMoney) {
        if (user.balance < amount) {
          request.status = "FAILED";
          request.processed_at = new Date();
          await request.save();
          return res.status(400).json({ error: "Insufficient balance" });
        }

        const balance_before = user.balance;
        const balance_after = +(balance_before - amount).toFixed(2);

        const txn = await Transaction.create({
          txn_id: `UPI-COLLECT-${Date.now()}`,
          user_id: user._id,
          to_account: request.requester_account,
          to_upi: request.requester_upi,
          amount,
          balance_before,
          balance_after,
          type: "DEBIT",
          is_fraud: request.is_suspicious,
          fraud_reason: request.is_suspicious ? request.suspicious_flags.join(", ") : null,
          is_suspicious: request.is_suspicious,
          suspicious_flags: request.suspicious_flags,
          risk_score: request.risk_score
        });

        user.balance = balance_after;
        user.transactionsCount = (user.transactionsCount || 0) + 1;
        await user.save();

        const requester = await User.findById(request.requester_id);
        if (requester) {
          const r_before = requester.balance;
          const r_after = +(requester.balance + amount).toFixed(2);

          await Transaction.create({
            txn_id: `${txn.txn_id}-CREDIT`,
            user_id: requester._id,
            from_account: user.accountNumber,
            to_account: requester.accountNumber,
            amount,
            balance_before: r_before,
            balance_after: r_after,
            type: "CREDIT"
          });

          requester.balance = r_after;
          requester.transactionsCount = (requester.transactionsCount || 0) + 1;
          await requester.save();

          try {
            await twilioClient.messages.create({
              to: formatPhone(requester.phoneNumber),
              body: `GramBank: Your A/c ${maskAccount(requester.accountNumber)} credited ₹${amount} from ${maskAccount(user.accountNumber)}. Avl bal ₹${r_after}.`,
              from: "+17542900474"
            });
          } catch (e) {
            console.error("SMS error:", e);
          }
        }

        try {
          await twilioClient.messages.create({
            to: phoneToCheck,
            body: `GramBank: Your A/c ${maskAccount(user.accountNumber)} debited ₹${amount} to ${request.requester_name}. Avl bal ₹${balance_after}. - GramBank`,
            from: "+17542900474"
          });
        } catch (e) {
          console.error("SMS error:", e);
        }

        request.status = "APPROVED";
        request.processed_at = new Date();
        await request.save();

        return res.json({
          message: "Money sent successfully",
          request_id: request.request_id,
          status: "APPROVED",
          txn_id: txn.txn_id,
          balance_before,
          balance_after,
          amount_sent: amount,
          sent_to: request.requester_name
        });

      } else {
        request.status = "APPROVED";
        request.processed_at = new Date();
        await request.save();

        try {
          await twilioClient.messages.create({
            to: formatPhone(request.requester_id?.phoneNumber),
            body: `GramBank: Your payment request of ₹${amount} was approved by ${user.name}.`,
            from: "+17542900474"
          });
        } catch (e) {
          console.error("SMS error:", e);
        }

        return res.json({
          message: "Request approved - payment request sent to requester",
          request_id: request.request_id,
          status: "APPROVED",
          amount_requested: amount,
          requester: request.requester_name
        });
      }
    }
  } catch (err) {
    console.error("Respond to collect request error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;