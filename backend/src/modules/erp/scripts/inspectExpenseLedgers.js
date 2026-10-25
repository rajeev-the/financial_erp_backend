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

  // Match for FY 2024-2025: date string >= "2024-04-01" and <= "2025-03-31"
  const matchFilter = {
    companyId: new mongoose.Types.ObjectId(companyId),
    date: { $gte: "2024-04-01", $lte: "2025-03-31" },
  };

  const postings = await LedgerPosting.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: "$ledgerId",
        totalDebit: { $sum: "$debit" },
        totalCredit: { $sum: "$credit" },
      },
    },
  ]);

  console.log(`Total postings found in FY 2024-2025: ${postings.length}`);

  // Inspect which ledgers contributed to expense in Dashboard
  const expenseRows = [];
  let totalExpDr = 0;
  let totalExpCr = 0;

  for (const p of postings) {
    const id = p._id.toString();
    const isIndir = buckets.expenseLedgerIds.has(id);
    const isDir = buckets.directExpenseLedgerIds.has(id);

    if (isIndir || isDir) {
      const l = buckets.ledgerMap.get(id);
      const dr = p.totalDebit / 100;
      const cr = p.totalCredit / 100;
      totalExpDr += dr;
      totalExpCr += cr;
      expenseRows.push({
        id,
        name: l?.name,
        parent: l?.parent,
        type: isIndir ? "Indirect" : "Direct",
        dr,
        cr,
        netDr: dr - cr,
      });
    }
  }

  expenseRows.sort((a, b) => b.netDr - a.netDr);

  console.log(`\nFound ${expenseRows.length} expense ledgers in FY 2024-2025:`);
  console.log(`Total Dr: ${totalExpDr}, Total Cr: ${totalExpCr}, Net Dr: ${totalExpDr - totalExpCr}`);
  console.log("\nTop 15 expense ledgers by amount:");
  for (const row of expenseRows.slice(0, 15)) {
    console.log(`- [${row.type}] [Parent: "${row.parent}"] ${row.name}: Dr=₹${row.dr.toLocaleString()}, Cr=₹${row.cr.toLocaleString()}, Net=₹${row.netDr.toLocaleString()}`);
  }

  // Now let's check what parent groups exist among these expense ledgers!
  const parentExpGroups = new Map();
  for (const row of expenseRows) {
    const p = row.parent || "Primary";
    parentExpGroups.set(p, (parentExpGroups.get(p) || 0) + row.netDr);
  }

  console.log("\nExpense Totals by immediate parent group:");
  for (const [grp, amt] of parentExpGroups.entries()) {
    console.log(`- ${grp}: ₹${amt.toLocaleString()}`);
  }

  await mongoose.disconnect();
}

main().catch(console.error);
