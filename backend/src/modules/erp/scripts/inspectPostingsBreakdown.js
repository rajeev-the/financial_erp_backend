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

  // FY 2024-2025 date match: 2024-04-01 to 2025-03-31
  const fromDate = new Date("2024-04-01T00:00:00.000Z");
  const toDate = new Date("2025-03-31T23:59:59.999Z");

  const postings = await LedgerPosting.aggregate([
    {
      $match: {
        companyId: new mongoose.Types.ObjectId(companyId),
        date: { $gte: fromDate, $lte: toDate }
      }
    },
    {
      $group: {
        _id: "$ledgerId",
        totalDebit: { $sum: "$debit" },
        totalCredit: { $sum: "$credit" }
      }
    }
  ]);

  console.log(`Total posting groups in FY: ${postings.length}`);

  console.log("\n=== CHECKING DEBTOR POSTINGS ===");
  for (const id of buckets.debtorLedgerIds) {
    const p = postings.find((post) => post._id.toString() === id);
    if (p) {
      const l = buckets.ledgerMap.get(id);
      console.log(`Debtor: ${l.name} | parent: ${l.parent} | Dr: ${p.totalDebit / 100} | Cr: ${p.totalCredit / 100} | Net: ${(p.totalDebit - p.totalCredit) / 100}`);
    }
  }

  console.log("\n=== CHECKING CREDITOR POSTINGS ===");
  let credTotal = 0;
  for (const id of buckets.creditorLedgerIds) {
    const p = postings.find((post) => post._id.toString() === id);
    if (p) {
      const l = buckets.ledgerMap.get(id);
      const dr = p.totalDebit / 100;
      const cr = p.totalCredit / 100;
      const net = cr - dr;
      if (net > 0) credTotal += net;
      console.log(`Creditor: ${l.name} | parent: ${l.parent} | Dr: ${dr} | Cr: ${cr} | Net Cr: ${net}`);
    }
  }
  console.log(`Sum of positive creditor nets: ${credTotal}`);

  console.log("\n=== CHECKING EXPENSE POSTINGS ===");
  let expDr = 0, expCr = 0;
  for (const id of buckets.expenseLedgerIds) {
    const p = postings.find((post) => post._id.toString() === id);
    if (p) {
      expDr += p.totalDebit / 100;
      expCr += p.totalCredit / 100;
    }
  }
  console.log(`Indirect Expenses: Dr=${expDr}, Cr=${expCr}, Net=${expDr - expCr}`);

  let dirExpDr = 0, dirExpCr = 0;
  for (const id of buckets.directExpenseLedgerIds) {
    const p = postings.find((post) => post._id.toString() === id);
    if (p) {
      dirExpDr += p.totalDebit / 100;
      dirExpCr += p.totalCredit / 100;
    }
  }
  console.log(`Direct Expenses: Dr=${dirExpDr}, Cr=${dirExpCr}, Net=${dirExpDr - dirExpCr}`);

  await mongoose.disconnect();
}

main().catch(console.error);
