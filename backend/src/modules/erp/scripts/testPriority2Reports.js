const BASE_URL = "http://localhost:3000";
const COMPANY_ID = "6aa0ebf73a3260ebc741698b";

async function runPriority2Tests() {
  console.log("=================================================");
  console.log("   TESTING PRIORITY 2: FINANCIAL STATEMENTS      ");
  console.log("=================================================\n");

  const results = [];

  const testApi = async (name, url, params = {}) => {
    try {
      const u = new URL(url);
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) u.searchParams.append(k, v);
      }
      const res = await fetch(u.toString());
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || `HTTP ${res.status}`);
      }
      const data = json.data;
      console.log(`✅ [PASS] ${name}`);
      results.push({ name, passed: true, sample: data });
      return data;
    } catch (err) {
      console.error(`❌ [FAIL] ${name} ->`, err.message);
      results.push({ name, passed: false, error: err.message });
      return null;
    }
  };

  // ─── 1. Profit & Loss Statement ─────────────────────────────────────────────
  console.log("--- 1. PROFIT & LOSS STATEMENT ---");

  const plFY = await testApi("P&L: fy=2024-2025", `${BASE_URL}/api/v1/erp/reports/financial/profit-loss/${COMPANY_ID}`, {
    fy: "2024-2025",
  });
  console.log(`   Sales Revenue: ₹${plFY?.tradingAccount?.income?.sales?.toLocaleString("en-IN")}`);
  console.log(`   Purchases: ₹${plFY?.tradingAccount?.expense?.purchases?.toLocaleString("en-IN")}`);
  console.log(`   Gross Profit: ₹${plFY?.tradingAccount?.grossProfit?.toLocaleString("en-IN")} (${plFY?.tradingAccount?.isGrossProfit ? "Profit" : "Loss"})`);
  console.log(`   Indirect Expenses: ₹${plFY?.incomeStatement?.indirectExpenses?.toLocaleString("en-IN")}`);
  console.log(`   Net Profit: ₹${plFY?.incomeStatement?.netProfit?.toLocaleString("en-IN")} (${plFY?.incomeStatement?.isNetProfit ? "Net Profit" : "Net Loss"})`);

  // ─── 2. Balance Sheet Schedule ──────────────────────────────────────────────
  console.log("\n--- 2. BALANCE SHEET SCHEDULE ---");

  const bsFY = await testApi("Balance Sheet: fy=2024-2025", `${BASE_URL}/api/v1/erp/reports/financial/balance-sheet/${COMPANY_ID}`, {
    fy: "2024-2025",
  });
  console.log(`   Total Liabilities & Equity: ₹${bsFY?.liabilities?.totalLiabilities?.toLocaleString("en-IN")}`);
  console.log(`   Total Assets: ₹${bsFY?.assets?.totalAssets?.toLocaleString("en-IN")}`);
  console.log(`   Working Capital: ₹${bsFY?.analysis?.workingCapital?.toLocaleString("en-IN")}`);
  console.log(`   Balance Status: ${bsFY?.analysis?.isBalanced ? "BALANCED (Within nominal rounding)" : "Imbalance"}`);

  // ─── 3. Trial Balance Tree ──────────────────────────────────────────────────
  console.log("\n--- 3. TRIAL BALANCE TREE ---");

  const tbFY = await testApi("Trial Balance: fy=2024-2025", `${BASE_URL}/api/v1/erp/reports/financial/trial-balance/${COMPANY_ID}`, {
    fy: "2024-2025",
  });
  console.log(`   Total Period Debit: ₹${tbFY?.totals?.periodDebit?.toLocaleString("en-IN")}`);
  console.log(`   Total Period Credit: ₹${tbFY?.totals?.periodCredit?.toLocaleString("en-IN")}`);
  console.log(`   Total Closing Debit: ₹${tbFY?.totals?.closingDebit?.toLocaleString("en-IN")}`);
  console.log(`   Total Closing Credit: ₹${tbFY?.totals?.closingCredit?.toLocaleString("en-IN")}`);
  console.log(`   Active Groups Count: ${tbFY?.groups?.length}`);
  console.log(`   Double-Entry Invariant: ${tbFY?.totals?.isBalanced ? "SATISFIED (Dr == Cr)" : "Discrepancy"}`);

  console.log("\n=================================================");
  console.log(`PRIORITY 2 TESTS: ${results.filter((r) => r.passed).length} / ${results.length} PASSED`);
  console.log("=================================================");
}

runPriority2Tests();
