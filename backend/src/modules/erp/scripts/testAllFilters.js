const BASE_URL = "http://localhost:3000";
const COMPANY_ID = "6aa0ebf73a3260ebc741698b";

async function runFilterTests() {
  console.log("=================================================");
  console.log("   TESTING COMPREHENSIVE FILTERS IN REPORT APIs  ");
  console.log("=================================================\n");

  const results = [];

  // Helper tester
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

  // ─── 1. Dashboard Filter Tests ──────────────────────────────────────────────
  console.log("--- 1. DASHBOARD HOME FILTERS ---");

  // A. All-Time
  const dashAll = await testApi("Dashboard: timeline=all", `${BASE_URL}/api/v1/erp/reports/dashboard/home/${COMPANY_ID}`, {
    timeline: "all",
  });
  console.log(`   Revenue (All): ₹${dashAll?.revenue?.toLocaleString("en-IN")}`);

  // B. FY 2024-25 filter
  const dashFY = await testApi("Dashboard: fy=2024-2025", `${BASE_URL}/api/v1/erp/reports/dashboard/home`, {
    company_id: COMPANY_ID,
    fy: "2024-2025",
  });
  console.log(`   Revenue (FY 2024-25): ₹${dashFY?.revenue?.toLocaleString("en-IN")}, Cash: ₹${dashFY?.cash_balance}`);

  // C. Explicit from_date / to_date
  await testApi("Dashboard: from_date=2024-04-01 & to_date=2024-09-30", `${BASE_URL}/api/v1/erp/reports/dashboard/home`, {
    companyId: COMPANY_ID,
    from_date: "2024-04-01",
    to_date: "2024-09-30",
  });

  // D. Indian Quarter filter (Q1 FY2024)
  const dashQ1 = await testApi("Dashboard: quarter=Q1 & targetYear=2024", `${BASE_URL}/api/v1/erp/reports/dashboard/home/${COMPANY_ID}`, {
    quarter: "Q1",
    targetYear: 2024,
  });
  console.log(`   Period resolved: ${dashQ1?.period?.from_date} to ${dashQ1?.period?.to_date}, Revenue: ₹${dashQ1?.revenue}`);

  // E. Mobile legacy route compatibility (/api/v1/dasboard/home/:companyId)
  const dashLegacy = await testApi("Dashboard: Legacy Route (/api/v1/dasboard/home/:id)", `${BASE_URL}/api/v1/dasboard/home/${COMPANY_ID}`, {
    fy: "2024-2025",
  });
  console.log(`   Legacy Route Revenue: ₹${dashLegacy?.revenue?.toLocaleString("en-IN")}`);

  // ─── 2. Receivables Suite Filter Tests ──────────────────────────────────────
  console.log("\n--- 2. RECEIVABLES SUITE FILTERS ---");

  // A. Summary with FY filter
  await testApi("Receivables: Summary with fy=2024-2025", `${BASE_URL}/api/v1/erp/reports/receivables/summary/${COMPANY_ID}`, {
    fy: "2024-2025",
  });

  // B. Parties: Search by keyword 'META'
  const partiesSearch = await testApi("Receivables Parties: search='META'", `${BASE_URL}/api/v1/erp/reports/receivables/parties/${COMPANY_ID}`, {
    search: "META",
  });
  console.log(`   Found ${partiesSearch?.total} parties matching 'META': ${partiesSearch?.parties?.[0]?.name}`);

  // C. Parties: Min balance filter > 1,00,000
  const partiesMinBal = await testApi("Receivables Parties: minBalance=100000", `${BASE_URL}/api/v1/erp/reports/receivables/parties`, {
    companyId: COMPANY_ID,
    minBalance: 100000,
  });
  console.log(`   Parties with balance > 1L: ${partiesMinBal?.total}`);

  // D. Parties: Sorting by name ascending
  const partiesSort = await testApi("Receivables Parties: sortBy=name & sortOrder=asc", `${BASE_URL}/api/v1/erp/reports/receivables/parties`, {
    company_id: COMPANY_ID,
    sortBy: "name",
    sortOrder: "asc",
    limit: 3,
  });
  console.log(`   First 3 alphabetized: ${partiesSort?.parties?.map((p) => p.name).join(", ")}`);

  // E. Customer Bills: Lookup by party_name query parameter
  const billsByName = await testApi("Customer Bills: lookup by party_name='META HR JOBWORKS PVT. LTD.'", `${BASE_URL}/api/v1/erp/reports/receivables/bills`, {
    companyId: COMPANY_ID,
    party_name: "META HR JOBWORKS PVT. LTD.",
    limit: 3,
  });
  console.log(`   Total bills for party: ${billsByName?.total}, Party name: ${billsByName?.party?.name}`);

  // F. Customer Bills: Aging bracket filter '61-90'
  const billsBracket = await testApi("Customer Bills: agingBracket='61-90'", `${BASE_URL}/api/v1/erp/reports/receivables/bills`, {
    companyId: COMPANY_ID,
    party_name: "META HR JOBWORKS PVT. LTD.",
    agingBracket: "61-90",
  });
  console.log(`   Bills in bracket 61-90: ${billsBracket?.total}, Bracket pending totals:`, billsBracket?.bracketTotals);

  // G. Customer Bills: Status filter 'UNPAID' & search voucher number
  await testApi("Customer Bills: paymentStatus='UNPAID' & search='0023'", `${BASE_URL}/api/v1/erp/reports/receivables/bills`, {
    companyId: COMPANY_ID,
    party_name: "META HR JOBWORKS PVT. LTD.",
    paymentStatus: "UNPAID",
    search: "0023",
  });

  // ─── 3. Sales Register Filters ──────────────────────────────────────────────
  console.log("\n--- 3. SALES REGISTER FILTERS ---");

  // A. Monthly Register for FY 2024-25
  const regFY = await testApi("Sales Register: fy=2024-2025", `${BASE_URL}/api/v1/erp/reports/sales/register/monthly/${COMPANY_ID}`, {
    fy: "2024-2025",
  });
  console.log(`   Total gross sales: ₹${regFY?.totalGrossAmount?.toLocaleString("en-IN")}, Active months count: ${regFY?.months?.length}`);

  // B. Month Vouchers drilldown with search & payment status
  const monthVouchers = await testApi("Month Vouchers: yearMonth='2026-08' & paymentStatus='UNPAID'", `${BASE_URL}/api/v1/erp/reports/sales/register/month/2026-08/vouchers/${COMPANY_ID}`, {
    paymentStatus: "UNPAID",
    limit: 5,
  });
  console.log(`   Aug 2026 vouchers count: ${monthVouchers?.total}`);

  console.log("\n=================================================");
  console.log(`ALL FILTER TESTS COMPLETED: ${results.filter((r) => r.passed).length} / ${results.length} PASSED`);
  console.log("=================================================");
}

runFilterTests();
