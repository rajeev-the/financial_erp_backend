const BASE_URL = "http://localhost:3000";
const COMPANY_ID = "6aa0ebf73a3260ebc741698b";

async function testAll() {
  // 1. Accounting Sales
  const sRes = await fetch(`${BASE_URL}/api/v1/tally/accounting/${COMPANY_ID}?requirement=sales&from_date=2024-04-01&to_date=2025-03-31`);
  const sJson = await sRes.json();
  console.log("1. Accounting Sales:", sJson.data?.amount ?? sJson.data?.total_amount);

  // 2. Receivables Calculation
  const rRes = await fetch(`${BASE_URL}/api/v1/tally/receivable/cal/${COMPANY_ID}`);
  const rJson = await rRes.json();
  console.log("2. Receivables Calculation:", rJson.data?.amount ?? rJson.data?.total_receivable ?? rJson.data?.closing_balance);

  // 3. Payables Calculation
  const pRes = await fetch(`${BASE_URL}/api/v1/tally/payable/cal/${COMPANY_ID}`);
  const pJson = await pRes.json();
  console.log("3. Payables Calculation:", pJson.data?.amount ?? pJson.data?.total_payable ?? pJson.data?.closing_balance);

  // 4. Vouchers list
  const vRes = await fetch(`${BASE_URL}/api/v1/tally/voucher/getvoucher?company_id=${COMPANY_ID}&from_date=2026-08-01&to_date=2026-08-31`);
  const vJson = await vRes.json();
  console.log("4. Vouchers list count:", vJson.count ?? vJson.data?.length);

  // 5. Ledger Statement
  const lRes = await fetch(`${BASE_URL}/api/v1/tally/voucher/ledger/${encodeURIComponent("META HR JOBWORKS PVT. LTD.")}?company_id=${COMPANY_ID}`);
  const lJson = await lRes.json();
  console.log("5. Ledger Statement count:", lJson.data?.total_count ?? lJson.data?.vouchers?.length);

  // 6. Profit and Loss
  const plRes = await fetch(`${BASE_URL}/api/v1/tally/reports/profit-loss/${COMPANY_ID}?from_date=2024-04-01&to_date=2025-03-31`);
  const plJson = await plRes.json();
  console.log("6. P&L Net Profit:", plJson.data?.summary?.netProfit ?? plJson.data?.netProfit);

  // 7. Balance Sheet
  const bsRes = await fetch(`${BASE_URL}/api/v1/tally/reports/balance-sheet/${COMPANY_ID}?from_date=2024-04-01&to_date=2025-03-31`);
  const bsJson = await bsRes.json();
  console.log("7. Balance Sheet Total Assets:", bsJson.data?.assets?.totalAssets);
}

testAll().catch(console.error);
