const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const QRCode = require("qrcode");
const axios = require("axios");
const User = require("../models/User");
const qs = require("qs");

const router = express.Router();

function generateAccountNumber() {
  const bankCode = "2130";
  const randomNumber = Math.floor(1000000000 + Math.random() * 9000000000);
  return bankCode + randomNumber.toString();
}

router.post("/signup", async (req, res) => {
  try {
    const { name, aadhaarNumber, panNumber, mpin, phone } = req.body;

    if (!name || !aadhaarNumber || !panNumber || !mpin)
      return res.status(400).json({ error: "All fields are required" });

    const aadhaarRegex = /^\d{12}$/;
    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

    if (!aadhaarRegex.test(aadhaarNumber))
      return res.status(400).json({ error: "Invalid Aadhaar number" });

    if (!panRegex.test(panNumber))
      return res.status(400).json({ error: "Invalid PAN number" });

    const existingUser = await User.findOne({ aadhaarNumber });
    if (existingUser)
      return res.status(400).json({ error: "User already exists" });

    const mpinHash = await bcrypt.hash(mpin, 10);

    let accountNumber;
    let isUnique = false;

    while (!isUnique) {
      accountNumber = generateAccountNumber();
      const existingAcc = await User.findOne({ accountNumber });
      if (!existingAcc) isUnique = true;
    }

    // ---------- CREATE UPI ----------
    const upiId = `${accountNumber}@grambank`;

    const upiString = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(
      name
    )}&cu=INR`;

    // ---------- GENERATE QR (Base64 Data URL) ----------
    const qrDataUrl = await QRCode.toDataURL(upiString);
    const base64Image = qrDataUrl.split(",")[1]; // remove data:image/png;base64,

    // ---------- UPLOAD TO IMGBB ----------
    const uploadRes = await axios.post(
      `https://api.imgbb.com/1/upload`,
      qs.stringify({
        key: process.env.IMGBB_API_KEY,
        image: base64Image
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );

    const qrImageUrl = uploadRes.data.data.url;

    // ---------- SAVE USER ----------
    const newUser = await User.create({
      name,
      aadhaarNumber,
      panNumber,
      mpinHash,
      accountNumber,
      phoneNumber: phone,
      upiId,
      upiQR: qrImageUrl
    });

    res.status(201).json({
      message: "✅ User registered successfully",
      userId: newUser._id,
      accountNumber: newUser.accountNumber,
      upiId: newUser.upiId,
      upiQR: newUser.upiQR   // IMGBB hosted URL
    });

  } catch (error) {
    console.error("Signup Error:", error?.response?.data || error);
    res.status(500).json({ error: "Server error" });
  }
});



// ✅ Login Route with JWT
router.post("/login", async (req, res) => {
  try {
    const aadhaarNumber = req.body.aadhaarNumber?.toString().trim();
    const mpin = req.body.mpin?.trim();

    if (!aadhaarNumber || !mpin)
      return res.status(400).json({ error: "Aadhaar number and MPIN required" });

    // Find user safely
    const user = await User.findOne({ aadhaarNumber });
    if (!user)
      return res.status(404).json({ error: "User not found" });

    // Verify MPIN
    const isMatch = await bcrypt.compare(mpin, user.mpinHash);
    if (!isMatch)
      return res.status(401).json({ error: "Invalid MPIN" });

    // Generate JWT
    const token = jwt.sign(
      { id: user._id, aadhaarNumber: user.aadhaarNumber },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.status(200).json({
      message: "✅ Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        aadhaarNumber: user.aadhaarNumber,
        panNumber: user.panNumber,
        accountNumber: user.accountNumber
      }
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ error: "Server error" });
  }
});


module.exports = router;
