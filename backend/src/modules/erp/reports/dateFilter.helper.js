/**
 * Normalizes any date value (Date object, ISO string, DD-MM-YYYY, DD/MM/YYYY, YYYY/MM/DD)
 * to a standard "YYYY-MM-DD" string.
 */
export function normalizeDateString(dateVal) {
  if (!dateVal) return null;
  if (dateVal instanceof Date) {
    if (isNaN(dateVal.getTime())) return null;
    return dateVal.toISOString().slice(0, 10);
  }
  const str = String(dateVal).trim();
  if (!str) return null;

  // Check DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, "0");
    const month = dmyMatch[2].padStart(2, "0");
    const year = dmyMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Check YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, "0");
    const day = ymdMatch[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // Fallback: try parsing with Date
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Resolves date filters (from_date, to_date, fy, targetYear, period, timeline, etc.)
 * into standard YYYY-MM-DD string bounds for querying vouchers and ledger_postings.
 */
export function resolveDateFilter(params = {}) {
  const {
    from_date,
    fromDate,
    startDate,
    start_date,
    from,
    to_date,
    toDate,
    endDate,
    end_date,
    to,
    fy,
    financial_year,
    financialYear,
    targetYear,
    year,
    period,
    timeline,
    from_year,
    from_month,
    to_year,
    to_month,
    quarter,
  } = params;

  let rawFrom = from_date || fromDate || startDate || start_date || from || null;
  let rawTo = to_date || toDate || endDate || end_date || to || null;

  // If explicit from/to dates are provided, normalize and return directly
  if (rawFrom || rawTo) {
    return {
      fromDate: normalizeDateString(rawFrom),
      toDate: normalizeDateString(rawTo),
    };
  }

  // 1. Check from_year / from_month / to_year / to_month range (e.g. from register-totals)
  if (from_year && from_month && to_year && to_month) {
    const fyNum = parseInt(from_year, 10);
    const fmNum = parseInt(from_month, 10);
    const tyNum = parseInt(to_year, 10);
    const tmNum = parseInt(to_month, 10);

    const start = new Date(fyNum, fmNum - 1, 1);
    const end = new Date(tyNum, tmNum, 0); // last day of to_month
    return {
      fromDate: start.toISOString().slice(0, 10),
      toDate: end.toISOString().slice(0, 10),
    };
  }

  // 2. Check period / timeline keyword
  const periodStr = (period || timeline || "").trim().toLowerCase();
  const now = new Date();
  const currentMonth = now.getMonth(); // 0 = Jan ... 11 = Dec
  const currentYear = now.getFullYear();
  const fyStartYear = currentMonth >= 3 ? currentYear : currentYear - 1;

  if (periodStr) {
    if (periodStr === "today") {
      const todayStr = now.toISOString().slice(0, 10);
      return { fromDate: todayStr, toDate: todayStr };
    }

    if (periodStr === "yesterday") {
      const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const yStr = y.toISOString().slice(0, 10);
      return { fromDate: yStr, toDate: yStr };
    }

    if (periodStr === "this_week" || periodStr === "week") {
      const day = now.getDay(); // 0 is Sun, 1 is Mon...
      const diffToMonday = (day === 0 ? -6 : 1) - day;
      const monday = new Date(now);
      monday.setDate(now.getDate() + diffToMonday);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return {
        fromDate: monday.toISOString().slice(0, 10),
        toDate: sunday.toISOString().slice(0, 10),
      };
    }

    if (periodStr === "last_week") {
      const day = now.getDay();
      const diffToMonday = (day === 0 ? -6 : 1) - day - 7;
      const monday = new Date(now);
      monday.setDate(now.getDate() + diffToMonday);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return {
        fromDate: monday.toISOString().slice(0, 10),
        toDate: sunday.toISOString().slice(0, 10),
      };
    }

    if (periodStr === "this_month" || periodStr === "month") {
      const start = new Date(currentYear, currentMonth, 1);
      const end = new Date(currentYear, currentMonth + 1, 0);
      return {
        fromDate: start.toISOString().slice(0, 10),
        toDate: end.toISOString().slice(0, 10),
      };
    }

    if (periodStr === "last_month") {
      const start = new Date(currentYear, currentMonth - 1, 1);
      const end = new Date(currentYear, currentMonth, 0);
      return {
        fromDate: start.toISOString().slice(0, 10),
        toDate: end.toISOString().slice(0, 10),
      };
    }

    // Indian Financial Quarters: Q1: Apr-Jun, Q2: Jul-Sep, Q3: Oct-Dec, Q4: Jan-Mar
    if (periodStr === "this_quarter" || periodStr === "quarter") {
      let qStartMonth = 3;
      let qEndMonth = 5;
      let qYear = fyStartYear;

      if (currentMonth >= 3 && currentMonth <= 5) {
        qStartMonth = 3; qEndMonth = 5; qYear = fyStartYear;
      } else if (currentMonth >= 6 && currentMonth <= 8) {
        qStartMonth = 6; qEndMonth = 8; qYear = fyStartYear;
      } else if (currentMonth >= 9 && currentMonth <= 11) {
        qStartMonth = 9; qEndMonth = 11; qYear = fyStartYear;
      } else {
        qStartMonth = 0; qEndMonth = 2; qYear = fyStartYear + 1;
      }

      const start = new Date(qYear, qStartMonth, 1);
      const end = new Date(qYear, qEndMonth + 1, 0);
      return {
        fromDate: start.toISOString().slice(0, 10),
        toDate: end.toISOString().slice(0, 10),
      };
    }

    if (periodStr === "last_quarter") {
      let qStartMonth = 0;
      let qEndMonth = 2;
      let qYear = fyStartYear;

      if (currentMonth >= 3 && currentMonth <= 5) {
        // Last quarter was Q4 of previous FY (Jan-Mar)
        qStartMonth = 0; qEndMonth = 2; qYear = fyStartYear;
      } else if (currentMonth >= 6 && currentMonth <= 8) {
        // Last quarter was Q1 (Apr-Jun)
        qStartMonth = 3; qEndMonth = 5; qYear = fyStartYear;
      } else if (currentMonth >= 9 && currentMonth <= 11) {
        // Last quarter was Q2 (Jul-Sep)
        qStartMonth = 6; qEndMonth = 8; qYear = fyStartYear;
      } else {
        // Last quarter was Q3 (Oct-Dec)
        qStartMonth = 9; qEndMonth = 11; qYear = fyStartYear;
      }

      const start = new Date(qYear, qStartMonth, 1);
      const end = new Date(qYear, qEndMonth + 1, 0);
      return {
        fromDate: start.toISOString().slice(0, 10),
        toDate: end.toISOString().slice(0, 10),
      };
    }

    if (periodStr === "this_year" || periodStr === "this_fy" || (periodStr === "year" && !year && !targetYear && !fy)) {
      return {
        fromDate: `${fyStartYear}-04-01`,
        toDate: `${fyStartYear + 1}-03-31`,
      };
    }

    if (periodStr === "last_year" || periodStr === "last_fy") {
      return {
        fromDate: `${fyStartYear - 1}-04-01`,
        toDate: `${fyStartYear}-03-31`,
      };
    }

    if (periodStr === "all" || periodStr === "all_years" || periodStr === "all_time") {
      return { fromDate: null, toDate: null };
    }
  }

  // 3. Check explicit Quarter filter (Q1, Q2, Q3, Q4)
  if (quarter) {
    const qStr = String(quarter).trim().toUpperCase();
    const qMatch = qStr.match(/Q?([1-4])/);
    if (qMatch) {
      const qNum = parseInt(qMatch[1], 10);
      const targetFY = parseInt(year || targetYear || fy || fyStartYear, 10);
      if (qNum === 1) return { fromDate: `${targetFY}-04-01`, toDate: `${targetFY}-06-30` };
      if (qNum === 2) return { fromDate: `${targetFY}-07-01`, toDate: `${targetFY}-09-30` };
      if (qNum === 3) return { fromDate: `${targetFY}-10-01`, toDate: `${targetFY}-12-31` };
      if (qNum === 4) return { fromDate: `${targetFY + 1}-01-01`, toDate: `${targetFY + 1}-03-31` };
    }
  }

  // 4. Check Financial Year filter (e.g. "2024-2025", "2024-25", "2024", "24-25")
  const rawFy = fy || financial_year || financialYear || targetYear || year;
  if (rawFy) {
    const fyStr = String(rawFy).trim().toLowerCase();
    if (fyStr === "all" || fyStr === "all years" || fyStr === "all_years") {
      return { fromDate: null, toDate: null };
    }

    // Try finding 4-digit year (e.g. "2024", "2024-2025", "2024-25")
    const fourDigitMatch = fyStr.match(/\b(20\d\d)\b/);
    if (fourDigitMatch) {
      const startYear = parseInt(fourDigitMatch[1], 10);
      return {
        fromDate: `${startYear}-04-01`,
        toDate: `${startYear + 1}-03-31`,
      };
    }

    // Try finding 2-digit FY notation (e.g. "24-25")
    const twoDigitMatch = fyStr.match(/\b(\d{2})[-/](\d{2})\b/);
    if (twoDigitMatch) {
      const startYear = 2000 + parseInt(twoDigitMatch[1], 10);
      return {
        fromDate: `${startYear}-04-01`,
        toDate: `${startYear + 1}-03-31`,
      };
    }
  }

  return { fromDate: null, toDate: null };
}

/**
 * Builds date match query for Mongoose find/aggregate.
 * Uses string comparison on the indexed 'date' field (YYYY-MM-DD).
 */
export function buildDateMatch(fromDate, toDate, dateField = "date") {
  const match = {};
  if (fromDate && toDate) {
    match[dateField] = { $gte: fromDate, $lte: toDate };
  } else if (fromDate) {
    match[dateField] = { $gte: fromDate };
  } else if (toDate) {
    match[dateField] = { $lte: toDate };
  }
  return match;
}
