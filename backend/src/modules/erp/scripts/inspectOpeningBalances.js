import mongoose from "mongoose";
import dotenv from "dotenv";
import envConfig from "../../../config/env.js";
import Ledger from "../../tally/ledger/ledger.schema.js";
import LedgerBalanceDetails from "../../tally/ledger/ledgerBalanceDetails.schema.js";
import LedgerPosting from "../ledger/ledgerPosting.schema.js";
import { getCompanyLedgerBuckets } from "../reports/groupHierarchy.helper.js";

dotenv.config();

async function main() {
  await mongoose.connect(envConfig.MONGO_URI);
  const companyId = "6aa0ebf73a3260ebc741698b";

  console.log("=== CHECKING LEDGER OPENING BALANCES ===");
  const nonZeroLedgers = await Ledger.find({
    company_id: companyId,
    opening_balance: { $exists: true, $ne: 0, $ne: "0", $ne: "" },
  }).select("name parent opening_balance closing_balance").lean();
  console.log(`Found ${nonZeroLedgers.length} ledgers with non-zero opening_balance in Ledger collection:`);
  console.log(nonZeroLedgers.slice(0, 10));

  console.log("\n=== CHECKING LEDGER BALANCE DETAILS ===");
  const balanceDetailsCount = await LedgerBalanceDetails.countDocuments({ company_id: companyId });
  console.log(`Total LedgerBalanceDetails docs for company: ${balanceDetailsCount}`);
  if (balanceDetailsCount > 0) {
    const sampleBalanceDetails = await LedgerBalanceDetails.find({
      company_id: companyId,
      opening_balance: { $exists: true, $ne: 0, $ne: "0", $ne: "" },
    }).limit(10).lean();
    console.log(`Sample non-zero LedgerBalanceDetails:`, sampleBalanceDetails);
  }

  console.log("\n=== CHECKING EARLIEST & LATEST POSTING DATES ===");
  const earliestPosting = await LedgerPosting.findOne({ companyId }).sort({ date: 1 }).lean();
  const latestPosting = await LedgerPosting.findOne({ companyId }).sort({ date: -1 }).lean();
  console.log("Earliest posting date:", earliestPosting?.date, "voucher:", earliestPosting?.voucherNumber);
  console.log("Latest posting date:", latestPosting?.date, "voucher:", latestPosting?.voucherNumber);

  await mongoose.disconnect();
}

main().catch(console.error);
