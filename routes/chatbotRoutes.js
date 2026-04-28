const express = require("express");
const router = express.Router();

const faqs = [
  {
    id: 1,
    category: "account",
    question: "How do I open a new account?",
    answer: "To open a new account, tap 'New user? Create Account' on the login screen. You'll need your Aadhaar number, PAN card, phone number, and a 4-digit MPIN. The process takes just a few minutes!"
  },
  {
    id: 2,
    category: "account",
    question: "How do I reset my MPIN?",
    answer: "Currently, MPIN reset requires visiting our support team. Go to Settings > Support to contact us or email support@grambank.com"
  },
  {
    id: 3,
    category: "account",
    question: "What is UPI ID and how do I get one?",
    answer: "Your UPI ID is automatically created when you sign up. It's in the format: youraccountnumber@grambank. You can find it on the Dashboard under 'Receive Money'."
  },
  {
    id: 4,
    category: "transactions",
    question: "How do I send money?",
    answer: "Go to Dashboard > Send to Mobile or Bank Transfer. Enter the recipient's UPI ID or account details, enter amount, and confirm with OTP."
  },
  {
    id: 5,
    category: "transactions",
    question: "How do I receive money?",
    answer: "Go to Dashboard > Receive Money. Share your UPI QR code or UPI ID with the sender. They can scan your QR or enter your UPI ID to send money."
  },
  {
    id: 6,
    category: "transactions",
    question: "Why was my transaction delayed?",
    answer: "Transactions above ₹10,000 or those flagged by our security system may be delayed for verification. You'll receive an SMS about the status. You can check pending transactions in History."
  },
  {
    id: 7,
    category: "transactions",
    question: "What is the transaction limit?",
    answer: "Daily limit: ₹1,00,000 per day. Per transaction limit: ₹2,00,000. These limits are as per RBI guidelines for UPI transactions."
  },
  {
    id: 8,
    category: "security",
    question: "Is my money safe?",
    answer: "Yes! GramBank uses bank-grade security with 256-bit encryption. We have fraud detection, transaction alerts, and biometric login for your safety. Never share your MPIN or OTP with anyone."
  },
  {
    id: 9,
    category: "security",
    question: "What should I do if I suspect fraud?",
    answer: "Immediately report suspicious transactions via: 1) Long press the transaction in History > Report Issue, 2) Go to Settings > Report Transaction, 3) Contact our support team."
  },
  {
    id: 10,
    category: "security",
    question: "What is UPI Collect Request fraud?",
    answer: "UPI Collect allows anyone to request money from you. Scammers may send fake requests saying 'approve to receive money' but it actually sends money. Always verify the request intent - our app clearly shows SEND vs RECEIVE."
  },
  {
    id: 12,
    category: "upi",
    question: "What is UPI Collect?",
    answer: "UPI Collect lets you request money from others. Go to Dashboard > Create Request > Enter UPI ID and amount > Send Request. The payer will receive a notification to pay you."
  },
  {
    id: 13,
    category: "upi",
    question: "How do I check my balance?",
    answer: "Tap 'Check Balance' on the Dashboard. Your current balance will be displayed. You can also hide/show balance by tapping the eye icon."
  },
  {
    id: 14,
    category: "general",
    question: "How do I contact support?",
    answer: "Go to Settings > Support or email support@grambank.com. Our team is available Monday-Saturday, 9 AM - 6 PM."
  },
  {
    id: 15,
    category: "general",
    question: "Is GramBank a real bank?",
    answer: "GramBank is a digital banking application that simulates UPI and banking operations for demonstration purposes. It showcases security features like fraud detection, device verification, and transaction reporting."
  }
];

router.get("/faqs", (req, res) => {
  const { category } = req.query;
  
  let filteredFaqs = faqs;
  if (category) {
    filteredFaqs = faqs.filter(f => f.category === category);
  }

  const categories = [...new Set(faqs.map(f => f.category))];

  res.json({
    total: filteredFaqs.length,
    categories,
    faqs: filteredFaqs.map(f => ({
      id: f.id,
      category: f.category,
      question: f.question,
      answer: f.answer
    }))
  });
});

router.get("/search", (req, res) => {
  const { q } = req.query;
  
  if (!q || q.length < 2) {
    return res.json({ results: [] });
  }

  const query = q.toLowerCase();
  const results = faqs.filter(f => 
    f.question.toLowerCase().includes(query) || 
    f.answer.toLowerCase().includes(query)
  );

  res.json({
    query: q,
    count: results.length,
    results: results.map(f => ({
      id: f.id,
      category: f.category,
      question: f.question,
      answer: f.answer
    }))
  });
});

router.post("/chat", (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  const query = message.toLowerCase();
  
  let response = {
    message: "I understand you're asking about GramBank. Here are some relevant FAQs:",
    faqs: [],
    suggestions: []
  };

  if (query.includes("balance") || query.includes("check")) {
    response.faq = faqs.find(f => f.question.toLowerCase().includes("balance"));
  } else if (query.includes("send") || query.includes("transfer")) {
    response.faq = faqs.find(f => f.question.toLowerCase().includes("send money"));
  } else if (query.includes("receive") || query.includes("get money")) {
    response.faq = faqs.find(f => f.question.toLowerCase().includes("receive"));
  } else if (query.includes("fraud") || query.includes("scam") || query.includes("fake")) {
    response.faq = faqs.find(f => f.question.toLowerCase().includes("fraud"));
  } else if (query.includes("safe") || query.includes("security")) {
    response.faq = faqs.find(f => f.question.toLowerCase().includes("safe"));
  } else if (query.includes("limit")) {
    response.faq = faqs.find(f => f.question.toLowerCase().includes("limit"));
  } else if (query.includes("account") || query.includes("open")) {
    response.faq = faqs.find(f => f.question.toLowerCase().includes("open"));
  } else if (query.includes("upi")) {
    response.faq = faqs.find(f => f.question.toLowerCase().includes("upi"));
  } else if (query.includes("device") || query.includes("login") || query.includes("hour")) {
    response.faq = faqs.find(f => f.question.toLowerCase().includes("device"));
  } else if (query.includes("support") || query.includes("contact")) {
    response.faq = faqs.find(f => f.question.toLowerCase().includes("support"));
  } else {
    response.faq = faqs[Math.floor(Math.random() * 5)];
  }

  response.suggestions = [
    "How do I send money?",
    "How do I receive money?",
    "Is my money safe?",
    "What is UPI Collect?",
    "Contact support"
  ];

  if (!response.faq) {
    response.message = "I'm not sure about that. Here are some things I can help with:";
    response.faq = faqs.slice(0, 3);
  }

  res.json(response);
});

router.get("/categories", (req, res) => {
  const categories = [
    { id: "account", name: "Account", icon: "person-outline", color: "#3B82F6" },
    { id: "transactions", name: "Transactions", icon: "swap-horizontal", color: "#10B981" },
    { id: "security", name: "Security", icon: "shield-checkmark-outline", color: "#F59E0B" },
    { id: "upi", name: "UPI & Payments", icon: "wallet-outline", color: "#8B5CF6" },
    { id: "general", name: "General", icon: "information-circle-outline", color: "#6B7280" }
  ];

  res.json({ categories });
});

module.exports = router;