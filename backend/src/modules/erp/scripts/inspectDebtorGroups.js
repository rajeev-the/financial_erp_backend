import mongoose from "mongoose";
import dotenv from "dotenv";
import envConfig from "../../../config/env.js";
import { getCompanyLedgerBuckets } from "../reports/groupHierarchy.helper.js";
import LedgerPosting from "../ledger/ledgerPosting.schema.js";

dotenv.config();

async function main() {
  await mongoose.connect(envConfig.MONGO_URI);
  const companyId = "6aa0ebf73a3260ebc741698b";

  const buckets = await getCompanyLedgerBuckets(companyId);
  console.log(`Total Debtor Ledger IDs in buckets: ${buckets.debtorLedgerIds.size}`);
  console.log(`Total Creditor Ledger IDs in buckets: ${buckets.creditorLedgerIds.size}`);

  // Let's inspect some debtor ledgers
  const debtors = Array.from(buckets.debtorLedgerIds).map(id => buckets.ledgerMap.get(id));
  console.log(`First 5 Debtor Ledgers:`, debtors.slice(0, 5));

  // Check postings for these debtors in FY 2024-2025
  const debtorPostings = await LedgerPosting.aggregate([
    {
      $match: {
        companyId: new mongoose.Types.ObjectId(companyId),
        ledgerId: { $in: Array.from(buckets.debtorLedgerIds).map(id => new mongoose.Types.ObjectId(id)) },
        date: { $gte: new Date("2024-04-01T00:00:00.000Z"), $lte: new Date("2025-03-31T23:59:59.999Z") }
      }
    },
    {
      $group: {
        _id: "$ledgerId",
        ledgerName: { $first: "$ledgerName" },
        dr: { $sum: "$debit" },
        cr: { $sum: "$credit" }
      }
    }
  ]);

  console.log(`Debtor postings in FY 2024-2025 count: ${debtorPostings.length}`);
  console.log(`Debtor postings sample:`, debtorPostings.slice(0, 5).map(p => ({
    name: p.ledgerName,
    dr: p.dr / 100,
    cr: p.cr / 100,
    net: (p.dr - p.cr) / 100
  })));

  // Why did Trial Balance show Sundry Debtors netDr = 0?
  // Let's check what parent groups exist for these debtors in allGroups
  const parentGroups = new Set();
  debtors.forEach(d => parentGroups.add(typeof d.parent === 'string' ? d.parent : d.parent?.name));
  console.log(`Debtor parent group names in ledger documents:`, Array.from(parentGroups));

  await mongoose.disconnect();
}

main().catch(console.error);
