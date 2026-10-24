const MONTH_NAMES = [
  "",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Indian Financial Year month order: April (4) to March (3)
const FY_MONTH_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];

function parseSafeDate(dateVal) {
  if (!dateVal) return null;
  if (dateVal instanceof Date && !isNaN(dateVal.getTime())) return dateVal;
  const parsed = new Date(dateVal);
  if (!isNaN(parsed.getTime())) return parsed;
  const str = String(dateVal).trim();
  if (/^\d{8}$/.test(str)) {
    const y = parseInt(str.substring(0, 4), 10);
    const m = parseInt(str.substring(4, 6), 10) - 1;
    const d = parseInt(str.substring(6, 8), 10);
    const dt = new Date(y, m, d);
    if (!isNaN(dt.getTime())) return dt;
  }
  return null;
}
function getFinancialYearFromDate(date) {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed: 0 = Jan, 3 = Apr, 11 = Dec

  const startYear = month >= 3 ? year : year - 1;
  const endYear = startYear + 1;

  const shortEndYear = String(endYear).slice(-2);
  const label = `FY ${startYear}-${shortEndYear}`;
  const financialYear = `${startYear}-${endYear}`;
  const startDate = `${startYear}-04-01`;
  const endDate = `${endYear}-03-31`;

  return {
    label,
    financial_year: financialYear,
    start_year: startYear,
    end_year: endYear,
    start_date: startDate,
    end_date: endDate,
  };
}
export {MONTH_NAMES,FY_MONTH_ORDER,parseSafeDate,getFinancialYearFromDate}