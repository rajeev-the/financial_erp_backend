const BASE_URL = "http://localhost:3000";
const COMPANY_ID = "6aa0ebf73a3260ebc741698b";

async function runPriority1Tests() {
  console.log("=================================================");
  console.log("   TESTING PRIORITY 1: CORE DAILY OPERATIONS     ");
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

  // ─── 1. Day Book Tests ──────────────────────────────────────────────────────
  console.log("--- 1. DAY BOOK ENDPOINTS ---");

  // A. Single Date
  const dbSingle = await testApi("Day Book: date='2026-08-21'", `${BASE_URL}/api/v1/erp/reports/daybook/${COMPANY_ID}`, {
    date: "2026-08-21",
  });
  console.log(`   Vouchers on 2026-08-21: ${dbSingle?.summary?.totalVouchers}, Total Amount: ₹${dbSingle?.summary?.totalAmount}`);

  // B. FY Range with voucher type filter
  const dbSales = await testApi("Day Book: fy=2024-2025 & voucherType=SALES", `${BASE_URL}/api/v1/erp/reports/daybook/${COMPANY_ID}`, {
    fy: "2024-2025",
    voucherType: "SALES",
    limit: 5,
  });
  console.log(`   FY 2024-25 Sales vouchers: ${dbSales?.summary?.totalVouchers}, Total: ₹${dbSales?.summary?.totalAmount?.toLocaleString("en-IN")}`);

  // C. Search filter
  const dbSearch = await testApi("Day Book: search='MSL'", `${BASE_URL}/api/v1/erp/reports/daybook/${COMPANY_ID}`, {
    search: "MSL",
    limit: 3,
  });
  console.log(`   Found ${dbSearch?.summary?.totalVouchers} vouchers matching 'MSL'`);

  // ─── 2. Ledger Statement Drill-Down ─────────────────────────────────────────
  console.log("\n--- 2. LEDGER ACCOUNT STATEMENT ---");

  // A. Customer Ledger Statement with Running Balance
  const custStmt = await testApi("Ledger Statement: 'META HR JOBWORKS PVT. LTD.'", `${BASE_URL}/api/v1/erp/reports/ledger/statement/${COMPANY_ID}`, {
    party_name: "META HR JOBWORKS PVT. LTD.",
    timeline: "all",
    limit: 5,
  });
  console.log(`   Party: ${custStmt?.ledger?.name} (${custStmt?.ledger?.accountType})`);
  console.log(`   Opening Balance: ₹${custStmt?.openingBalance?.amount} ${custStmt?.openingBalance?.type}`);
  console.log(`   Closing Balance: ₹${custStmt?.closingBalance?.amount} ${custStmt?.closingBalance?.type}`);
  console.log(`   Transactions count: ${custStmt?.summary?.transactionCount}`);
  if (custStmt?.transactions?.length > 0) {
    const firstTx = custStmt.transactions[0];
    console.log(`   Sample Entry: [${firstTx.date}] ${firstTx.voucherType} #${firstTx.voucherNumber} Dr: ₹${firstTx.debit} Cr: ₹${firstTx.credit} -> Running Bal: ₹${firstTx.runningBalance} ${firstTx.runningBalanceType}`);
  }

  // B. Cash Account Statement
  const cashStmt = await testApi("Ledger Statement: 'Cash'", `${BASE_URL}/api/v1/erp/reports/ledger/statement/${COMPANY_ID}`, {
    ledger_name: "Cash",
    limit: 3,
  });
  console.log(`   Cash Opening: ₹${cashStmt?.openingBalance?.amount} ${cashStmt?.openingBalance?.type}, Closing: ₹${cashStmt?.closingBalance?.amount} ${cashStmt?.closingBalance?.type}`);

  // ─── 3. Banking Accounts & Liquidity ────────────────────────────────────────
  console.log("\n--- 3. BANKING & LIQUIDITY ACCOUNTS ---");

  const bankReport = await testApi("Banking: All Accounts & Liquidity", `${BASE_URL}/api/v1/erp/reports/banking/accounts/${COMPANY_ID}`, {
    fy: "2024-2025",
  });
  console.log(`   Total Liquidity: ₹${bankReport?.liquiditySummary?.totalLiquidity?.toLocaleString("en-IN")}`);
  console.log(`   Bank Balance: ₹${bankReport?.liquiditySummary?.totalBankBalance?.toLocaleString("en-IN")}, Cash: ₹${bankReport?.liquiditySummary?.totalCashBalance?.toLocaleString("en-IN")}`);
  console.log(`   Active Banks: ${bankReport?.liquiditySummary?.activeBankCount}, Cash Accounts: ${bankReport?.liquiditySummary?.activeCashCount}`);
  if (bankReport?.bankAccounts?.length > 0) {
    console.log(`   Top Bank: ${bankReport.bankAccounts[0].name} -> Closing: ₹${bankReport.bankAccounts[0].closingBalance?.toLocaleString("en-IN")}`);
  }

  console.log("\n=================================================");
  console.log(`PRIORITY 1 TESTS: ${results.filter((r) => r.passed).length} / ${results.length} PASSED`);
  console.log("=================================================");
}

runPriority1Tests();
