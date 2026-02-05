const express = require("express");
const router = express.Router();
const axios = require("axios");
const Otp = require("../models/Otp"); // your mongoose model
const accountSid = process.env.TWILIO_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const messagingServiceSid = process.env.TWILIO_MSG_SID;


const client = require("twilio")(accountSid, authToken);

// --- Generate OTP and send via Twilio ---
router.post("/send", async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ error: "Phone number required" });

        const formattedPhone = phone.startsWith("+91") ? phone : `+91${phone}`;
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // expires in 5 min

        await Otp.create({ phone: formattedPhone, code: otp, expiresAt });

        // Send OTP SMS
        const message = await client.messages.create({
            body: `Your GramBank OTP is ${otp}. It expires in 5 minutes.`,
            from: '+17542900474',
            to: formattedPhone,
        });

        console.log("✅ OTP sent:", message.sid);
        res.json({ success: true, otp }); // keep otp in response only for dev/test
    } catch (err) {
        console.error("Twilio OTP Error:", err);
        res.status(500).json({ error: "Failed to send OTP" });
    }
});

// --- Verify OTP ---
router.post("/verify", async (req, res) => {
    try {
        const { phone, code } = req.body;
        let otp = code

        if (!phone || !otp) return res.status(400).json({ error: "Missing fields" });

        const formattedPhone = phone.startsWith("+91") ? phone : `+91${phone}`;
        const record = await Otp.findOne({ phone: formattedPhone }).sort({ createdAt: -1 });

        if (!record) return res.status(400).json({ error: "No OTP found for this number" });
        if (record.expiresAt < new Date()) return res.status(400).json({ error: "OTP expired" });
        if (record.code !== otp) return res.status(400).json({ error: "Invalid OTP" });

        res.json({ success: true, message: "OTP verified successfully" });
    } catch (err) {
        console.error("Verify OTP Error:", err);
        res.status(500).json({ error: "Failed to verify OTP" });
    }
});

module.exports = router;
