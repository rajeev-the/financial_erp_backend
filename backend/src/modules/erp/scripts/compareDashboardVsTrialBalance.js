const BASE_URL = "http://localhost:3000";
const COMPANY_ID = "6aa0ebf73a3260ebc741698b";

async function fetchJson(endpoint, params = {}) {
  const u = new URL(`${BASE_URL}${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) u.searchParams.append(k, v);
  }
  const res = await fetch(u.toString());
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Failed ${u.toString()}: ${json.message || res.statusText}`);
  }
  return json.data ?? json;
}

async function main() {

  for (const filterDesc of ["With FY 2024-2025", "Without Date Filter (All Time)"]) {
    console.log(`\n===============================================================`);
    console.log(`COMPARISON: ${filterDesc}`);
    console.log(`===============================================================`);

    const params = filterDesc.includes("FY") ? { fy: "2024-2025" } : {};

    const dashboard = await fetchJson(`/api/v1/erp/reports/dashboard/home/${COMPANY_ID}`, params);
    const trialBalance = await fetchJson(`/api/v1/erp/reports/financial/trial-balance/${COMPANY_ID}`, params);

    console.log("\n--- 1. DASHBOARD OUTPUT ---");
    console.log({
      revenue: dashboard.revenue,
      expense: dashboard.expense,
      profit: dashboard.profit,
      cash_balance: dashboard.cash_balance,
      bank_balance: dashboard.bank_balance,
      receivables: dashboard.receivables,
      payables: dashboard.payables,
      breakdown: dashboard.breakdown,
    });

    console.log("\n--- 2. TRIAL BALANCE SUMMARY ---");
    console.log(trialBalance.totals);

    console.log("\n--- 3. TRIAL BALANCE GROUPS CORRESPONDING TO DASHBOARD ---");
    const tbGroups = trialBalance.groups;

    // Helper to find or sum groups
    function getGroup(nameSubstr) {
      return tbGroups.filter((g) => g.groupName.toLowerCase().includes(nameSubstr.toLowerCase()));
    }

    const salesGroups = getGroup("sales");
    const purchaseGroups = getGroup("purchase");
    const indirectExpGroups = getGroup("indirect expense");
    const directExpGroups = getGroup("direct expense");
    const debtorGroups = getGroup("sundry debtor");
    const creditorGroups = getGroup("sundry creditor");
    const bankGroups = getGroup("bank account");
    const cashGroups = getGroup("cash");

    const sumClosingNet = (groups, normalSide = "Dr") => {
      let total = 0;
      for (const g of groups) {
        if (normalSide === "Dr") {
          total += (g.closingDebit - g.closingCredit);
        } else {
          total += (g.closingCredit - g.closingDebit);
        }
      }
      return Math.round(total * 100) / 100;
    };

    const sumPeriodNet = (groups, normalSide = "Dr") => {
      let total = 0;
      for (const g of groups) {
        if (normalSide === "Dr") {
          total += (g.periodDebit - g.periodCredit);
        } else {
          total += (g.periodCredit - g.periodDebit);
        }
      }
      return Math.round(total * 100) / 100;
    };

    const tbSalesPeriod = sumPeriodNet(salesGroups, "Cr");
    const tbSalesClosing = sumClosingNet(salesGroups, "Cr");

    const tbPurchPeriod = sumPeriodNet(purchaseGroups, "Dr");
    const tbPurchClosing = sumClosingNet(purchaseGroups, "Dr");

    const tbExpPeriod = sumPeriodNet([...indirectExpGroups, ...directExpGroups], "Dr");
    const tbExpClosing = sumClosingNet([...indirectExpGroups, ...directExpGroups], "Dr");

    const tbDebtorsClosing = sumClosingNet(debtorGroups, "Dr");
    const tbCreditorsClosing = sumClosingNet(creditorGroups, "Cr");

    const tbBankClosing = sumClosingNet(bankGroups, "Dr");
    const tbCashClosing = sumClosingNet(cashGroups, "Dr");

    console.log(`\nDetailed Group Breakdown in Trial Balance:`);
    console.log(`Sales Groups:`, salesGroups.map(g => ({ name: g.groupName, periodCredit: g.periodCredit, periodDebit: g.periodDebit, closingCredit: g.closingCredit, closingDebit: g.closingDebit })));
    console.log(`Purchase Groups:`, purchaseGroups.map(g => ({ name: g.groupName, periodCredit: g.periodCredit, periodDebit: g.periodDebit, closingCredit: g.closingCredit, closingDebit: g.closingDebit })));
    console.log(`Indirect Exp Groups:`, indirectExpGroups.map(g => ({ name: g.groupName, periodDebit: g.periodDebit, periodCredit: g.periodCredit, closingDebit: g.closingDebit, closingCredit: g.closingCredit })));
    console.log(`Sundry Debtors Groups:`, debtorGroups.map(g => ({ name: g.groupName, closingDebit: g.closingDebit, closingCredit: g.closingCredit, netDr: g.closingDebit - g.closingCredit })));
    console.log(`Sundry Creditors Groups:`, creditorGroups.map(g => ({ name: g.groupName, closingDebit: g.closingDebit, closingCredit: g.closingCredit, netCr: g.closingCredit - g.closingDebit })));
    console.log(`Bank Accounts Groups:`, bankGroups.map(g => ({ name: g.groupName, closingDebit: g.closingDebit, closingCredit: g.closingCredit, netDr: g.closingDebit - g.closingCredit })));
    console.log(`Cash Groups:`, cashGroups.map(g => ({ name: g.groupName, closingDebit: g.closingDebit, closingCredit: g.closingCredit, netDr: g.closingDebit - g.closingCredit })));

    console.log(`\n===============================================================`);
    console.log(`RECONCILIATION TABLE:`);
    console.log(`Metric                  | Dashboard Home      | Trial Balance (Net) | Diff`);
    console.log(`------------------------+---------------------+---------------------+------`);
    const diff = (a, b) => Math.round((a - b) * 100) / 100;

    console.log(`Revenue (Sales)         | ₹${dashboard.revenue.toLocaleString()} | ₹${tbSalesPeriod.toLocaleString()} | ${diff(dashboard.revenue, tbSalesPeriod)}`);
    console.log(`Purchases               | ₹${dashboard.breakdown.purchase.toLocaleString()} | ₹${tbPurchPeriod.toLocaleString()} | ${diff(dashboard.breakdown.purchase, tbPurchPeriod)}`);
    console.log(`Indirect/Direct Expense | ₹${dashboard.breakdown.indirectExpense.toLocaleString()} | ₹${tbExpPeriod.toLocaleString()} | ${diff(dashboard.breakdown.indirectExpense, tbExpPeriod)}`);
    console.log(`Cash Balance            | ₹${dashboard.cash_balance.toLocaleString()} | ₹${tbCashClosing.toLocaleString()} | ${diff(dashboard.cash_balance, tbCashClosing)}`);
    console.log(`Bank Balance            | ₹${dashboard.bank_balance.toLocaleString()} | ₹${tbBankClosing.toLocaleString()} | ${diff(dashboard.bank_balance, tbBankClosing)}`);
    console.log(`Receivables (Debtors)   | ₹${dashboard.receivables.toLocaleString()} | ₹${tbDebtorsClosing.toLocaleString()} | ${diff(dashboard.receivables, tbDebtorsClosing)}`);
  }
}

main().catch(console.error);
