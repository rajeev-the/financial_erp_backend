import mongoose from "mongoose";
import Voucher from "../voucher/voucher.schema.js";
import Ledger from "../ledger/ledger.schema.js";
import LedgerEntry from "../voucher/ledgerentry.schema.js";
import Company from "../../companies/company.schema.js";

// Canonical Indian States and Union Territories
const CANONICAL_INDIAN_STATES = new Map([
  ["andhra pradesh", "Andhra Pradesh"],
  ["arunachal pradesh", "Arunachal Pradesh"],
  ["assam", "Assam"],
  ["bihar", "Bihar"],
  ["chhattisgarh", "Chhattisgarh"],
  ["goa", "Goa"],
  ["gujarat", "Gujarat"],
  ["haryana", "Haryana"],
  ["himachal pradesh", "Himachal Pradesh"],
  ["jharkhand", "Jharkhand"],
  ["karnataka", "Karnataka"],
  ["kerala", "Kerala"],
  ["madhya pradesh", "Madhya Pradesh"],
  ["maharashtra", "Maharashtra"],
  ["manipur", "Manipur"],
  ["meghalaya", "Meghalaya"],
  ["mizoram", "Mizoram"],
  ["nagaland", "Nagaland"],
  ["odisha", "Odisha"],
  ["punjab", "Punjab"],
  ["rajasthan", "Rajasthan"],
  ["sikkim", "Sikkim"],
  ["tamil nadu", "Tamil Nadu"],
  ["telangana", "Telangana"],
  ["tripura", "Tripura"],
  ["uttar pradesh", "Uttar Pradesh"],
  ["uttarakhand", "Uttarakhand"],
  ["west bengal", "West Bengal"],
  ["andaman and nicobar islands", "Andaman and Nicobar Islands"],
  ["chandigarh", "Chandigarh"],
  ["dadra and nagar haveli and daman and diu", "Dadra and Nagar Haveli and Daman and Diu"],
  ["delhi", "Delhi"],
  ["jammu and kashmir", "Jammu and Kashmir"],
  ["ladakh", "Ladakh"],
  ["lakshadweep", "Lakshadweep"],
  ["puducherry", "Puducherry"],
  ["other territory", "Other Territory"],
]);

const GST_STATE_CODES = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

const STATE_ALIASES = {
  "new delhi": "delhi",
  "nct of delhi": "delhi",
  "national capital territory of delhi": "delhi",
  "orissa": "odisha",
  "pondicherry": "puducherry",
  "uttaranchal": "uttarakhand",
  "andaman and nicobar": "andaman and nicobar islands",
  "andaman & nicobar": "andaman and nicobar islands",
  "andaman & nicobar islands": "andaman and nicobar islands",
  "dadra and nagar haveli": "dadra and nagar haveli and daman and diu",
  "daman and diu": "dadra and nagar haveli and daman and diu",
};

const COUNTRY_ALIASES = {
  usa: { country: "United States of America", slug: "usa" },
  "united states": { country: "United States of America", slug: "usa" },
  "united states of america": { country: "United States of America", slug: "usa" },
  uae: { country: "United Arab Emirates", slug: "united_arab_emirates" },
  "united arab emirates": { country: "United Arab Emirates", slug: "united_arab_emirates" },
  uk: { country: "United Kingdom", slug: "united_kingdom" },
  "united kingdom": { country: "United Kingdom", slug: "united_kingdom" },
  germany: { country: "Germany", slug: "germany" },
  ireland: { country: "Ireland", slug: "ireland" },
  "hong kong": { country: "Hong Kong", slug: "hong_kong" },
  india: { country: "India", slug: "india" },
  bharat: { country: "India", slug: "india" },
  singapore: { country: "Singapore", slug: "singapore" },
  canada: { country: "Canada", slug: "canada" },
  australia: { country: "Australia", slug: "australia" },
  france: { country: "France", slug: "france" },
  japan: { country: "Japan", slug: "japan" },
  china: { country: "China", slug: "china" },
  netherlands: { country: "Netherlands", slug: "netherlands" },
  switzerland: { country: "Switzerland", slug: "switzerland" },
};

