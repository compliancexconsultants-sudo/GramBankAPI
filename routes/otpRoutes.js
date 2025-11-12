const express = require("express");
const router = express.Router();
const Otp = require("../models/Otp");
const axios = require("axios");
// Send OTP (simulated)
router.post("/send", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone is required" });

    // Generate 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Save in DB
    await Otp.create({ phone, otp, expiresAt });

    // Send OTP using Textbelt (from backend — no CORS issue)
    const smsRes = await axios.post("https://textbelt.com/text", {
      phone,
      message: `Your GramBank verification code is ${otp}. It expires in 5 minutes.`,
      key: "textbelt", // ⚠️ Free key (1 SMS/day)
    });

    if (smsRes.data.success) {
      res.json({ message: "OTP sent successfully" });
    } else {
      console.log("Textbelt error:", smsRes.data);
      res.json({ message: "OTP generated (SMS failed)", otp }); // fallback
    }
  } catch (err) {
    console.error("OTP Send Error:", err);
    res.status(500).json({ error: "Failed to send OTP" });
  }
});

// Verify OTP
router.post("/verify", async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code)
    return res.status(400).json({ error: "Phone and code required" });

  const record = await Otp.findOne({ phone, code, used: false })
    .sort({ createdAt: -1 })
    .exec();

  if (!record) return res.status(400).json({ error: "Invalid OTP" });
  if (record.expiresAt < new Date())
    return res.status(400).json({ error: "OTP expired" });

  record.used = true;
  await record.save();

  // OTP verified successfully
  res.json({ message: "OTP verified successfully" });
});

module.exports = router;
