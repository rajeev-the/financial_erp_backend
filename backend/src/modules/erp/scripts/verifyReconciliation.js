const BASE_URL = "http://localhost:3000";
const COMPANY_ID = "6aa0ebf73a3260ebc741698b";

async function fetchApi(url, params = {}) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) u.searchParams.append(k, v);
  }
  const res = await fetch(u.toString());
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`API Error ${res.status}: ${json.message || "Failed"}`);
  }
  return json.data ?? json;
}

async function verifyFinancialReconciliation() {
  console.log("=========================================================================================");
  console.log("             COMPREHENSIVE ERP RECONCILIATION: DASHBOARD vs TRIAL BALANCE                ");
  console.log("=========================================================================================\n");

  const [dashboard, trialBalance, pnl, balanceSheet] = await Promise.all([
    fetchApi(`${BASE_URL}/api/v1/erp/reports/dashboard/home/${COMPANY_ID}`, { fy: "2024-2025" }),
    fetchApi(`${BASE_URL}/api/v1/erp/reports/financial/trial-balance/${COMPANY_ID}`, { fy: "2024-2025" }),
    fetchApi(`${BASE_URL}/api/v1/erp/reports/financial/profit-loss/${COMPANY_ID}`, { fy: "2024-2025" }),
    fetchApi(`${BASE_URL}/api/v1/erp/reports/financial/balance-sheet/${COMPANY_ID}`, { fy: "2024-2025" }),
  ]);

  console.log("1. DASHBOARD OVERVIEW:");
  console.log({
    revenue: `₹${dashboard.revenue.toLocaleString()}`,
    expense: `₹${dashboard.expense.toLocaleString()}`,
    profit: `₹${dashboard.profit.toLocaleString()}`,
    cash_balance: `₹${dashboard.cash_balance.toLocaleString()}`,
    bank_balance: `₹${dashboard.bank_balance.toLocaleString()}`,
    receivables: `₹${dashboard.receivables.toLocaleString()}`,
    payables: `₹${dashboard.payables.toLocaleString()}`,
  });

  console.log("\n2. TRIAL BALANCE OVERVIEW:");
  console.log({
    openingDebit: `₹${trialBalance.totals.openingDebit.toLocaleString()}`,
    openingCredit: `₹${trialBalance.totals.openingCredit.toLocaleString()}`,
    periodDebit: `₹${trialBalance.totals.periodDebit.toLocaleString()}`,
    periodCredit: `₹${trialBalance.totals.periodCredit.toLocaleString()}`,
    closingDebit: `₹${trialBalance.totals.closingDebit.toLocaleString()}`,
    closingCredit: `₹${trialBalance.totals.closingCredit.toLocaleString()}`,
    isBalanced: trialBalance.totals.isBalanced,
    categories: trialBalance.totals.categories,
  });

  console.log("\n3. PROFIT & LOSS OVERVIEW:");
  console.log({
    sales: `₹${pnl.tradingAccount.income.sales.toLocaleString()}`,
    grossProfit: `₹${pnl.tradingAccount.grossProfit.toLocaleString()}`,
    indirectExpenses: `₹${pnl.incomeStatement.indirectExpenses.toLocaleString()}`,
    netProfit: `₹${pnl.incomeStatement.netProfit.toLocaleString()}`,
  });

  console.log("\n4. BALANCE SHEET OVERVIEW:");
  console.log({
    totalLiabilities: `₹${balanceSheet.liabilities.totalLiabilities.toLocaleString()}`,
    totalAssets: `₹${balanceSheet.assets.totalAssets.toLocaleString()}`,
    workingCapital: `₹${balanceSheet.analysis.workingCapital.toLocaleString()}`,
    isBalanced: balanceSheet.analysis.isBalanced,
  });

  console.log("\n=========================================================================================");
  console.log("5. SIDE-BY-SIDE METRIC RECONCILIATION TABLE:");
  console.log("=========================================================================================");
  console.log("Metric                  | Dashboard Home      | Trial Balance (Cat) | P&L / B-Sheet       | Status");
  console.log("------------------------+---------------------+---------------------+---------------------+-------");

  const checkMatch = (name, valDash, valTb, valOther) => {
    const diff = Math.abs(valDash - valTb);
    const isMatch = diff < 0.05;
    const pad = (s, n) => String(s).padEnd(n);
    console.log(
      `${pad(name, 23)} | ${pad("₹" + valDash.toLocaleString(), 19)} | ${pad("₹" + valTb.toLocaleString(), 19)} | ${pad("₹" + (valOther !== undefined ? valOther.toLocaleString() : "-"), 19)} | ${isMatch ? "MATCH (0.00)" : "DIFF: " + diff.toFixed(2)}`
    );
  };

  const tbCats = trialBalance.totals.categories;
  checkMatch("Revenue (Sales)", dashboard.revenue, tbCats.revenue, pnl.tradingAccount.income.sales);
  checkMatch("Purchases", dashboard.breakdown.purchase, tbCats.purchase, pnl.tradingAccount.expense.purchases);
  checkMatch("Total Expenses", dashboard.expense, tbCats.expense, pnl.incomeStatement.indirectExpenses);
  checkMatch("Cash Balance", dashboard.cash_balance, tbCats.cashBalance, balanceSheet.assets.currentAssets.cashInHand);
  checkMatch("Bank Balance", dashboard.bank_balance, tbCats.bankBalance, balanceSheet.assets.currentAssets.bankAccounts);
  checkMatch("Receivables (Debtors)", dashboard.receivables, tbCats.receivables, balanceSheet.assets.currentAssets.sundryDebtors);
  checkMatch("Payables (Creditors)", dashboard.payables, tbCats.payables, balanceSheet.liabilities.currentLiabilities.sundryCreditors);
  console.log("=========================================================================================\n");
}

verifyFinancialReconciliation().catch(console.error);
