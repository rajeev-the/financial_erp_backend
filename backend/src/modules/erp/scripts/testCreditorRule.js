import mongoose from "mongoose";
import dotenv from "dotenv";
import envConfig from "../../../config/env.js";
import { getCompanyLedgerBuckets } from "../reports/groupHierarchy.helper.js";
import LedgerPosting from "../ledger/ledgerPosting.schema.js";
import LedgerBalanceDetails from "../../tally/ledger/ledgerBalanceDetails.schema.js";
import { calculatePayablesService } from "../../tally/payables/payables.services.js";

dotenv.config();

async function main() {
  await mongoose.connect(envConfig.MONGO_URI);
  const companyId = "6aa0ebf73a3260ebc741698b";

  // 1. Fetch balance details for all creditors
  const allBal = await LedgerBalanceDetails.find({ company_id: companyId }).sort({ from_date: 1 }).lean();
  const earliestDate = allBal[0].from_date;
  const creditorOpeningMap = new Map();
  for (const b of allBal) {
    if (String(b.from_date) === String(earliestDate)) {
      const raw = Number(b.opening_balance) || 0;
      // In Tally: Creditor is liability.
      // raw > 0 is Credit (we owe money: positive)
      // raw < 0 is Debit (advance: negative)
      const val = raw > 0 ? Math.abs(raw) : -Math.abs(raw);
      creditorOpeningMap.set(b.ledger_id.toString(), val);
    }
  }

  const buckets = await getCompanyLedgerBuckets(companyId);

  // Test across all time
  console.log("=== ALL TIME PAYABLES RECONCILIATION ===");
  const legAll = await calculatePayablesService({ companyId });

  // Postings across all time
  const postingsAll = await LedgerPosting.aggregate([
    { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
    { $group: { _id: "$ledgerId", dr: { $sum: "$debit" }, cr: { $sum: "$credit" } } },
  ]);
  const postMapAll = new Map();
  for (const p of postingsAll) {
    postMapAll.set(p._id.toString(), { dr: p.dr / 100, cr: p.cr / 100 });
  }

  let erpPayableAll = 0;
  const erpPendingAll = [];
  for (const id of buckets.creditorLedgerIds) {
    const l = buckets.ledgerMap.get(id);
    const p = postMapAll.get(id) || { dr: 0, cr: 0 };
    const open = creditorOpeningMap.get(id) || 0;
    const net = Math.round((open + p.cr - p.dr) * 100) / 100;
    if (net > 0) {
      erpPayableAll += net;
      erpPendingAll.push({ name: l.name, amt: net });
    }
  }

  erpPayableAll = Math.round(erpPayableAll * 100) / 100;
  console.log(`Legacy All Time Total Payable: ₹${legAll.total_payable} (${legAll.creditors_count} creditors)`);
  console.log(`ERP All Time Total Payable:    ₹${erpPayableAll} (${erpPendingAll.length} creditors)`);
  console.log(`Difference: ₹${Math.abs(legAll.total_payable - erpPayableAll)}`);
  console.log("Pending creditors in ERP:", erpPendingAll);

  // Test FY 2024-2025
  console.log("\n=== FY 2024-2025 PAYABLES RECONCILIATION ===");
  const legFY = await calculatePayablesService({
    companyId,
    from_date: "2024-04-01",
    to_date: "2025-03-31"
  });

  const postingsFY = await LedgerPosting.aggregate([
    { $match: { companyId: new mongoose.Types.ObjectId(companyId), date: { $gte: "2024-04-01", $lte: "2025-03-31" } } },
    { $group: { _id: "$ledgerId", dr: { $sum: "$debit" }, cr: { $sum: "$credit" } } },
  ]);
  const postMapFY = new Map();
  for (const p of postingsFY) {
    postMapFY.set(p._id.toString(), { dr: p.dr / 100, cr: p.cr / 100 });
  }

  let erpPayableFY = 0;
  const erpPendingFY = [];
  for (const id of buckets.creditorLedgerIds) {
    const l = buckets.ledgerMap.get(id);
    const p = postMapFY.get(id) || { dr: 0, cr: 0 };
    const open = creditorOpeningMap.get(id) || 0;
    const net = Math.round((open + p.cr - p.dr) * 100) / 100;
    if (net > 0) {
      erpPayableFY += net;
      erpPendingFY.push({ name: l.name, amt: net });
    }
  }

  erpPayableFY = Math.round(erpPayableFY * 100) / 100;
  console.log(`Legacy FY 24-25 Total Payable: ₹${legFY.total_payable} (${legFY.creditors_count} creditors)`);
  console.log(`ERP FY 24-25 Total Payable:    ₹${erpPayableFY} (${erpPendingFY.length} creditors)`);
  console.log(`Difference: ₹${Math.abs(legFY.total_payable - erpPayableFY)}`);
  console.log("Pending creditors in ERP:", erpPendingFY);

  await mongoose.disconnect();
}

main().catch(console.error);
