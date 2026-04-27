const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const TransactionReport = require("../models/TransactionReport");
const ScheduledTransaction = require("../models/ScheduledTransaction");
const ChatMessage = require("../models/ChatMessage");
const FraudAccount = require("../models/FraudAccount");

router.get("/dashboard", async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ status: "ACTIVE" });
    const totalTransactions = await Transaction.countDocuments();
    const pendingReports = await TransactionReport.countDocuments({ status: "PENDING" });
    const pendingScheduledTxns = await ScheduledTransaction.countDocuments({ status: "PENDING" });
    const pendingChatMessages = await ChatMessage.countDocuments({ sender_type: "USER", is_read: false });
    const flaggedAccounts = await FraudAccount.countDocuments();

    const volumeResult = await Transaction.aggregate([
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    res.json({
      stats: {
        total_users: totalUsers,
        active_users: activeUsers,
        total_transactions: totalTransactions,
        total_volume: volumeResult[0]?.total || 0,
        pending_reports: pendingReports,
        pending_scheduled_txns: pendingScheduledTxns,
        unread_chats: pendingChatMessages,
        flagged_accounts: flaggedAccounts
      }
    });
  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/users", async (req, res) => {
  try {
    const { page = 1, limit = 20, status, search } = req.query;
    const filter = {};
    
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { aadhaarNumber: { $regex: search, $options: "i" } },
        { accountNumber: { $regex: search, $options: "i" } }
      ];
    }

    const users = await User.find(filter)
      .select("-mpinHash")
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await User.countDocuments(filter);

    res.json({
      users: users.map(u => ({
        id: u._id,
        name: u.name,
        aadhaar: u.aadhaarNumber?.slice(-4).padStart(12, "*"),
        account_number: u.accountNumber,
        phone: u.phoneNumber?.slice(-4).padStart(10, "*"),
        upi_id: u.upiId,
        balance: u.balance,
        status: u.status,
        created_at: u.createdAt
      })),
      total,
      page: parseInt(page),
      total_pages: Math.ceil(total / parseInt(limit))
    });
  } catch (err) {
    console.error("Users error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/users/:userId/status", async (req, res) => {
  try {
    const { status } = req.body;
    const user = await User.findById(req.params.userId);
    
    if (!user) return res.status(404).json({ error: "User not found" });
    
    user.status = status;
    await user.save();
    
    res.json({ message: `User ${status.toLowerCase()}d`, user_id: user._id });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/users/:userId/balance", async (req, res) => {
  try {
    const { amount, operation } = req.body;
    const user = await User.findById(req.params.userId);
    
    if (!user) return res.status(404).json({ error: "User not found" });
    
    const prevBalance = user.balance;
    if (operation === "add") {
      user.balance += amount;
    } else if (operation === "deduct") {
      user.balance = Math.max(0, user.balance - amount);
    }
    
    await user.save();
    
    res.json({ 
      message: "Balance updated",
      previous_balance: prevBalance,
      new_balance: user.balance,
      operation
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/reports", async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const reports = await TransactionReport.find(filter)
      .populate("reporter_id", "name accountNumber")
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await TransactionReport.countDocuments(filter);

    res.json({
      reports: reports.map(r => ({
        id: r._id,
        transaction_id: r.transaction_id,
        report_type: r.report_type,
        description: r.description,
        amount: r.amount,
        status: r.status,
        reporter: r.reporter_id ? {
          name: r.reporter_id.name,
          account: r.reporter_id.accountNumber
        } : null,
        created_at: r.createdAt,
        resolved_at: r.resolved_at,
        resolution: r.resolution
      })),
      total,
      page: parseInt(page)
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/reports/:reportId/resolve", async (req, res) => {
  try {
    const { status, resolution } = req.body;
    const report = await TransactionReport.findById(req.params.reportId);
    
    if (!report) return res.status(404).json({ error: "Report not found" });
    
    report.status = status;
    if (resolution) report.resolution = resolution;
    if (status === "RESOLVED" || status === "REJECTED") {
      report.resolved_at = new Date();
    }
    
    await report.save();
    
    res.json({ message: "Report updated", report_id: report._id });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/scheduled-transactions", async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const txns = await ScheduledTransaction.find(filter)
      .populate("user_id", "name accountNumber upiId")
      .sort({ scheduled_at: 1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await ScheduledTransaction.countDocuments(filter);

    res.json({
      transactions: txns.map(t => ({
        id: t._id,
        txn_id: t.txn_id,
        user: t.user_id ? {
          name: t.user_id.name,
          account: t.user_id.accountNumber,
          upi: t.user_id.upiId
        } : null,
        amount: t.amount,
        to_account: t.to_account,
        to_upi: t.to_upi,
        status: t.status,
        delay_reason: t.delay_reason,
        scheduled_at: t.scheduled_at,
        created_at: t.createdAt
      })),
      total,
      page: parseInt(page)
    });
  } catch (err) {
    console.error("Scheduled error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/scheduled-transactions/:txnId/process", async (req, res) => {
  try {
    const { action } = req.body;
    const txn = await ScheduledTransaction.findById(req.params.txnId);
    
    if (!txn) return res.status(404).json({ error: "Transaction not found" });
    
    if (action === "approve") {
      txn.status = "COMPLETED";
      await txn.save();
      res.json({ message: "Transaction completed" });
    } else if (action === "reject") {
      txn.status = "CANCELLED";
      await txn.save();
      res.json({ message: "Transaction cancelled" });
    } else {
      res.status(400).json({ error: "Invalid action" });
    }
  } catch (err) {
    console.error("Process error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/chats", async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const usersWithChats = await ChatMessage.aggregate([
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$sender_id",
          lastMessage: { $first: "$message" },
          lastMessageAt: { $first: "$createdAt" },
          sender_type: { $first: "$sender_type" }
        }
      },
      { $sort: { lastMessageAt: -1 } },
      { $skip: (parseInt(page) - 1) * parseInt(limit) },
      { $limit: parseInt(limit) }
    ]);

    const populated = await Promise.all(
      usersWithChats.filter(c => c.sender_type === "USER").map(async (chat) => {
        const user = await User.findById(chat._id).select("name accountNumber");
        return {
          user_id: chat._id,
          user_name: user?.name || "Unknown",
          account_number: user?.accountNumber,
          last_message: chat.lastMessage,
          last_message_at: chat.lastMessageAt,
          unread_count: 0
        };
      })
    );

    res.json({ chats: populated, page: parseInt(page) });
  } catch (err) {
    console.error("Chats error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/chats/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 100 } = req.query;

    const messages = await ChatMessage.find({ sender_id: userId })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    await ChatMessage.updateMany(
      { sender_id: userId, sender_type: "USER", is_read: false },
      { is_read: true }
    );

    const user = await User.findById(userId).select("name accountNumber");

    res.json({
      user: user ? { name: user.name, account: user.accountNumber } : null,
      messages: messages.reverse().map(m => ({
        id: m._id,
        message: m.message,
        sender_type: m.sender_type,
        created_at: m.createdAt
      }))
    });
  } catch (err) {
    console.error("Chat messages error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/chats/:userId/message", async (req, res) => {
  try {
    const { message } = req.body;
    const { userId } = req.params;

    if (!message) return res.status(400).json({ error: "Message required" });

    const chatMessage = await ChatMessage.create({
      sender_id: userId,
      sender_type: "ADMIN",
      message: message.trim()
    });

    res.status(201).json({
      message: "Message sent",
      chatMessage: {
        id: chatMessage._id,
        message: chatMessage.message,
        created_at: chatMessage.createdAt
      }
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/fraud-accounts", async (req, res) => {
  try {
    const accounts = await FraudAccount.find()
      .populate("reportedBy", "name accountNumber")
      .sort({ createdAt: -1 });

    res.json({
      accounts: accounts.map(a => ({
        id: a._id,
        account_number: a.accountNumber,
        ifsc: a.ifsc,
        reason: a.reason,
        reported_by: a.reportedBy ? {
          name: a.reportedBy.name,
          account: a.reportedBy.accountNumber
        } : null,
        created_at: a.createdAt
      }))
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/fraud-accounts/:id", async (req, res) => {
  try {
    await FraudAccount.findByIdAndDelete(req.params.id);
    res.json({ message: "Fraud account removed" });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/transactions", async (req, res) => {
  try {
    const { page = 1, limit = 20, type, is_fraud } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (is_fraud !== undefined) filter.is_fraud = is_fraud === "true";

    const txns = await Transaction.find(filter)
      .populate("user_id", "name accountNumber")
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await Transaction.countDocuments(filter);

    res.json({
      transactions: txns.map(t => ({
        id: t._id,
        txn_id: t.txn_id,
        user: t.user_id ? { name: t.user_id.name, account: t.user_id.accountNumber } : null,
        amount: t.amount,
        type: t.type,
        to_account: t.to_account,
        to_upi: t.to_upi,
        is_fraud: t.is_fraud,
        created_at: t.createdAt
      })),
      total,
      page: parseInt(page)
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// Test endpoint to add chat message
router.post("/test-add-message", async (req, res) => {
  try {
    const userId = "69eec963c98a1008d8a582fd"; // The existing user
    const chatMessage = new ChatMessage({
      sender_id: userId,
      sender_type: "USER",
      message: "Hello, I need help!"
    });
    await chatMessage.save();
    res.json({ success: true, chatMessage });
  } catch (err) {
    console.error("Test chat error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Test endpoint to add chat message
router.post("/test-chat", async (req, res) => {
  try {
    const { user_id, message } = req.body;
    const chatMessage = await ChatMessage.create({
      sender_id: user_id,
      sender_type: "USER",
      message: message || "Hello, I need help"
    });
    res.json({ message: "Test chat created", chatMessage });
  } catch (err) {
    console.error("Test chat error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;