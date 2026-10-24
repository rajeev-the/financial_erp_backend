export const toBool = (val) => {
  if (typeof val === "boolean") return val;
  if (!val) return false;
  const lower = String(val).trim().toLowerCase();
  return lower === "yes" || lower === "true" || lower === "1";
};

export const clean = (val) => {
  if (val === null || val === undefined) return null;
  const str = String(val)
    .replace(/&#\d+;/g, "")
    .trim();
  return str === "" ? null : str;
};

export const normalizeYesNo = (val) => {
  return toBool(val) ? "Yes" : "No";
};

export const normalizeNullable = (val) => {
  const cleaned = clean(val);
  return cleaned === null ? null : cleaned;
};

export const normalizeGstApplicable = (val) => {
  const cleaned = clean(val);
  if (!cleaned) return "Not Applicable";

  const lower = cleaned.toLowerCase();
  if (lower === "applicable" || lower === "yes" || lower === "true") {
    return "Applicable";
  }
  if (lower === "undefined") {
    return "Undefined";
  }
  return "Not Applicable";
};

export const cleanNumber = (val) => {
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  if (val === null || val === undefined || val === "") return 0;

  const str = String(val).trim().replace(/,/g, "");
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
};

export const toArray = (val) => {
  if (val === null || val === undefined || val === "") return [];
  if (Array.isArray(val)) return val;
  return [val];
};

export const classifyLedger = (
  isRevenue,
  isDeemedPositive,
  affectsGrossProfit,
) => {
  if (isRevenue) {
    if (isDeemedPositive) {
      return affectsGrossProfit ? "Direct Expense" : "Indirect Expense";
    } else {
      return affectsGrossProfit ? "Direct Income" : "Indirect Income";
    }
  } else {
    return isDeemedPositive ? "Asset" : "Liability";
  }
};

export const parseTallyDate = (dateStr) => {
  if (!dateStr) return null;
  if (dateStr instanceof Date) {
    return isNaN(dateStr.getTime()) ? null : dateStr;
  }
  const cleaned = String(dateStr).trim();
  if (!cleaned) return null;

  let date;
  // 1. YYYYMMDD (e.g. 20250928)
  if (/^\d{8}$/.test(cleaned)) {
    const year = parseInt(cleaned.substring(0, 4), 10);
    const month = parseInt(cleaned.substring(4, 6), 10) - 1;
    const day = parseInt(cleaned.substring(6, 8), 10);
    date = new Date(Date.UTC(year, month, day));
  }
  // 2. YYYY-MM-DD or YYYY/MM/DD
  else if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(cleaned)) {
    const parts = cleaned.split(/[-/]/);
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    date = new Date(Date.UTC(year, month, day));
  }
  // 3. DD-MM-YYYY or DD/MM/YYYY
  else if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(cleaned)) {
    const parts = cleaned.split(/[-/]/);
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    date = new Date(Date.UTC(year, month, day));
  }
  // 4. DD-MMM-YYYY or D-MMM-YYYY or DD-MMM-YY (e.g., 28-Sep-2025, 1-Apr-2025, 28-Sep-25)
  else if (/^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/.test(cleaned)) {
    const parts = cleaned.split("-");
    const day = parseInt(parts[0], 10);
    const monthStr = parts[1];
    let year = parseInt(parts[2], 10);
    if (year < 100) year += 2000;
    const months = [
      "jan", "feb", "mar", "apr", "may", "jun",
      "jul", "aug", "sep", "oct", "nov", "dec"
    ];
    const month = months.indexOf(monthStr.toLowerCase());
    if (month !== -1) {
      date = new Date(Date.UTC(year, month, day));
    }
  }

  // 5. Fallback: ISO or other standard date strings
  if (!date || isNaN(date.getTime())) {
    if (!cleaned.endsWith("Z") && !cleaned.includes("+") && !cleaned.includes("UTC")) {
      date = new Date(`${cleaned} UTC`);
    }
    if (!date || isNaN(date.getTime())) {
      date = new Date(cleaned);
    }
  }

  if (date && !isNaN(date.getTime())) {
    return date;
  }

  return null;
};

export const convertToIST = (date) => {
  if (!date) return null;
  if (date instanceof Date) {
    return isNaN(date.getTime()) ? null : date;
  }
  return parseTallyDate(date);
};
