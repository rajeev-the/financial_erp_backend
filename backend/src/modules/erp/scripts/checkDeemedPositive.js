import mongoose from "mongoose";
import dotenv from "dotenv";
import envConfig from "../../../config/env.js";
import LedgerBalanceDetails from "../../tally/ledger/ledgerBalanceDetails.schema.js";
import { getCompanyLedgerBuckets } from "../reports/groupHierarchy.helper.js";

dotenv.config();

async function main() {
  await mongoose.connect(envConfig.MONGO_URI);
  const companyId = "6aa0ebf73a3260ebc741698b";

  const buckets = await getCompanyLedgerBuckets(companyId);

  // Check Cash ledger balance detail
  for (const id of buckets.cashLedgerIds) {
    const b = await LedgerBalanceDetails.findOne({
      company_id: companyId,
      ledger_id: id,
      from_date: new Date("2024-04-01T00:00:00.000Z"),
    }).lean();
    const l = buckets.ledgerMap.get(id);
    console.log(`Cash ledger: ${l.name}`, b);
  }

  // Check Bank ledger balance detail
  for (const id of buckets.bankLedgerIds) {
    const b = await LedgerBalanceDetails.findOne({
      company_id: companyId,
      ledger_id: id,
      from_date: new Date("2024-04-01T00:00:00.000Z"),
    }).lean();
    const l = buckets.ledgerMap.get(id);
    console.log(`Bank ledger: ${l.name}`, b);
  }

  // Check a Creditor balance detail
  for (const id of buckets.creditorLedgerIds) {
    const b = await LedgerBalanceDetails.findOne({
      company_id: companyId,
      ledger_id: id,
      from_date: new Date("2024-04-01T00:00:00.000Z"),
      opening_balance: { $ne: 0 }
    }).lean();
    if (b) {
      const l = buckets.ledgerMap.get(id);
      console.log(`Sample Creditor with opening: ${l.name}`, b);
      break;
    }
  }

  await mongoose.disconnect();
}

main().catch(console.error);
