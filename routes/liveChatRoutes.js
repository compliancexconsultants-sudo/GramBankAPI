const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const ChatMessage = require("../models/ChatMessage");
const User = require("../models/User");

router.post("/message", auth, async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    const chatMessage = await ChatMessage.create({
      sender_id: req.user._id,
      sender_type: "USER",
      message: message.trim()
    });

    res.status(201).json({
      message: "Message sent",
      chatMessage: {
        id: chatMessage._id,
        message: chatMessage.message,
        sender_type: chatMessage.sender_type,
        createdAt: chatMessage.createdAt
      }
    });
  } catch (err) {
    console.error("Send message error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/messages", auth, async (req, res) => {
  try {
    const { limit = 50, before } = req.query;
    
    const filter = {};
    if (before) {
      filter.createdAt = { $lt: new Date(before) };
    }

    const messages = await ChatMessage.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .populate("sender_id", "name");

    const messagesWithSender = await Promise.all(
      messages.map(async (msg) => {
        let senderName = "Admin";
        if (msg.sender_type === "USER" && msg.sender_id) {
          const user = await User.findById(msg.sender_id);
          senderName = user?.name || "User";
        }
        return {
          id: msg._id,
          message: msg.message,
          sender_type: msg.sender_type,
          sender_name: senderName,
          is_read: msg.is_read,
          createdAt: msg.createdAt
        };
      })
    );

    res.json({
      messages: messagesWithSender.reverse(),
      hasMore: messages.length === parseInt(limit)
    });
  } catch (err) {
    console.error("Get messages error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/unread-count", auth, async (req, res) => {
  try {
    const count = await ChatMessage.countDocuments({
      sender_type: "ADMIN",
      is_read: false
    });

    res.json({ unread_count: count });
  } catch (err) {
    console.error("Unread count error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/mark-read", auth, async (req, res) => {
  try {
    await ChatMessage.updateMany(
      { sender_type: "ADMIN", is_read: false },
      { is_read: true }
    );

    res.json({ message: "Messages marked as read" });
  } catch (err) {
    console.error("Mark read error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Admin routes

router.post("/admin/message", async (req, res) => {
  try {
    const { user_id, message } = req.body;

    if (!user_id || !message) {
      return res.status(400).json({ error: "User ID and message required" });
    }

    const chatMessage = await ChatMessage.create({
      sender_id: user_id,
      sender_type: "ADMIN",
      message: message.trim()
    });

    res.status(201).json({
      message: "Admin message sent",
      chatMessage: {
        id: chatMessage._id,
        message: chatMessage.message,
        createdAt: chatMessage.createdAt
      }
    });
  } catch (err) {
    console.error("Admin send message error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/admin/all-chats", async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const usersWithChats = await ChatMessage.aggregate([
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$sender_id",
          lastMessage: { $first: "$message" },
          lastMessageAt: { $first: "$createdAt" },
          sender_type: { $first: "$sender_type" },
          unreadCount: {
            $sum: { $cond: [{ $and: [{ $eq: ["$sender_type", "ADMIN"] }, { $eq: ["$is_read", false] }] }, 1, 0] }
          }
        }
      },
      { $sort: { lastMessageAt: -1 } },
      { $skip: (parseInt(page) - 1) * parseInt(limit) },
      { $limit: parseInt(limit) }
    ]);

    const populatedUsers = await Promise.all(
      usersWithChats.map(async (chat) => {
        if (chat.sender_type === "USER" && chat._id) {
          const user = await User.findById(chat._id).select("name accountNumber");
          return {
            user_id: chat._id,
            user_name: user?.name || "Unknown",
            account_number: user?.accountNumber,
            last_message: chat.lastMessage,
            last_message_at: chat.lastMessageAt,
            unread_count: chat.unreadCount
          };
        }
        return null;
      })
    );

    res.json({
      chats: populatedUsers.filter(c => c !== null),
      currentPage: parseInt(page)
    });
  } catch (err) {
    console.error("Admin all chats error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/admin/user/:userId/messages", async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 100 } = req.query;

    const messages = await ChatMessage.find({
      sender_id: userId
    })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    // Mark as read
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
    console.error("Admin user messages error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/admin/user/:userId/message", async (req, res) => {
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
        createdAt: chatMessage.createdAt
      }
    });
  } catch (err) {
    console.error("Admin send message error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;