const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const TransactionReport = require("../models/TransactionReport");
const Transaction = require("../models/Transaction");

router.post("/create", auth, async (req, res) => {
  try {
    const { transaction_id, report_type, description } = req.body;

    if (!transaction_id || !report_type) {
      return res.status(400).json({ error: "Transaction ID and report type required" });
    }

    const validTypes = ["UNAUTHORIZED", "WRONG_RECIPIENT", "DUPLICATE", "NOT_RECEIVED", "OTHER", "FRAUD"];
    if (!validTypes.includes(report_type)) {
      return res.status(400).json({ error: "Invalid report type" });
    }

    const existingReport = await TransactionReport.findOne({
      transaction_id,
      reporter_id: req.user._id
    });

    if (existingReport) {
      return res.status(400).json({ error: "You have already reported this transaction" });
    }

    let txnDetails = null;
    try {
      txnDetails = await Transaction.findOne({ txn_id: transaction_id });
    } catch (e) {
      console.log("Transaction not found in DB");
    }

    const report = await TransactionReport.create({
      transaction_id,
      txn_id: txnDetails?._id,
      reporter_id: req.user._id,
      report_type,
      description,
      amount: txnDetails?.amount,
      beneficiary_account: txnDetails?.to_account,
      beneficiary_upi: txnDetails?.to_upi,
      transaction_date: txnDetails?.createdAt
    });

    res.status(201).json({
      message: "Transaction report submitted successfully",
      report_id: report._id,
      status: report.status
    });
  } catch (err) {
    console.error("Create report error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/my-reports", auth, async (req, res) => {
  try {
    const reports = await TransactionReport.find({ reporter_id: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      count: reports.length,
      reports: reports.map(r => ({
        report_id: r._id,
        transaction_id: r.transaction_id,
        report_type: r.report_type,
        report_type_display: r.report_type.replace(/_/g, " "),
        description: r.description,
        amount: r.amount,
        status: r.status,
        status_display: r.status === "PENDING" ? "Pending" : 
                        r.status === "UNDER_REVIEW" ? "Under Review" :
                        r.status === "RESOLVED" ? "Resolved" : "Rejected",
        createdAt: r.createdAt,
        resolved_at: r.resolved_at,
        resolution: r.resolution
      }))
    });
  } catch (err) {
    console.error("Fetch reports error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/:reportId", auth, async (req, res) => {
  try {
    const report = await TransactionReport.findOne({
      _id: req.params.reportId,
      reporter_id: req.user._id
    });

    if (!report) {
      return res.status(404).json({ error: "Report not found" });
    }

    res.json({
      report_id: report._id,
      transaction_id: report.transaction_id,
      report_type: report.report_type,
      report_type_display: report.report_type.replace(/_/g, " "),
      description: report.description,
      amount: report.amount,
      beneficiary_account: report.beneficiary_account,
      beneficiary_upi: report.beneficiary_upi,
      transaction_date: report.transaction_date,
      status: report.status,
      status_display: report.status === "PENDING" ? "Pending" : 
                      report.status === "UNDER_REVIEW" ? "Under Review" :
                      report.status === "RESOLVED" ? "Resolved" : "Rejected",
      createdAt: report.createdAt,
      resolved_at: report.resolved_at,
      resolution: report.resolution
    });
  } catch (err) {
    console.error("Fetch report error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

// ==============================
// ADMIN: GET ALL REPORTS
// ==============================

router.get("/admin/all", async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const reports = await TransactionReport.find(filter)
      .populate("reporter_id", "name accountNumber upiId")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await TransactionReport.countDocuments(filter);

    res.json({
      total,
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      reports: reports.map(r => ({
        report_id: r._id,
        transaction_id: r.transaction_id,
        report_type: r.report_type,
        description: r.description,
        amount: r.amount,
        reporter: r.reporter_id ? {
          name: r.reporter_id.name,
          accountNumber: r.reporter_id.accountNumber
        } : null,
        status: r.status,
        createdAt: r.createdAt,
        resolved_at: r.resolved_at
      }))
    });
  } catch (err) {
    console.error("Admin fetch reports error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/admin/resolve/:reportId", async (req, res) => {
  try {
    const { status, resolution } = req.body;
    const validStatuses = ["UNDER_REVIEW", "RESOLVED", "REJECTED"];
    
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const report = await TransactionReport.findById(req.params.reportId);
    if (!report) {
      return res.status(404).json({ error: "Report not found" });
    }

    report.status = status;
    if (status === "RESOLVED" || status === "REJECTED") {
      report.resolved_at = new Date();
    }
    if (resolution) {
      report.resolution = resolution;
    }
    await report.save();

    res.json({
      message: "Report updated",
      report_id: report._id,
      status: report.status,
      resolved_at: report.resolved_at
    });
  } catch (err) {
    console.error("Resolve report error:", err);
    res.status(500).json({ error: "Server error" });
  }
});