const BASE_URL = "http://localhost:3000";
const COMPANY_ID = "6aa0ebf73a3260ebc741698b";

async function runPriority3Tests() {
  console.log("=================================================");
  console.log("   TESTING PRIORITY 3: ANALYTICS & INVENTORY     ");
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

  // ─── 1. Party Volume Rankings ───────────────────────────────────────────────
  console.log("--- 1. PARTY TURNOVER RANKINGS ---");

  // A. Top Customers by Revenue (Sales Turnover)
  const topCust = await testApi("Top Customers: type=revenue", `${BASE_URL}/api/v1/erp/reports/analytics/party-rankings/${COMPANY_ID}`, {
    type: "revenue",
    fy: "2024-2025",
    limit: 5,
  });
  console.log(`   Total Sales Turnover: ₹${topCust?.summary?.totalTurnover?.toLocaleString("en-IN")}, Active Parties: ${topCust?.summary?.totalParties}`);
  if (topCust?.rankings?.length > 0) {
    const top = topCust.rankings[0];
    console.log(`   #1 Customer: ${top.partyName} -> Turnover: ₹${top.turnover?.toLocaleString("en-IN")} (${top.percentShare}% share, ${top.voucherCount} invoices)`);
  }

  // B. Top Vendors by Expense
  const topVend = await testApi("Top Vendors: type=expense", `${BASE_URL}/api/v1/erp/reports/analytics/party-rankings/${COMPANY_ID}`, {
    type: "expense",
    timeline: "all",
    limit: 3,
  });
  console.log(`   Total Vendor Turnover: ₹${topVend?.summary?.totalTurnover?.toLocaleString("en-IN")}`);

  // ─── 2. Stock Summary & Valuation ───────────────────────────────────────────
  console.log("\n--- 2. STOCK SUMMARY & INVENTORY VALUATION ---");

  const stockReport = await testApi("Stock Summary: All Items", `${BASE_URL}/api/v1/erp/reports/inventory/stock-summary/${COMPANY_ID}`, {
    limit: 5,
  });
  console.log(`   Total Items Tracked: ${stockReport?.summary?.totalItemsCount}`);
  console.log(`   Total Stock Valuation: ₹${stockReport?.summary?.totalStockValuation?.toLocaleString("en-IN")}`);
  if (stockReport?.stockItems?.length > 0) {
    const topItem = stockReport.stockItems[0];
    console.log(`   Sample Item: ${topItem.name} [${topItem.unit}] -> Closing Qty: ${topItem.closingQuantity}, Value: ₹${topItem.closingValue?.toLocaleString("en-IN")}`);
  }

  console.log("\n=================================================");
  console.log(`PRIORITY 3 TESTS: ${results.filter((r) => r.passed).length} / ${results.length} PASSED`);
  console.log("=================================================");
}

runPriority3Tests();
