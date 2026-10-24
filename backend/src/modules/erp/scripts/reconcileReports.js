import mongoose from "mongoose";
import connectDB from "../../../config/db.js";
import Company from "../../companies/company.schema.js";
import OldLedgerEntry from "../../tally/voucher/ledgerentry.schema.js";
import LedgerPosting from "../ledger/ledgerPosting.schema.js";
import UnifiedVoucher from "../voucher/voucher.unified.schema.js";

async function runReconciliation(targetCompanyId) {
  console.log(`\n=======================================================`);
  console.log(`    PARALLEL REPORT RECONCILIATION AUDIT REPORT         `);
  console.log(`=======================================================\n`);

  await connectDB();

  try {
    const compId = new mongoose.Types.ObjectId(targetCompanyId);
    const company = await Company.findById(compId);
    if (!company) throw new Error("Company not found");

    console.log(`Auditing Company: ${company.name} (${compId})\n`);

    // 1. Total Postings Count Comparison
    const oldEntriesCount = await OldLedgerEntry.countDocuments({
      company_id: compId,
      is_deleted: { $ne: true },
    });

    const newPostingsCount = await LedgerPosting.countDocuments({
      companyId: compId,
    });

    const newVouchersCount = await UnifiedVoucher.countDocuments({
      companyId: compId,
    });

    console.log(`--- [1. RECORD COUNTS] ---`);
    console.log(`Old LedgerEntry Records : ${oldEntriesCount}`);
    console.log(`New LedgerPosting Records: ${newPostingsCount}`);
    console.log(`New UnifiedVouchers      : ${newVouchersCount}`);

    // 2. Debit / Credit Mathematical Equilibrium in New ERP
    const [equilibrium] = await LedgerPosting.aggregate([
      { $match: { companyId: compId } },
      {
        $group: {
          _id: null,
          totalDebit: { $sum: "$debit" },
          totalCredit: { $sum: "$credit" },
          count: { $sum: 1 },
        },
      },
    ]);

    const totalDrPaise = equilibrium ? equilibrium.totalDebit : 0;
    const totalCrPaise = equilibrium ? equilibrium.totalCredit : 0;
    const diffPaise = Math.abs(totalDrPaise - totalCrPaise);

    console.log(`\n--- [2. GENERAL LEDGER EQUILIBRIUM CHECK] ---`);
    console.log(`Total Debits  : ₹${(totalDrPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`);
    console.log(`Total Credits : ₹${(totalCrPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`);
    console.log(`Discrepancy   : ₹${(diffPaise / 100).toFixed(2)} paise`);

    if (diffPaise === 0) {
      console.log(`Status        : [PASS] PERFECT 0.00 PAISE EQUILIBRIUM! Total Debits == Total Credits.`);
    } else {
      console.log(`Status        : [WARN] Discrepancy of ${(diffPaise / 100).toFixed(2)} paise.`);
    }

    // 3. Voucher Breakdown by Type
    const typeBreakdown = await UnifiedVoucher.aggregate([
      { $match: { companyId: compId } },
      {
        $group: {
          _id: "$voucherType",
          count: { $sum: 1 },
          totalAmount: { $sum: "$summary.grandTotal" },
        },
      },
      { $sort: { count: -1 } },
    ]);

    console.log(`\n--- [3. NEW ERP VOUCHER SUMMARY BY TYPE] ---`);
    for (const t of typeBreakdown) {
      console.log(
        `• ${t._id.padEnd(12)} : ${String(t.count).padStart(5)} vouchers | Total: ₹${(t.totalAmount / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
      );
    }

    console.log(`\n=======================================================`);
    console.log(`   RECONCILIATION AUDIT COMPLETED SUCCESSFULLY!        `);
    console.log(`=======================================================\n`);
  } catch (err) {
    console.error("Audit Failed:", err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

const targetId = process.argv[2] || "6aa0ebf73a3260ebc741698b";
runReconciliation(targetId);
