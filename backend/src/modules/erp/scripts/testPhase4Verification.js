const BASE_URL = "http://127.0.0.1:3000";
const COMPANY_ID = "6aa0ebf73a3260ebc741698b";

async function testEndpoints() {
  console.log("=========================================================================");
  console.log("            PHASE 4 POST-MIGRATION ENDPOINT VERIFICATION SUITE           ");
  console.log("=========================================================================\n");

  const endpoints = [
    { name: "Dashboard Home (All Time)", url: `${BASE_URL}/api/v1/erp/reports/dashboard/home/${COMPANY_ID}?company_id=${COMPANY_ID}` },
    { name: "Dashboard Home (FY 2024-25)", url: `${BASE_URL}/api/v1/erp/reports/dashboard/home/${COMPANY_ID}?company_id=${COMPANY_ID}&from_date=2024-04-01&to_date=2025-03-31` },
    { name: "Receivables Summary", url: `${BASE_URL}/api/v1/erp/reports/receivables/summary/${COMPANY_ID}?company_id=${COMPANY_ID}` },
    { name: "Receivables Debtors List", url: `${BASE_URL}/api/v1/erp/reports/receivables/parties/${COMPANY_ID}?company_id=${COMPANY_ID}&limit=5` },
    { name: "Payables Summary", url: `${BASE_URL}/api/v1/erp/reports/payables/summary/${COMPANY_ID}?company_id=${COMPANY_ID}` },
    { name: "Payables Creditors List", url: `${BASE_URL}/api/v1/erp/reports/payables/parties/${COMPANY_ID}?company_id=${COMPANY_ID}&limit=5` },
    { name: "Day Book (Recent Vouchers)", url: `${BASE_URL}/api/v1/erp/reports/daybook/${COMPANY_ID}?company_id=${COMPANY_ID}&limit=5` },
    { name: "Sales Monthly Register", url: `${BASE_URL}/api/v1/erp/reports/sales/register/monthly/${COMPANY_ID}?company_id=${COMPANY_ID}&voucherType=SALES` },
  ];

  for (const ep of endpoints) {
    const t0 = performance.now();
    try {
      const res = await fetch(ep.url);
      const timeMs = Math.round(performance.now() - t0);
      const json = await res.json();
      if (res.ok) {
        console.log(`✅ [${res.status}] ${ep.name.padEnd(32)} -> Response in ${timeMs}ms`);
      } else {
        console.error(`❌ [${res.status}] ${ep.name.padEnd(32)} -> Error: ${json.message || "Failed"}`);
      }
    } catch (err) {
      console.error(`❌ [ERR] ${ep.name.padEnd(32)} -> Fetch failed: ${err.message}`);
    }
  }

  console.log("\n=========================================================================");
  console.log("                   ALL VERIFICATION CHECKS COMPLETED                     ");
  console.log("=========================================================================");
}

testEndpoints();
