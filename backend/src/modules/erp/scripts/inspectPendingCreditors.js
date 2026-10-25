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

  console.log("=== CHECKING ALL CREDITORS IN ERP ACROSS ALL TIME ===");
  const pending = [];
  for (const id of buckets.creditorLedgerIds) {
    const l = buckets.ledgerMap.get(id);
    const p = postMap.get(id) || { dr: 0, cr: 0 };
    const rawOpen = l.openingBalance || 0;
    // In our helper: rawOpen < 0 is Debit, rawOpen > 0 is Credit
    const openDr = rawOpen < 0 ? Math.abs(rawOpen) : 0;
    const openCr = rawOpen > 0 ? Math.abs(rawOpen) : 0;
    const net = (openCr + p.cr) - (openDr + p.dr);
    if (net > 0.01) {
      pending.push({
        id,
        name: l.name,
        parent: l.parent,
        rawOpen,
        openDr,
        openCr,
        pDr: p.dr,
        pCr: p.cr,
        netPayable: Math.round(net * 100) / 100
      });
    }
  }

  console.log(`Found ${pending.length} pending creditors in ERP across all time:`);
  for (const v of pending) {
    console.log(`- ${v.name}: rawOpen=${v.rawOpen}, openCr=${v.openCr}, openDr=${v.openDr}, pCr=${v.pCr}, pDr=${v.pDr}, netPayable=${v.netPayable}`);
  }

  const sumAllTime = pending.reduce((acc, v) => acc + v.netPayable, 0);
  console.log(`\nTotal Payables in ERP across ALL TIME: ₹${sumAllTime}`);

  // Now let's check FY 2024-2025 in ERP
  const postingsFY = await LedgerPosting.aggregate([
    {
      $match: {
        companyId: new mongoose.Types.ObjectId(companyId),
        date: { $gte: "2024-04-01", $lte: "2025-03-31" }
      }
    },
    {
      $group: {
        _id: "$ledgerId",
        dr: { $sum: "$debit" },
        cr: { $sum: "$credit" }
      }
    }
  ]);
  const postMapFY = new Map();
  for (const p of postingsFY) {
    postMapFY.set(p._id.toString(), { dr: p.dr / 100, cr: p.cr / 100 });
  }

  const pendingFY = [];
  for (const id of buckets.creditorLedgerIds) {
    const l = buckets.ledgerMap.get(id);
    const p = postMapFY.get(id) || { dr: 0, cr: 0 };
    const rawOpen = l.openingBalance || 0;
    const openDr = rawOpen < 0 ? Math.abs(rawOpen) : 0;
    const openCr = rawOpen > 0 ? Math.abs(rawOpen) : 0;
    const net = (openCr + p.cr) - (openDr + p.dr);
    if (net > 0.01) {
      pendingFY.push({
        id,
        name: l.name,
        rawOpen,
        openCr,
        pDr: p.dr,
        pCr: p.cr,
        netPayable: Math.round(net * 100) / 100
      });
    }
  }

  console.log(`\nFound ${pendingFY.length} pending creditors in ERP for FY 2024-2025:`);
  for (const v of pendingFY.slice(0, 15)) {
    console.log(`- ${v.name}: rawOpen=${v.rawOpen}, openCr=${v.openCr}, pCr=${v.pCr}, pDr=${v.pDr}, netPayable=${v.netPayable}`);
  }
  const sumFY = pendingFY.reduce((acc, v) => acc + v.netPayable, 0);
  console.log(`\nTotal Payables in ERP for FY 2024-2025: ₹${sumFY}`);

  await mongoose.disconnect();
}

main().catch(console.error);
