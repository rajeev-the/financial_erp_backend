import mongoose from "mongoose";
import connectDB from "../../../config/db.js";
import Company from "../../companies/company.schema.js";
import Ledger from "../../tally/ledger/ledger.schema.js";
import UnifiedVoucher from "../voucher/voucher.unified.schema.js";
import LedgerPosting from "../ledger/ledgerPosting.schema.js";
import AuditLog from "../audit/auditlog.schema.js";
import OutboundSyncQueue from "../sync/outboundSyncQueue.schema.js";
import { postSalesInvoiceService } from "../posting/postingEngine.service.js";

async function runTest() {
  console.log("--- Starting ERP Posting Engine Verification Test ---");

  await connectDB();

  try {
    // 1. Find Company
    const company = await Company.findOne({
      $or: [{ _id: "6aa0ebf73a3260ebc741698b" }, { is_deleted: { $ne: true } }],
    });

    if (!company) {
      throw new Error("No active company found in database");
    }
    console.log(`[PASS] Using Company: ${company.name} (${company._id})`);

    // 2. Find a Customer / Debtor Ledger
    let party = await Ledger.findOne({
      company_id: company._id,
      $or: [
        { parent: /sundry\s*debtors/i },
        { name: /customer/i },
        { is_deleted: { $ne: true } },
      ],
    });

    if (!party) {
      party = await Ledger.create({
        company_id: company._id,
        name: "Test Customer Tech Solutions",
        parent: "Sundry Debtors",
        gstin: "27AAACA1234A1Z5",
        opening_balance: 0,
      });
      console.log(`[INFO] Created mock debtor: ${party.name}`);
    } else {
      console.log(`[PASS] Using Debtor: ${party.name} (${party._id})`);
    }

    // 3. Define Client Intent
    const idempotencyKey = `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const clientIntent = {
      partyId: party._id,
      date: "2026-10-24",
      dueDate: "2026-11-24",
      placeOfSupply: "27",
      idempotencyKey,
      narration: "ERP verification invoice for test run",
      items: [
        {
          name: "Ergonomic Wireless Mouse",
          hsn: "8471",
          qty: 2,
          unit: "PCS",
          rate: 150000, // ₹1,500.00
          taxRate: 18,  // 18% GST
        },
        {
          name: "Mechanical Keyboard",
          hsn: "8471",
          qty: 1,
          unit: "PCS",
          rate: 450000, // ₹4,500.00
          taxRate: 18,
        },
      ],
    };

    console.log("[INFO] Posting Sales Invoice via postingEngine.service...");
    const { voucher, isDuplicate } = await postSalesInvoiceService({
      companyId: company._id,
      clientIntent,
    });

    console.log(`[PASS] Voucher Created successfully!`);
    console.log(`       - Voucher Number: ${voucher.voucherNumber}`);
    console.log(`       - Financial Year: ${voucher.financialYear}`);
    console.log(`       - Status: ${voucher.status}`);
    console.log(`       - Tax Mode: ${voucher.gst.taxMode}`);
    console.log(`       - Subtotal: ₹${voucher.summary.subtotal / 100}`);
    console.log(`       - Tax Total: ₹${voucher.summary.taxTotal / 100}`);
    console.log(`       - Grand Total: ₹${voucher.summary.grandTotal / 100}`);

    // Assert double-entry
    const totalDr = voucher.entries.reduce((sum, e) => sum + e.debit, 0);
    const totalCr = voucher.entries.reduce((sum, e) => sum + e.credit, 0);
    if (totalDr !== totalCr || totalDr !== voucher.summary.grandTotal) {
      throw new Error(`Double entry check failed: Dr (${totalDr}) != Cr (${totalCr})`);
    }
    console.log(`[PASS] Double-Entry Equality Verified: Total Dr (${totalDr}) === Total Cr (${totalCr})`);

    // Verify Ledger Postings
    const postings = await LedgerPosting.find({ voucherId: voucher._id });
    if (postings.length !== voucher.entries.length) {
      throw new Error(`LedgerPostings count mismatch: ${postings.length} != ${voucher.entries.length}`);
    }
    console.log(`[PASS] Derived Ledger Postings Count: ${postings.length} rows inserted`);

    // Verify Audit Log
    const auditRecord = await AuditLog.findOne({ voucherId: voucher._id });
    if (!auditRecord || auditRecord.action !== "CREATE") {
      throw new Error("Audit log entry missing or invalid");
    }
    console.log(`[PASS] Immutable Audit Log Recorded: Action = ${auditRecord.action}`);

    // Verify Outbound Sync Queue
    const queueRecord = await OutboundSyncQueue.findOne({ voucherId: voucher._id });
    if (!queueRecord || queueRecord.status !== "PENDING") {
      throw new Error("Outbound Sync Queue record missing or not PENDING");
    }
    console.log(`[PASS] Outbound Sync Queue Enqueued: Status = ${queueRecord.status}`);

    // 4. Test Idempotency
    console.log("[INFO] Testing Idempotency with exact same key...");
    const duplicateAttempt = await postSalesInvoiceService({
      companyId: company._id,
      clientIntent,
    });

    if (!duplicateAttempt.isDuplicate || String(duplicateAttempt.voucher._id) !== String(voucher._id)) {
      throw new Error("Idempotency check failed: duplicate invoice was created!");
    }
    console.log(`[PASS] Idempotency Verified: Duplicate attempt returned existing voucher ID without re-inserting!`);

    console.log("\n=======================================================");
    console.log("   ALL ERP PHASE 1 & 2 VERIFICATION CHECKS PASSED!     ");
    console.log("=======================================================\n");
  } catch (err) {
    console.error("\n[FAIL] Test Failed with Error:", err);
  } finally {
    await mongoose.disconnect();
    console.log("MongoDB Disconnected cleanly.");
    process.exit(0);
  }
}

runTest();
