const BASE_URL = "http://localhost:3000";
const COMPANY_ID = "6aa0ebf73a3260ebc741698b";

async function main() {
  const dashRes = await fetch(`${BASE_URL}/api/v1/erp/reports/dashboard/home/${COMPANY_ID}?fy=2024-2025`);
  const dashJson = await dashRes.json();
  const dashboard = dashJson.data;

  const tbRes = await fetch(`${BASE_URL}/api/v1/erp/reports/financial/trial-balance/${COMPANY_ID}?fy=2024-2025`);
  const tbJson = await tbRes.json();
  const tb = tbJson.data;

  console.log("=== TRIAL BALANCE ALL GROUPS ===");
  console.log(tb.groups.map(g => ({
    group: g.groupName,
    periodDr: g.periodDebit,
    periodCr: g.periodCredit,
    closingDr: g.closingDebit,
    closingCr: g.closingCredit,
    ledgers: g.ledgerCount
  })));

  // Sum all groups that belong to Expenses:
  const expGroupNames = [
    "Personnal Expenses",
    "Indirect Expenses",
    "Professional Exp.",
    "All Licences",
    "Conveyance Expenses",
    "Bank Charges",
    "Insurance",
    "Stipend",
    "Legal & Professional Expenses",
    "Misc. Expenses"
  ];

  let tbTotalExpDr = 0;
  let tbTotalExpCr = 0;
  for (const g of tb.groups) {
    if (expGroupNames.includes(g.groupName)) {
      tbTotalExpDr += g.periodDebit;
      tbTotalExpCr += g.periodCredit;
    }
  }

  console.log("\n=== EXPENSE RECONCILIATION ===");
  console.log(`TB Exp Period Dr: ₹${tbTotalExpDr.toLocaleString()}`);
  console.log(`TB Exp Period Cr: ₹${tbTotalExpCr.toLocaleString()}`);
  console.log(`TB Exp Net Dr:    ₹${(tbTotalExpDr - tbTotalExpCr).toLocaleString()}`);
  console.log(`Dashboard Expense: ₹${dashboard.expense.toLocaleString()}`);
  console.log(`Difference: ₹${Math.round((tbTotalExpDr - tbTotalExpCr - dashboard.expense) * 100) / 100}`);

  // Sum all Sales groups:
  const salesGroupNames = ["Export_Sales", "Sales Accounts", "Local_Sales"];
  let tbTotalSalesCr = 0;
  let tbTotalSalesDr = 0;
  for (const g of tb.groups) {
    if (salesGroupNames.includes(g.groupName)) {
      tbTotalSalesCr += g.periodCredit;
      tbTotalSalesDr += g.periodDebit;
    }
  }

  console.log("\n=== SALES RECONCILIATION ===");
  console.log(`TB Sales Period Cr: ₹${tbTotalSalesCr.toLocaleString()}`);
  console.log(`TB Sales Period Dr: ₹${tbTotalSalesDr.toLocaleString()}`);
  console.log(`TB Sales Net:       ₹${(tbTotalSalesCr - tbTotalSalesDr).toLocaleString()}`);
  console.log(`Dashboard Revenue:  ₹${dashboard.revenue.toLocaleString()}`);
  console.log(`Difference: ₹${Math.round((tbTotalSalesCr - tbTotalSalesDr - dashboard.revenue) * 100) / 100}`);

  // Check Debtors:
  const debtorGroupNames = ["Sundry Debtors", "Export_Debtors", "Local_Debtors"];
  console.log("\n=== DEBTOR GROUPS IN TRIAL BALANCE ===");
  const debtorGroupsInTB = tb.groups.filter(g => debtorGroupNames.includes(g.groupName));
  console.log(debtorGroupsInTB);

  // Check Bank:
  const bankGroupNames = ["Bank Accounts", "Bank OD A/c", "Bank OCC A/c"];
  console.log("\n=== BANK GROUPS IN TRIAL BALANCE ===");
  const bankGroupsInTB = tb.groups.filter(g => bankGroupNames.includes(g.groupName));
  console.log(bankGroupsInTB);

  // Check Cash:
  const cashGroupNames = ["Cash-in-Hand", "Cash"];
  console.log("\n=== CASH GROUPS IN TRIAL BALANCE ===");
  const cashGroupsInTB = tb.groups.filter(g => cashGroupNames.includes(g.groupName));
  console.log(cashGroupsInTB);
}

main().catch(console.error);
