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
  console.log("=========================================================================================");
  console.log("          VERIFICATION OF PAYABLES: LEGACY CALCULATED API vs UNIFIED ERP API             ");
  console.log("=========================================================================================\n");

  // 1. ALL TIME (Mobile Default: timeline=all)
  console.log("--- TEST 1: ALL TIME (timeline=all / no date filter) ---");
  const legAll = await fetchJson(`/api/v1/tally/payable/cal/${COMPANY_ID}`);
  const erpSummaryAll = await fetchJson(`/api/v1/erp/reports/payables/summary/${COMPANY_ID}`, { timeline: "all" });
  const erpPartiesAll = await fetchJson(`/api/v1/erp/reports/payables/parties/${COMPANY_ID}`, { timeline: "all", limit: 5000 });
  const erpDashAll = await fetchJson(`/api/v1/erp/reports/dashboard/home/${COMPANY_ID}`, { timeline: "all" });

  console.log(`Legacy Calculated API Total Payable:  ₹${legAll.total_payable.toLocaleString()} (${legAll.creditors_count} pending vendors)`);
  console.log(`ERP Payables Summary Total Payable:    ₹${erpSummaryAll.totalPayable.toLocaleString()}`);
  console.log(`ERP Payables Parties Total Payable:    ₹${erpPartiesAll.totalPayable.toLocaleString()} (${erpPartiesAll.parties.filter(p => p.status === 'pending' || p.currentBalance > 0).length} pending vendors)`);
  console.log(`ERP Dashboard Home Payables:           ₹${erpDashAll.payables.toLocaleString()}`);

  console.log("\nPending Vendors in Legacy vs ERP (All Time):");
  const legPendingAll = legAll.vendors.filter(v => v.closing_balance > 0);
  const erpPendingAll = erpPartiesAll.parties.filter(p => p.currentBalance > 0);

  console.log("Legacy Pending Vendors:", legPendingAll.map(v => ({ name: v.party_name, amt: v.closing_balance })));
  console.log("ERP Pending Vendors:   ", erpPendingAll.map(p => ({ name: p.name, amt: p.currentBalance })));

  const diffAll = Math.abs(legAll.total_payable - erpSummaryAll.totalPayable);
  console.log(`\nALL TIME VARIANCE: ₹${diffAll.toFixed(2)} ${diffAll === 0 ? "--> EXACT 0.00 MATCH!" : "--> MISMATCH"}`);

  // 2. FINANCIAL YEAR 2024-2025
  console.log("\n-----------------------------------------------------------------------------------------");
  console.log("--- TEST 2: FINANCIAL YEAR 2024-2025 (fy=2024-2025) ---");
  const legFY = await fetchJson(`/api/v1/tally/payable/cal/${COMPANY_ID}`, { from_date: "2024-04-01", to_date: "2025-03-31" });
  const erpSummaryFY = await fetchJson(`/api/v1/erp/reports/payables/summary/${COMPANY_ID}`, { fy: "2024-2025" });
  const erpPartiesFY = await fetchJson(`/api/v1/erp/reports/payables/parties/${COMPANY_ID}`, { fy: "2024-2025", limit: 5000 });
  const erpDashFY = await fetchJson(`/api/v1/erp/reports/dashboard/home/${COMPANY_ID}`, { fy: "2024-2025" });

  console.log(`Legacy Calculated API Total Payable:  ₹${legFY.total_payable.toLocaleString()} (${legFY.creditors_count} pending vendors)`);
  console.log(`ERP Payables Summary Total Payable:    ₹${erpSummaryFY.totalPayable.toLocaleString()}`);
  console.log(`ERP Payables Parties Total Payable:    ₹${erpPartiesFY.totalPayable.toLocaleString()} (${erpPartiesFY.parties.filter(p => p.status === 'pending' || p.currentBalance > 0).length} pending vendors)`);
  console.log(`ERP Dashboard Home Payables:           ₹${erpDashFY.payables.toLocaleString()}`);

  console.log("\nPending Vendors in Legacy vs ERP (FY 2024-2025):");
  const legPendingFY = legFY.vendors.filter(v => v.closing_balance > 0);
  const erpPendingFY = erpPartiesFY.parties.filter(p => p.currentBalance > 0);

  console.log("Legacy Pending Vendors:", legPendingFY.map(v => ({ name: v.party_name, amt: v.closing_balance })));
  console.log("ERP Pending Vendors:   ", erpPendingFY.map(p => ({ name: p.name, amt: p.currentBalance })));

  const diffFY = Math.abs(legFY.total_payable - erpSummaryFY.totalPayable);
  console.log(`\nFY 2024-2025 VARIANCE: ₹${diffFY.toFixed(2)} ${diffFY === 0 ? "--> EXACT 0.00 MATCH!" : "--> MISMATCH"}`);
  console.log("=========================================================================================\n");
}

main().catch(console.error);
