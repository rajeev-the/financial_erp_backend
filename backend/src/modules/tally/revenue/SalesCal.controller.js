import { calculateAccountingService } from "../accounting/accounting.controller.js";
import { ok } from "../../../utils/response.js";
import mongoose from "mongoose";
import Ledger from "../ledger/ledger.schema.js";
import { ApiError } from "../../../utils/api-error.js";

const resolveDates = (from_date, to_date, fy, targetYear) => {
  let fromDate = from_date || null;
  let toDate = to_date || null;
  const rawFy = fy || targetYear;
  if ((!fromDate || !toDate) && rawFy) {
    const fyStr = String(rawFy).trim().toLowerCase();
    if (fyStr !== "all" && fyStr !== "all years") {
      const match = fyStr.match(/\b(20\d\d)\b/);
      if (match) {
        const y = parseInt(match[1], 10);
        fromDate = fromDate || `${y}-04-01`;
        toDate = toDate || `${y + 1}-03-31`;
      }
    }
  }
  return { fromDate, toDate };
};

const getsales = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { from_date, to_date, fy, targetYear } = req.query;

    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      throw ApiError.badRequest("A valid company ID is required");
    }

    const { fromDate, toDate } = resolveDates(from_date, to_date, fy, targetYear);

    const data = await calculateAccountingService({
      companyId,
      requirement: "sales",
      from_date: fromDate,
      to_date: toDate,
    });

    return ok(
      res,
      {
        amount: data?.amount ?? 0,
      },
      "Revenue data retrieved successfully"
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Controller to fetch sales revenue grouped customer/party-wise.
 * Matches Trial Balance Sales Accounts net calculation (Credits - Debits).
 */
export const getrevenue_partywise = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { from_date, to_date, fy, targetYear } = req.query;
    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      throw ApiError.badRequest("A valid company ID is required");
    }
    const { fromDate, toDate } = resolveDates(
      from_date ?? req.body?.from_date,
      to_date ?? req.body?.to_date,
      fy ?? req.body?.fy,
      targetYear ?? req.body?.targetYear
    );
    // 1. Fetch sales accounting data and bank/cash ledgers in parallel
    const [salesData, bankCashLedgers] = await Promise.all([
      calculateAccountingService({
        companyId,
        requirement: "sales",
        from_date: fromDate,
        to_date: toDate,
      }),
      Ledger.find(
        {
          company_id: companyId,
          is_deleted: { $ne: true },
          $or: [
            { parent: { $in: ["Bank Accounts", "Bank OD A/c", "Bank OCC A/c", "Cash-in-Hand"] } },
            { name: { $regex: /^(cash|bank\b)/i } },
          ],
        },
        { _id: 1, name: 1 }
      ).lean(),
    ]);
    const bankCashIdSet = new Set(bankCashLedgers.map((l) => String(l._id)));
    const bankCashNameSet = new Set(
      bankCashLedgers.map((l) => l.name?.trim().toLowerCase()).filter(Boolean)
    );
    // 2. Map voucher ID -> Customer party name (excluding Bank & Cash)
    const voucherPartyMap = new Map();
    const partyNameToIdMap = new Map();
    for (const v of salesData?.vouchers || []) {
      if (v?._id) {
        const vId = String(v._id);
        const partyIdStr = v.party_ledger_id
          ? String(typeof v.party_ledger_id === "object" ? v.party_ledger_id._id || v.party_ledger_id : v.party_ledger_id)
          : null;
        const rawPartyName =
          (typeof v.party_ledger_id === "object" ? v.party_ledger_id?.name : null) ||
          (typeof v.party_ledger_name === "string" ? v.party_ledger_name.trim() : null);
        const isBankOrCash =
          (partyIdStr && bankCashIdSet.has(partyIdStr)) ||
          (rawPartyName && bankCashNameSet.has(rawPartyName.toLowerCase()));
        if (rawPartyName && !isBankOrCash) {
          voucherPartyMap.set(vId, rawPartyName);
          if (partyIdStr && !partyNameToIdMap.has(rawPartyName)) {
            partyNameToIdMap.set(rawPartyName, partyIdStr);
          }
        }
      }
    }
    // 3. Deduplicate sales entries
    const entryMap = new Map();
    for (const entry of salesData?.ledger_entries || []) {
      if (entry?._id) entryMap.set(String(entry._id), entry);
    }
    // 4. Sum entry amounts per party as Net Revenue (Credits - Debits)
    const partyNetRevenueMap = new Map();
    const partyVouchersSet = new Map();
    const partyLedgersSet = new Map();
    const nonPartyNetRevenueMap = new Map();
    const nonPartyVouchersSet = new Map();
    for (const entry of entryMap.values()) {
      const vId = String(entry.voucher_id);
      const salesLedgerName = entry.ledger_name?.trim() || null;
      const partyName = voucherPartyMap.get(vId);
      const rawAmount = Number(entry.amount) || 0;
      // In Tally Sales Accounts:
      // - Credit (Sales): rawAmount > 0
      // - Debit (Credit Notes / Sales Return): rawAmount < 0
      // Net revenue = currentRevenue + rawAmount
      if (partyName) {
        // --- Customer / Debtor Party ---
        const currentRevenue = partyNetRevenueMap.get(partyName) || 0;
        partyNetRevenueMap.set(partyName, currentRevenue + rawAmount);
        if (!partyVouchersSet.has(partyName)) {
          partyVouchersSet.set(partyName, new Set());
        }
        if (entry.voucher_id) {
          partyVouchersSet.get(partyName).add(vId);
        }
        if (!partyLedgersSet.has(partyName)) {
          partyLedgersSet.set(partyName, new Set());
        }
        if (salesLedgerName) {
          partyLedgersSet.get(partyName).add(salesLedgerName);
        }
      } else {
        // --- Direct / Cash Sales (Without a dedicated Debtor ledger) ---
        const ledgerKey = salesLedgerName || "Direct Sales";
        const currentRevenue = nonPartyNetRevenueMap.get(ledgerKey) || 0;
        nonPartyNetRevenueMap.set(ledgerKey, currentRevenue + rawAmount);
        if (!nonPartyVouchersSet.has(ledgerKey)) {
          nonPartyVouchersSet.set(ledgerKey, new Set());
        }
        if (entry.voucher_id) {
          nonPartyVouchersSet.get(ledgerKey).add(vId);
        }
      }
    }

    // Fetch party ledger details to resolve country and state
    const partyNames = Array.from(partyNetRevenueMap.keys());
    const partyLedgerIds = Array.from(partyNameToIdMap.values())
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    const partyLedgers = await Ledger.find({
      company_id: companyId,
      is_deleted: { $ne: true },
      $or: [
        { _id: { $in: partyLedgerIds } },
        { name: { $in: partyNames } },
      ],
    })
      .select("_id name country_of_residence country country_name state state_name mailing_details")
      .lean();

    const ledgerByName = new Map();
    const ledgerById = new Map();
    for (const l of partyLedgers) {
      if (l.name) ledgerByName.set(l.name.trim().toLowerCase(), l);
      ledgerById.set(String(l._id), l);
    }

    const normalizeCountry = (raw) => {
      if (!raw) return "India";
      const s = String(raw).trim();
      const lower = s.toLowerCase();
      if (lower === "usa" || lower.includes("united states")) return "United States of America";
      if (lower === "uae" || lower.includes("united arab")) return "United Arab Emirates";
      if (lower === "uk" || lower.includes("united kingdom")) return "United Kingdom";
      if (lower === "germany") return "Germany";
      if (lower === "india" || lower === "bharat") return "India";
      return s
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
    };

    // 5. Build customer parties list (sorted descending by revenue)
    const parties = Array.from(partyNetRevenueMap.entries())
      .map(([party_name, netRevenue]) => {
        const netAmount = Math.round(netRevenue * 100) / 100;
        const voucherIds = Array.from(partyVouchersSet.get(party_name) || []);
        const ledgerNames = Array.from(partyLedgersSet.get(party_name) || []);
        const partyId = partyNameToIdMap.get(party_name);
        const lDoc = (partyId ? ledgerById.get(partyId) : null) || ledgerByName.get(party_name.trim().toLowerCase());
        const rawCountry = lDoc?.country_of_residence || lDoc?.country || lDoc?.country_name;
        const rawState = lDoc?.state || lDoc?.state_name || lDoc?.mailing_details?.[0]?.state || "";
        const country = rawCountry ? normalizeCountry(rawCountry) : (rawState ? "India" : "India");
        return {
          party_name,
          party_id: lDoc?._id ? String(lDoc._id) : (partyId || null),
          country,
          state: rawState,
          ledger_name: ledgerNames[0] || party_name,
          ledger_names: ledgerNames,
          amount: netAmount,
          vouchers_count: voucherIds.length,
          voucher_ids: voucherIds,
        };
      })
      .filter((p) => p.amount !== 0)
      .sort((a, b) => b.amount - a.amount);
    // 6. Build direct/cash sales list
    const directSales = Array.from(nonPartyNetRevenueMap.entries())
      .map(([ledger_name, netRevenue]) => {
        const netAmount = Math.round(netRevenue * 100) / 100;
        const voucherIds = Array.from(nonPartyVouchersSet.get(ledger_name) || []);
        return {
          ledger_name,
          amount: netAmount,
          vouchers_count: voucherIds.length,
          voucher_ids: voucherIds,
        };
      })
      .filter((item) => item.amount !== 0)
      .sort((a, b) => b.amount - a.amount);
    // 7. Calculate total amounts
    const totalPartyAmount = Math.round(
      parties.reduce((sum, party) => sum + party.amount, 0) * 100
    ) / 100;
    const totalDirectAmount = Math.round(
      directSales.reduce((sum, item) => sum + item.amount, 0) * 100
    ) / 100;
    const totalAmount = Math.round((totalPartyAmount + totalDirectAmount) * 100) / 100;
    return ok(
      res,
      {
        total_amount: totalAmount,
        total_parties: parties.length,
        total_party_amount: totalPartyAmount,
        total_direct_amount: totalDirectAmount,
        parties,
        direct_sales: directSales,
      },
      "Revenue by party retrieved successfully"
    );
  } catch (error) {
    next(error);
  }
};



export { getsales };