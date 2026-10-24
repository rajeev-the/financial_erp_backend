import mongoose from "mongoose";
import envConfig from "../../../config/env.js";
import { calculateAccountingService } from "../../tally/accounting/accounting.controller.js";
import LedgerPosting from "../ledger/ledgerPosting.schema.js";

async function run() {
  await mongoose.connect(envConfig.MONGO_URI);
  const companyId = new mongoose.Types.ObjectId("6aa0ebf73a3260ebc741698b");

  // Run with FY 2024-25 date filter
  const from_date = "2024-04-01";
  const to_date = "2025-03-31";

  const legacyPurch = await calculateAccountingService({ companyId, requirement: "purchase", from_date, to_date });
  const legacyExp = await calculateAccountingService({ companyId, requirement: "expense", from_date, to_date });
  const legacySales = await calculateAccountingService({ companyId, requirement: "sales", from_date, to_date });

  console.log("With FY 24-25 filter:");
  console.log("Legacy Sales:   ", legacySales.amount);
  console.log("Legacy Purchase:", legacyPurch.amount);
  console.log("Legacy Expense: ", legacyExp.amount);
  console.log("Legacy Combined:", legacyPurch.amount + legacyExp.amount);

  await mongoose.disconnect();
}

run().catch(console.error);