function normalizeStateName(raw) {
  if (!raw) return null;
  let str = String(raw).trim().toLowerCase();
  // Strip numeric GST prefix if present e.g. "07-delhi" -> "delhi"
  str = str.replace(/^\d{2}\s*[-–]\s*/, "").trim();
  str = str.replace(/[().,']/g, "").replace(/\s+/g, " ").trim();

  if (STATE_ALIASES[str]) {
    str = STATE_ALIASES[str];
  }

  if (CANONICAL_INDIAN_STATES.has(str)) {
    return CANONICAL_INDIAN_STATES.get(str);
  }

  // Substring match
  for (const [key, displayName] of CANONICAL_INDIAN_STATES.entries()) {
    if (str.includes(key) || key.includes(str)) {
      return displayName;
    }
  }

  return null;
}

function normalizeCountryInfo(raw) {
  if (!raw) return null;
  const str = String(raw).trim().toLowerCase().replace(/[().,']/g, "").replace(/\s+/g, " ");
  if (COUNTRY_ALIASES[str]) {
    return COUNTRY_ALIASES[str];
  }

  // Format as title case & slug
  const title = str
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const slug = str.replace(/\s+/g, "_");

  return { country: title, slug };
}

/**
 * Service to aggregate Geographical Revenue (India States & World Countries)
 */
export async function getGeographicalRevenueService({
  companyId,
  targetYear,
  fy,
  mode = "sales",
  from_date,
  to_date,
  tenant_id,
}) {
  const selectedMode = String(mode || "sales").trim().toLowerCase() === "purchase" ? "purchase" : "sales";
  const isPurchase = selectedMode === "purchase";

  // 1. Resolve target companies
  let companyIds = [];
  const isAll = !companyId || companyId === "all" || companyId === "consolidated";

  if (isAll) {
    const compFilter = { is_deleted: { $ne: true } };
    if (tenant_id && mongoose.Types.ObjectId.isValid(tenant_id)) {
      compFilter.tenant_id = new mongoose.Types.ObjectId(tenant_id);
    }
    const comps = await Company.find(compFilter).select("_id").lean();
    companyIds = comps.map((c) => c._id);
  } else if (mongoose.Types.ObjectId.isValid(companyId)) {
    companyIds = [new mongoose.Types.ObjectId(companyId)];
  } else {
    const compDoc = await Company.findOne({
      $or: [{ tally_company_guid: companyId }, { name: companyId }],
      is_deleted: { $ne: true },
    }).select("_id").lean();
    if (compDoc) {
      companyIds = [compDoc._id];
    }
  }

  if (companyIds.length === 0) {
    return {
      mode: selectedMode,
      totalAmount: 0,
      india: { totalAmount: 0, states: [] },
      world: { totalAmount: 0, countries: [] },
      unallocated: { totalAmount: 0, rows: [] },
    };
  }

  // 2. Build date filters
  const dateFilter = {};
  const activeFy = targetYear || fy;

  if (from_date || to_date) {
    if (from_date) dateFilter.$gte = new Date(from_date);
    if (to_date) {
      const end = new Date(to_date);
      end.setHours(23, 59, 59, 999);
      dateFilter.$lte = end;
    }
  } else if (activeFy && activeFy !== "all") {
    // Parse FY string like "2024-2025" or "2024-25" or match first 4-digit year
    const match = String(activeFy).match(/\b(20\d\d)\b/);
    if (match) {
      const startYr = parseInt(match[1], 10);
      const endYr = startYr + 1;
      dateFilter.$gte = new Date(`${startYr}-04-01T00:00:00.000Z`);
      dateFilter.$lte = new Date(`${endYr}-03-31T23:59:59.999Z`);
    }
  }

  // 3. Query vouchers for the selected mode
  const voucherFilter = {
    company_id: { $in: companyIds },
    vchtype: isPurchase ? { $regex: /purchase|debit note/i } : { $regex: /sales|credit note/i },
    is_deleted: { $ne: true },
    is_cancelled: { $ne: true },
  };

  if (Object.keys(dateFilter).length > 0) {
    voucherFilter.date = dateFilter;
  }

  const vouchers = await Voucher.find(voucherFilter)
    .select("_id amount party_ledger_id place_of_supply party_gstin date vchtype voucher_number company_id")
    .lean();

  if (!vouchers || vouchers.length === 0) {
    return {
      mode: selectedMode,
      totalAmount: 0,
      india: { totalAmount: 0, states: [] },
      world: { totalAmount: 0, countries: [] },
      unallocated: { totalAmount: 0, rows: [] },
    };
  }

  const vIds = vouchers.map((v) => v._id);
  const partyLedgerIds = [...new Set(vouchers.map((v) => v.party_ledger_id).filter(Boolean))];

  // 4. Fetch associated party ledgers and entries in parallel
  const [ledgers, entries] = await Promise.all([
    Ledger.find({ _id: { $in: partyLedgerIds } })
      .select("_id name state state_name country country_name country_of_residence gstin mailing_details")
      .lean(),
    LedgerEntry.find({
      voucher_id: { $in: vIds },
      ledger_id: { $in: partyLedgerIds },
      is_deleted: { $ne: true },
    })
      .select("voucher_id ledger_id amount")
      .lean(),
  ]);

  const ledgerMap = new Map(ledgers.map((l) => [String(l._id), l]));

  // Map entry amount totals per voucher
  const voucherEntryAmtMap = new Map();
  for (const e of entries) {
    const vId = String(e.voucher_id);
    const amt = Math.abs(Number(e.amount) || 0);
    voucherEntryAmtMap.set(vId, (voucherEntryAmtMap.get(vId) || 0) + amt);
  }

  // 5. Bucketing into India states and World countries
  const indiaMap = new Map(); // stateName -> { state, normalizedState, amount, partyCount, parties: Set, vouchers: number }
  const worldMap = new Map(); // countrySlug -> { country, normalizedCountry, slug, amount, partyCount, parties: Set, vouchers: number }
  const unallocatedMap = new Map(); // partyName -> { party, amount, count }

  let grandTotal = 0;

  for (const v of vouchers) {
    const vId = String(v._id);
    const entryAmt = voucherEntryAmtMap.get(vId);
    const amt = entryAmt && entryAmt > 0 ? entryAmt : Math.abs(Number(v.amount) || 0);
    if (amt <= 0) continue;

    grandTotal += amt;

    const l = v.party_ledger_id ? ledgerMap.get(String(v.party_ledger_id)) : null;
    const partyName = l?.name || v.party_name || "Unknown Party";

    // Detect state from multiple sources:
    // 1. place_of_supply
    // 2. GSTIN first 2 digits
    // 3. ledger state / state_name / mailing_details
    let rawState = v.place_of_supply || l?.state || l?.state_name || l?.mailing_details?.[0]?.state;
    const gstin = v.party_gstin || l?.gstin;
    if (!rawState && gstin && String(gstin).trim().length >= 2) {
      const code = String(gstin).trim().slice(0, 2);
      if (GST_STATE_CODES[code]) {
        rawState = GST_STATE_CODES[code];
      }
    }
    const normalizedState = normalizeStateName(rawState);

    // Detect country from:
    // 1. ledger country_of_residence / country / country_name
    // 2. if normalizedState is recognized, country is India
    const rawCountry = l?.country_of_residence || l?.country || l?.country_name;
    let countryInfo = normalizeCountryInfo(rawCountry);

    // If country is not explicitly specified, but state is an Indian state or POS is in India, default to India
    if (!countryInfo) {
      if (normalizedState || !rawCountry) {
        countryInfo = { country: "India", slug: "india" };
      }
    }

    // World aggregation (EVERY voucher with a resolved country belongs to the World view!)
    if (countryInfo) {
      const cSlug = countryInfo.slug;
      if (!worldMap.has(cSlug)) {
        worldMap.set(cSlug, {
          country: countryInfo.country,
          normalizedCountry: countryInfo.country,
          slug: countryInfo.slug,
          amount: 0,
          parties: new Set(),
          vouchers: 0,
        });
      }
      const cItem = worldMap.get(cSlug);
      cItem.amount += amt;
      cItem.parties.add(partyName);
      cItem.vouchers += 1;
    }

    // India state aggregation (if country is India and state is recognized)
    if (countryInfo?.slug === "india" && normalizedState) {
      const sKey = normalizedState;
      if (!indiaMap.has(sKey)) {
        indiaMap.set(sKey, {
          state: normalizedState,
          normalizedState: sKey,
          amount: 0,
          parties: new Set(),
          vouchers: 0,
        });
      }
      const sItem = indiaMap.get(sKey);
      sItem.amount += amt;
      sItem.parties.add(partyName);
      sItem.vouchers += 1;
    } else if (!countryInfo && !normalizedState) {
      if (!unallocatedMap.has(partyName)) {
        unallocatedMap.set(partyName, { party: partyName, amount: 0, count: 0 });
      }
      const uItem = unallocatedMap.get(partyName);
      uItem.amount += amt;
      uItem.count += 1;
    }
  }

  // 6. Finalize arrays & calculate shares
  const indiaStates = Array.from(indiaMap.values())
    .map((s) => ({
      state: s.state,
      normalizedState: s.normalizedState,
      amount: Math.round(s.amount * 100) / 100,
      share: grandTotal > 0 ? Math.round((s.amount / grandTotal) * 10000) / 100 : 0,
      partyCount: s.parties.size,
      voucherCount: s.vouchers,
    }))
    .sort((a, b) => b.amount - a.amount);

  const indiaTotalAmount = Math.round(
    indiaStates.reduce((sum, s) => sum + s.amount, 0) * 100
  ) / 100;

  const worldCountries = Array.from(worldMap.values())
    .map((c) => ({
      country: c.country,
      normalizedCountry: c.normalizedCountry,
      slug: c.slug,
      amount: Math.round(c.amount * 100) / 100,
      share: grandTotal > 0 ? Math.round((c.amount / grandTotal) * 10000) / 100 : 0,
      partyCount: c.parties.size,
      voucherCount: c.vouchers,
    }))
    .sort((a, b) => b.amount - a.amount);

  const worldTotalAmount = Math.round(
    worldCountries.reduce((sum, c) => sum + c.amount, 0) * 100
  ) / 100;

  const unallocatedRows = Array.from(unallocatedMap.values())
    .map((u) => ({
      party: u.party,
      amount: Math.round(u.amount * 100) / 100,
      count: u.count,
    }))
    .sort((a, b) => b.amount - a.amount);

  const unallocatedTotalAmount = Math.round(
    unallocatedRows.reduce((sum, r) => sum + r.amount, 0) * 100
  ) / 100;

  return {
    mode: selectedMode,
    totalAmount: Math.round(grandTotal * 100) / 100,
    india: {
      totalAmount: indiaTotalAmount,
      states: indiaStates,
    },
    world: {
      totalAmount: worldTotalAmount,
      countries: worldCountries,
    },
    unallocated: {
      totalAmount: unallocatedTotalAmount,
      rows: unallocatedRows,
    },
  };
}

export default {
  getGeographicalRevenueService,
};
