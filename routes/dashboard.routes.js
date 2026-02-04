const express = require("express");
const router = express.Router();

const User = require("../models/User");
const Transaction = require("../models/Transaction");
const FraudAlert = require("../models/FraudAccount");

/**
 * =========================
 * DASHBOARD SUMMARY CARDS
 * =========================
 * GET /api/dashboard/stats
 */
router.get("/stats", async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();

    const totalBalanceAgg = await User.aggregate([
      { $group: { _id: null, total: { $sum: "$balance" } } }
    ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayTransactions = await Transaction.countDocuments({
      createdAt: { $gte: today }
    });

    const fraudAlerts = await FraudAlert.countDocuments();

    res.json({
      totalUsers,
      totalBalance: totalBalanceAgg[0]?.total || 0,
      todayTransactions,
      fraudAlerts
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Dashboard stats failed" });
  }
});

/**
 * =========================
 * TRANSACTION VOLUME (7 DAYS)
 * =========================
 * GET /api/dashboard/transactions-7days
 */
router.get("/transactions-7days", async (req, res) => {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);

    const rawData = await Transaction.aggregate([
      {
        $match: { createdAt: { $gte: startDate } }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d", // ✅ VALID Mongo format
              date: "$createdAt"
            }
          },
          total: { $sum: "$amount" }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Convert YYYY-MM-DD → Day name (Mon, Tue...)
    const formatted = rawData.map(item => {
      const date = new Date(item._id);
      const day = date.toLocaleDateString("en-US", { weekday: "short" });

      return {
        day,
        total: item.total
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Transaction chart failed" });
  }
});


/**
 * =========================
 * CREDIT vs DEBIT DONUT
 * =========================
 * GET /api/dashboard/credit-debit
 */
router.get("/credit-debit", async (req, res) => {
  try {
    const stats = await Transaction.aggregate([
      {
        $group: {
          _id: "$type", // Credit / Debit
          count: { $sum: 1 }
        }
      }
    ]);

    const response = { Credit: 0, Debit: 0 };

    stats.forEach(item => {
      response[item._id] = item.count;
    });

    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Credit/Debit stats failed" });
  }
});

module.exports = router;
