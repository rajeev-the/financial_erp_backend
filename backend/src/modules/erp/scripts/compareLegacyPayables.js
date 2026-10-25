import mongoose from "mongoose";
import dotenv from "dotenv";
import envConfig from "../../../config/env.js";
import { calculatePayablesService } from "../../tally/payables/payables.services.js";
import { getCompanyLedgerBuckets } from "../reports/groupHierarchy.helper.js";
import LedgerPosting from "../ledger/ledgerPosting.schema.js";

dotenv.config();

async function main() {
  await mongoose.connect(envConfig.MONGO_URI);
  const companyId = "6aa0ebf73a3260ebc741698b";

  console.log("=== 1. RUNNING LEGACY calculatePayablesService ===");
  const legPay = await calculatePayablesService({ companyId });
  console.log({
    total_payable: legPay.total_payable,
    closing_balance: legPay.closing_balance,
    total_opening_balance: legPay.total_opening_balance,
    total_debit: legPay.total_debit,
    total_credit: legPay.total_credit,
    total_vendors: legPay.total_vendors,
    creditors_count: legPay.creditors_count,
  });

  const pendingVendors = legPay.vendors.filter(v => v.closing_balance > 0);
  console.log(`\nLegacy Pending Vendors (${pendingVendors.length}):`);
  for (const v of pendingVendors) {
    console.log(`- ${v.party_name}: Opening=${v.opening_balance}, Cr=${v.total_credit}, Dr=${v.total_debit}, NetPayable=${v.closing_balance}`);
  }

  const advanceVendors = legPay.vendors.filter(v => v.closing_balance < 0);
  console.log(`\nLegacy Advance Vendors (${advanceVendors.length}):`);
  for (const v of advanceVendors.slice(0, 10)) {
    console.log(`- ${v.party_name}: Opening=${v.opening_balance}, Cr=${v.total_credit}, Dr=${v.total_debit}, NetAdvance=${v.closing_balance}`);
  }

  console.log("\n=== 2. RUNNING ERP UNIFIED PAYABLES ===");
  const buckets = await getCompanyLedgerBuckets(companyId);

  // Group all postings by ledgerId across all time
  const postings = await LedgerPosting.aggregate([
    { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
    {
      $group: {
        _id: "$ledgerId",
        dr: { $sum: "$debit" },
        cr: { $sum: "$credit" }
      }
    }
  ]);
  const postMap = new Map();
  for (const p of postings) {
    postMap.set(p._id.toString(), { dr: p.dr / 100, cr: p.cr / 100 });
  }

  const erpVendors = [];
  let erpTotalPayable = 0;
  let erpTotalOpening = 0;
  let erpTotalDr = 0;
  let erpTotalCr = 0;

  for (const id of buckets.creditorLedgerIds) {
    const l = buckets.ledgerMap.get(id);
    const p = postMap.get(id) || { dr: 0, cr: 0 };
    const rawOpen = l.openingBalance || 0;
    // In Tally: Creditor opening balance:
    // If opening balance detail was: is_deemed_positive === false (or raw < 0 in Tally XML)
    // Let's see how l.openingBalance is stored in buckets.ledgerMap
    erpVendors.push({
      id,
      name: l.name,
      parent: l.parent,
      rawOpeningInMap: l.openingBalance,
      dr: p.dr,
      cr: p.cr,
    });
  }

  console.log(`ERP Creditor Ledgers count: ${erpVendors.length}`);

  // Let's compare the 3 pending vendors from legacy with ERP
  console.log("\n=== 3. COMPARISON FOR LEGACY PENDING VENDORS IN ERP ===");
  for (const pv of pendingVendors) {
    const match = erpVendors.find(ev => ev.name.toLowerCase() === pv.party_name.toLowerCase());
    console.log(`Vendor: "${pv.party_name}"`);
    console.log(`  Legacy: Opening=${pv.opening_balance}, Cr=${pv.total_credit}, Dr=${pv.total_debit}, Closing=${pv.closing_balance}`);
    if (match) {
      console.log(`  ERP:    OpeningInMap=${match.rawOpeningInMap}, Cr=${match.cr}, Dr=${match.dr}, NetCr-Dr=${match.cr - match.dr}`);
    } else {
      console.log(`  ERP:    NOT FOUND in creditorLedgerIds!`);
    }
  }

  await mongoose.disconnect();
}

main().catch(console.error);
