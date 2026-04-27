const mongoose = require("mongoose");

const chatMessageSchema = new mongoose.Schema({
  sender_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  sender_type: {
    type: String,
    enum: ["USER", "ADMIN"],
    required: true
  },
  message: {
    type: String,
    required: true,
    maxLength: 1000
  },
  is_read: {
    type: Boolean,
    default: false
  },
  createdAt: { type: Date, default: Date.now }
});

chatMessageSchema.index({ createdAt: -1 });
chatMessageSchema.index({ sender_id: 1, createdAt: -1 });

module.exports = mongoose.model("ChatMessage", chatMessageSchema);