import mongoose from "mongoose";
import envConfig from "../../../config/env.js";
import { calculateDashboardHomeData } from "../../dasboard/dasboard.service.js";
import { getUnifiedDashboardHomeService } from "../reports/dashboardReport.service.js";
import {
  getReceivablesSummaryService,
  getReceivablesPartiesService,
} from "../reports/receivablesReport.service.js";
import {
  getPayablesSummaryService,
  getPayablesPartiesService,
} from "../reports/payablesReport.service.js";
import {
  getMonthlyRegisterService,
} from "../reports/registersReport.service.js";

async function run() {
  await mongoose.connect(envConfig.MONGO_URI);
  const companyId = "6aa0ebf73a3260ebc741698b";

  console.log("===============================================================================");
  console.log("       UNIFIED ERP DASHBOARD & DRILL-DOWN RECONCILIATION VERIFICATION          ");
  console.log("===============================================================================\n");

  // TEST 1: Dashboard Home (All Time)
  console.log("--- TEST 1: Dashboard Home (Unbounded / All Time) ---");
  const [legacyAll, unifiedAll] = await Promise.all([
    calculateDashboardHomeData({ companyId }),
    getUnifiedDashboardHomeService({ companyId }),
  ]);

  console.table([
    { Metric: "Revenue", Legacy: legacyAll.revenue, Unified: unifiedAll.revenue, Diff: Math.abs(legacyAll.revenue - unifiedAll.revenue) },
    { Metric: "Cash Balance", Legacy: legacyAll.cash_balance, Unified: unifiedAll.cash_balance, Diff: Math.abs(legacyAll.cash_balance - unifiedAll.cash_balance) },
    { Metric: "Bank Balance", Legacy: legacyAll.bank_balance, Unified: unifiedAll.bank_balance, Diff: Math.abs(legacyAll.bank_balance - unifiedAll.bank_balance) },
    { Metric: "Receivables", Legacy: legacyAll.receivable, Unified: unifiedAll.receivable, Diff: Math.abs(legacyAll.receivable - unifiedAll.receivable) },
    { Metric: "Payables", Legacy: legacyAll.payable, Unified: unifiedAll.payable, Diff: Math.abs(legacyAll.payable - unifiedAll.payable) },
  ]);

  // TEST 2: Dashboard Home (FY 2024-25 Filter)
  console.log("\n--- TEST 2: Dashboard Home (With FY 2024-25 Filter) ---");
  const [legacyFy, unifiedFy] = await Promise.all([
    calculateDashboardHomeData({ companyId, from_date: "2024-04-01", to_date: "2025-03-31" }),
    getUnifiedDashboardHomeService({ companyId, from_date: "2024-04-01", to_date: "2025-03-31" }),
  ]);

  console.table([
    { Metric: "Revenue (FY)", Legacy: legacyFy.revenue, Unified: unifiedFy.revenue, Diff: Math.abs(legacyFy.revenue - unifiedFy.revenue) },
    { Metric: "Expense (FY)", Legacy: legacyFy.expense, Unified: unifiedFy.expense, Diff: Math.abs(legacyFy.expense - unifiedFy.expense) },
  ]);

  // TEST 3: Receivables Drill-Down
  console.log("\n--- TEST 3: Receivables Drill-Down Suite ---");
  const recSummary = await getReceivablesSummaryService({ companyId });
  const recParties = await getReceivablesPartiesService({ companyId, limit: 5 });
  console.log(`Total Receivables: ₹${recSummary.totalReceivable}, Overdue: ₹${recSummary.totalOverdue}, Not Due: ₹${recSummary.notDue}`);
  console.log(`Total Debtors Count: ${recParties.total}`);
  console.log("Top 5 Debtors by Outstanding Balance:");
  for (const p of recParties.parties) {
    console.log(` - ${p.name.padEnd(35)}: ₹${p.currentBalance.toLocaleString("en-IN")}`);
  }

  // TEST 4: Payables Drill-Down
  console.log("\n--- TEST 4: Payables Drill-Down Suite ---");
  const paySummary = await getPayablesSummaryService({ companyId });
  const payParties = await getPayablesPartiesService({ companyId, limit: 5 });
  console.log(`Total Payables: ₹${paySummary.totalPayable}, Overdue: ₹${paySummary.totalOverdue}, Not Due: ₹${paySummary.notDue}`);
  console.log(`Total Creditors Count: ${payParties.total}`);
  console.log("Top 5 Creditors by Outstanding Balance:");
  for (const p of payParties.parties) {
    console.log(` - ${p.name.padEnd(35)}: ₹${p.currentBalance.toLocaleString("en-IN")}`);
  }

  // TEST 5: Sales Register Monthly Trend
  console.log("\n--- TEST 5: Sales Register Monthly Trend ---");
  const salesReg = await getMonthlyRegisterService({ companyId, voucherType: "SALES" });
  console.log(`Total Sales Vouchers: ${salesReg.totalVouchers}, Total Gross: ₹${salesReg.totalGrossAmount.toLocaleString("en-IN")}`);
  console.log("Monthly Breakdown (Sample):");
  for (const m of salesReg.months.slice(0, 6)) {
    console.log(` - ${m.monthName} (${m.yearMonth}): ${m.voucherCount} invoices, Gross: ₹${m.grossAmount.toLocaleString("en-IN")}`);
  }

  console.log("\n===============================================================================");
  console.log("                      ALL RECONCILIATION CHECKS COMPLETED                      ");
  console.log("===============================================================================");

  await mongoose.disconnect();
}

run().catch(console.error);
