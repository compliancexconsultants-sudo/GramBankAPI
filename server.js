require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");

const userRoutes = require("./routes/userRoutes");
const txnRoutes = require("./routes/txnRoutes");

const app = express();

// ✅ Universal CORS setup (never gives CORS error)
app.use(
  cors({
    origin: "*", // allows requests from all origins
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Handle preflight (OPTIONS) requests
app.options("*", cors());

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

// ✅ Default route (for sanity check)
app.get("/", (req, res) => {
  res.json({ message: "GramBank API is running 🚀" });
});

// ✅ Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
