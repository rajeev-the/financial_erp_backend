import mongoose from "mongoose";
import dotenv from "dotenv";
import envConfig from "../../../config/env.js";
import LedgerBalanceDetails from "../../tally/ledger/ledgerBalanceDetails.schema.js";

dotenv.config();

async function main() {
  await mongoose.connect(envConfig.MONGO_URI);
  const companyId = "6aa0ebf73a3260ebc741698b";

  const allBal = await LedgerBalanceDetails.find({ company_id: companyId }).sort({ from_date: 1 }).lean();
  console.log(`Total balance detail records: ${allBal.length}`);

  // Check unique from_dates
  const dates = new Set(allBal.map(b => b.from_date?.toISOString()));
  console.log(`Unique from_dates:`, Array.from(dates));

  const nonZeroOpenings = allBal.filter(b => b.opening_balance !== 0);
  console.log(`Records with non-zero opening_balance: ${nonZeroOpenings.length}`);
  console.log(`Sample nonZeroOpenings:`, nonZeroOpenings.slice(0, 5));

  await mongoose.disconnect();
}

main().catch(console.error);
