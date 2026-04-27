require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");

const userRoutes = require("./routes/userRoutes");
const txnRoutes = require("./routes/txnRoutes");
const otpRoutes = require("./routes/otpRoutes");
const app = express();

// ✅ Universal CORS Setup (Compatible with Express 5)
app.use(
  cors({
    origin: "*", 
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ✅ Safe alternative to avoid path-to-regexp '*' error
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Middleware
app.use(bodyParser.json());
app.use(express.json());

// ✅ MongoDB connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

// ✅ Routes
app.use("/api/users", userRoutes);
app.use("/api/txns", txnRoutes);
app.use("/api/otp", otpRoutes);
app.use("/api/dashboard", require("./routes/dashboard.routes"));
app.use("/api/fraud", require("./routes/fraudRoutes"));
app.use("/api/reports", require("./routes/reportRoutes"));
app.use("/api/chatbot", require("./routes/chatbotRoutes"));
app.use("/api/live-chat", require("./routes/liveChatRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/upi-collect", require("./routes/upiCollectRoutes"));

// ✅ Default route
app.get("/", (req, res) => {
  res.json({ message: "GramBank API is running 🚀" });
});

// ✅ Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));