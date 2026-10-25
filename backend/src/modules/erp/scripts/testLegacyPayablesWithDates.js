import mongoose from "mongoose";
import dotenv from "dotenv";
import envConfig from "../../../config/env.js";
import { calculatePayablesService } from "../../tally/payables/payables.services.js";

dotenv.config();

async function main() {
  await mongoose.connect(envConfig.MONGO_URI);
  const companyId = "6aa0ebf73a3260ebc741698b";

  console.log("=== 1. LEGACY WITHOUT DATES (ALL TIME) ===");
  const legAll = await calculatePayablesService({ companyId });
  console.log({
    total_payable: legAll.total_payable,
    closing_balance: legAll.closing_balance,
    creditors_count: legAll.creditors_count,
    vendors_with_pending: legAll.vendors.filter(v => v.closing_balance > 0).map(v => ({ name: v.party_name, amt: v.closing_balance }))
  });

  console.log("\n=== 2. LEGACY WITH FY 2024-2025 ===");
  const legFY = await calculatePayablesService({
    companyId,
    from_date: "2024-04-01",
    to_date: "2025-03-31"
  });
  console.log({
    total_payable: legFY.total_payable,
    closing_balance: legFY.closing_balance,
    creditors_count: legFY.creditors_count,
    vendors_with_pending: legFY.vendors.filter(v => v.closing_balance > 0).map(v => ({ name: v.party_name, amt: v.closing_balance }))
  });

  // Let's check Neha Rathod, LAXMI NAUGAIN, Mayank Jain in legAll vs legFY
  const testParties = ["Neha Rathod", "LAXMI NAUGAIN", "Mayank Jain", "Vivek Rai", "CSS FOUNDER PVT LTD", "SBI Gen. Insurance"];
  console.log("\n=== 3. PARTY DETAILS IN LEGACY ===");
  for (const name of testParties) {
    const vAll = legAll.vendors.find(v => v.party_name.toLowerCase().includes(name.toLowerCase()));
    const vFY = legFY.vendors.find(v => v.party_name.toLowerCase().includes(name.toLowerCase()));
    console.log(`\nParty: ${name}`);
    if (vAll) {
      console.log(`  All Time: Opening=${vAll.opening_balance}, Cr=${vAll.total_credit}, Dr=${vAll.total_debit}, Net=${vAll.closing_balance}, Status=${vAll.status}`);
    } else {
      console.log(`  All Time: NOT FOUND in vendors`);
    }
    if (vFY) {
      console.log(`  FY 24-25: Opening=${vFY.opening_balance}, Cr=${vFY.total_credit}, Dr=${vFY.total_debit}, Net=${vFY.closing_balance}, Status=${vFY.status}`);
    } else {
      console.log(`  FY 24-25: NOT FOUND in vendors`);
    }
  }

  await mongoose.disconnect();
}

main().catch(console.error);
