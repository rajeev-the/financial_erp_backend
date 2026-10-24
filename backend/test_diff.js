import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import { calculateReceivablesService } from './src/modules/tally/receivables/receivables.services.js';
import { calculatePayablesService } from './src/modules/tally/payables/payables.services.js';
import { calculateDashboardHomeData } from './src/modules/dasboard/dasboard.service.js';
import Receivable from './src/modules/tally/receivables/receivable.schema.js';
import Payable from './src/modules/tally/payables/payable.schema.js';

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const companyId = "6aa0ebf73a3260ebc741698b";

  console.log("=== 1. DASHBOARD HOME DATA ===");
  const dashData = await calculateDashboardHomeData({ companyId });
  console.log("Dashboard Receivable:", dashData.receivable);
  console.log("Dashboard Payable:", dashData.payable);

  console.log("\n=== 2. CALCULATE RECEIVABLES SERVICE ===");
  const recService = await calculateReceivablesService({ companyId });
  console.log("recService.total_receivable:", recService.total_receivable);
  console.log("recService.closing_balance:", recService.closing_balance);
  console.log("recService.amount:", recService.amount);

  console.log("\n=== 3. CALCULATE PAYABLES SERVICE ===");
  const payService = await calculatePayablesService({ companyId });
  console.log("payService.total_payable:", payService.total_payable);
  console.log("payService.closing_balance:", payService.closing_balance);
  console.log("payService.amount:", payService.amount);

  console.log("\n=== 4. RECEIVABLES COLLECTION (Bills) ===");
  const recBills = await Receivable.find({ company_id: companyId, is_deleted: { $ne: true } });
  console.log("RecBills count:", recBills.length);
  let recPositiveSum = 0;
  let recAbsSum = 0;
  let recRawSum = 0;
  for (const b of recBills) {
    const amt = b.closing_amount || 0;
    recRawSum += amt;
    recAbsSum += Math.abs(amt);
    if (amt > 0) recPositiveSum += amt;
  }
  console.log("RecBills rawSum:", recRawSum);
  console.log("RecBills absSum:", recAbsSum);
  console.log("RecBills positiveSum:", recPositiveSum);

  console.log("\n=== 5. PAYABLES COLLECTION (Bills) ===");
  const payBills = await Payable.find({ company_id: companyId, is_deleted: { $ne: true } });
  console.log("PayBills count:", payBills.length);
  let payPositiveSum = 0;
  let payAbsSum = 0;
  let payRawSum = 0;
  for (const b of payBills) {
    const amt = b.closing_amount || 0;
    payRawSum += amt;
    payAbsSum += Math.abs(amt);
    if (amt > 0) payPositiveSum += amt;
  }
  console.log("PayBills rawSum:", payRawSum);
  console.log("PayBills absSum:", payAbsSum);
  console.log("PayBills positiveSum:", payPositiveSum);

  await mongoose.disconnect();
}

run().catch(console.error);
