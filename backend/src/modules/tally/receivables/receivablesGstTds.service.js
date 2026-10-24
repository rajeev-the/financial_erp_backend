import mongoose from "mongoose";
import { resolveAccountingData } from "../accounting/accounting.resolver.js";
import { getDebtorBaselineBalances, classifyEntry } from "./receivables.services.js";
import LedgerEntry from "../voucher/ledgerentry.schema.js";
import Company from "../../companies/company.schema.js";
import { ApiError } from "../../../utils/api-error.js";

/**
 * Utility: Round number to 2 decimal places
 */
const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

/**
 * Check if ledger is a GST ledger
 */
const isGstLedger = (ledger) => {
  if (!ledger) return false;
  if (ledger.gst_duty_head) return true;
  const parent = (ledger.parent || "").toLowerCase();
  const name = (ledger.name || "").toLowerCase();
  if (
    parent.includes("duties & taxes") ||
    parent.includes("duties and taxes") ||
    parent.includes("gst")
  ) {
    return !name.includes("tds");
  }
  return /\b(cgst|sgst|igst|utgst|gst)\b/i.test(name);
};

/**
 * Identify GST sub-type: cgst, sgst, igst, other_gst
 */
const getGstType = (ledger) => {
  const head = (ledger?.gst_duty_head || "").toLowerCase();
  const name = (ledger?.name || "").toLowerCase();
  if (head.includes("igst") || name.includes("igst")) return "igst";
  if (head.includes("cgst") || name.includes("cgst")) return "cgst";
  if (
    head.includes("sgst") ||
    name.includes("sgst") ||
    head.includes("utgst") ||
    name.includes("utgst")
  ) {
    return "sgst";
  }
  return "other_gst";
};

/**
 * Check if ledger is a TDS ledger
 */
const isTdsLedger = (ledger) => {
  if (!ledger) return false;
  const name = (ledger.name || "").toLowerCase();
  const parent = (ledger.parent || "").toLowerCase();
  return (
    name.includes("tds") ||
    parent.includes("tds") ||
    name.includes("tax deducted at source")
  );
};

/**
 * Calculate Receivables Bifurcation with GST and TDS
 *
 * Flow:
 * 1. Resolve Sundry Debtors & associated vouchers within date period
 * 2. Fetch all ledger entries belonging to these vouchers
 * 3. Classify entries into:
 *    - Debtor / Receivable (Sundry Debtors)
 *    - GST (CGST, SGST, IGST)
 *    - TDS (TDS Receivable / TDS Deducted)
 * 4. Compute customer receivables (Opening + Debit - Credit)
 * 5. Attribute GST & TDS per customer and summarize company-wide
 */
export const calculateReceivablesGstAndTdsService = async ({
  companyId,
  from_date,
  to_date,
  party_name,
  page,
  limit,
}) => {
  if (!companyId) {
    throw ApiError.badRequest("Company ID is required");
  }

  // 1. Resolve Company ID
  let targetCompanyId = null;
  if (mongoose.Types.ObjectId.isValid(companyId)) {
    targetCompanyId = new mongoose.Types.ObjectId(companyId);
  } else {
    const compDoc = await Company.findOne({
      $or: [{ tally_company_guid: companyId }, { name: companyId }],
      is_deleted: { $ne: true },
    }).select("_id");
    if (compDoc) {
      targetCompanyId = compDoc._id;
    }
  }

  if (!targetCompanyId) {
    throw ApiError.notFound("Company not found or invalid Company ID");
  }

  // 2. Parse dates
  const fromDate = from_date ? new Date(from_date) : null;
  let toDate = null;
  if (to_date) {
    toDate = new Date(to_date);
    toDate.setHours(23, 59, 59, 999);
  }

  // 3. Resolve "Sundry Debtors", child groups, ledgers, and transactions
  const debtorData = await resolveAccountingData({
    companyId: targetCompanyId,
    groupNames: ["Sundry Debtors"],
    fromDate,
    toDate,
  });

  let customerLedgers = debtorData.ledgers || [];
  if (party_name && party_name.trim()) {
    const search = party_name.trim().toLowerCase();
    customerLedgers = customerLedgers.filter((l) =>
      l.name?.trim().toLowerCase().includes(search)
    );
  }

  const customerLedgerIds = customerLedgers.map((l) => l._id);
  const customerLedgerIdSet = new Set(customerLedgerIds.map((id) => String(id)));

  const emptyResponse = {
    company_id: targetCompanyId,
    period: {
      from_date: from_date || null,
      to_date: to_date || null,
    },
    summary: {
      receivable: {
        total_receivable: 0,
        total_opening_balance: 0,
        total_debit: 0,
        total_credit: 0,
        closing_balance: 0,
      },
      gst: {
        total_gst: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        other_gst: 0,
      },
      tds: {
        total_tds: 0,
        tds_receivable: 0,
      },
      debtors_count: 0,
      vouchers_count: 0,
    },
    total_parties: 0,
    page: Number(page) || 1,
    limit: Number(limit) || 0,
    total_pages: 1,
    parties: [],
  };

  if (customerLedgerIds.length === 0) {
    return {
      ...emptyResponse,
      message: "No customer ledgers found for this company under Sundry Debtors",
    };
  }

  // 4. Fetch baseline opening balances & prior period adjustments for debtors
  const { balanceMap, baselineDate } = await getDebtorBaselineBalances(
    targetCompanyId,
    customerLedgerIds,
    fromDate
  );

  let priorEntriesByLedger = new Map();
  if (fromDate && baselineDate && fromDate > baselineDate) {
    const priorToDate = new Date(fromDate.getTime() - 1);
    const priorData = await resolveAccountingData({
      companyId: targetCompanyId,
      groupNames: ["Sundry Debtors"],
      fromDate: baselineDate,
      toDate: priorToDate,
    });

    for (const entry of priorData.entries || []) {
      const idStr = String(entry.ledger_id);
      if (!priorEntriesByLedger.has(idStr)) {
        priorEntriesByLedger.set(idStr, []);
      }
      priorEntriesByLedger.get(idStr).push(entry);
    }
  }

  // 5. Collect connected voucher IDs from debtor entries
  const voucherPartyMap = new Map(); // voucher_id -> debtor ledger_id
  const debtorVoucherIds = new Set();

  for (const entry of debtorData.entries || []) {
    if (entry?.voucher_id && entry?.ledger_id) {
      const vId = String(entry.voucher_id);
      const lId = String(entry.ledger_id);
      if (customerLedgerIdSet.has(lId)) {
        debtorVoucherIds.add(vId);
        voucherPartyMap.set(vId, lId);
      }
    }
  }

  // Also include party_ledger_id from voucher objects
  for (const v of debtorData.vouchers || []) {
    if (v?._id) {
      const vId = String(v._id);
      const partyId = v.party_ledger_id
        ? String(typeof v.party_ledger_id === "object" ? v.party_ledger_id._id || v.party_ledger_id : v.party_ledger_id)
        : null;
      if (partyId && customerLedgerIdSet.has(partyId)) {
        debtorVoucherIds.add(vId);
        voucherPartyMap.set(vId, partyId);
      }
    }
  }

  // 6. Fetch ALL ledger entries for these connected vouchers
  const allVoucherIds = Array.from(debtorVoucherIds).map(
    (id) => new mongoose.Types.ObjectId(id)
  );

  const allEntries = await LedgerEntry.find({
    company_id: targetCompanyId,
    voucher_id: { $in: allVoucherIds },
    is_deleted: { $ne: true },
  })
    .populate({
      path: "ledger_id",
      select: "name parent group_id gst_duty_head classification",
    })
    .lean();

  // 7. Data structures for party-wise and summary aggregation
  const partyDebtorEntries = new Map(); // ledger_id -> [entry]
  const partyGstMap = new Map(); // ledger_id -> { total, cgst, sgst, igst, other, ledgers: Map }
  const partyTdsMap = new Map(); // ledger_id -> { total, ledgers: Map }
  const partyVouchersSet = new Map(); // ledger_id -> Set(voucher_id)

  const summaryGst = { total_gst: 0, cgst: 0, sgst: 0, igst: 0, other_gst: 0 };
  const summaryTds = { total_tds: 0, tds_receivable: 0 };


  // 8. Classify each entry across all connected vouchers
  for (const entry of allEntries) {
    const vId = String(entry.voucher_id);
    const ledger = entry.ledger_id;
    const lId = ledger ? String(ledger._id) : null;
    const rawAmount = Number(entry.amount) || 0;
    const absAmount = Math.abs(rawAmount);

    // Identify which customer this voucher belongs to
    const associatedPartyId = voucherPartyMap.get(vId);

    if (lId && customerLedgerIdSet.has(lId)) {
      // --- Debtor Entry ---
      if (!partyDebtorEntries.has(lId)) {
        partyDebtorEntries.set(lId, []);
      }
      partyDebtorEntries.get(lId).push(entry);

      if (!partyVouchersSet.has(lId)) {
        partyVouchersSet.set(lId, new Set());
      }
      partyVouchersSet.get(lId).add(vId);
    } else if (isGstLedger(ledger)) {
      // --- GST Entry ---
      const gstType = getGstType(ledger);
      const ledgerName = ledger?.name || "GST";

      summaryGst.total_gst += absAmount;
      summaryGst[gstType] = (summaryGst[gstType] || 0) + absAmount;

      if (associatedPartyId) {
        const partyGst = getPartyGstObj(associatedPartyId, partyGstMap);
        partyGst.total_gst += absAmount;
        partyGst[gstType] = (partyGst[gstType] || 0) + absAmount;

        const currentLedgerAmt = partyGst.ledgers.get(ledgerName) || 0;
        partyGst.ledgers.set(ledgerName, currentLedgerAmt + absAmount);
      }
    } else if (isTdsLedger(ledger)) {
      // --- TDS Entry ---
      const ledgerName = ledger?.name || "TDS Receivable";

      summaryTds.total_tds += absAmount;
      summaryTds.tds_receivable += absAmount;

      if (associatedPartyId) {
        const partyTds = getPartyTdsObj(associatedPartyId, partyTdsMap);
        partyTds.total_tds += absAmount;
        partyTds.tds_receivable += absAmount;

        const currentLedgerAmt = partyTds.ledgers.get(ledgerName) || 0;
        partyTds.ledgers.set(ledgerName, currentLedgerAmt + absAmount);
      }
    }
  }

  // 9. Build per-customer bifurcation cards
  const parties = [];
  let totalPeriodDebit = 0;
  let totalPeriodCredit = 0;
  let totalOpeningBalance = 0;
  let totalReceivable = 0;

  for (const ledger of customerLedgers) {
    const idStr = String(ledger._id);
    let effectiveOpening = balanceMap.get(idStr) || 0;

    // Prior period adjustments if fromDate > baselineDate
    if (fromDate && baselineDate && fromDate > baselineDate && priorEntriesByLedger.has(idStr)) {
      for (const entry of priorEntriesByLedger.get(idStr)) {
        const { side, amount } = classifyEntry(entry);
        if (side === "debit") {
          effectiveOpening += amount;
        } else {
          effectiveOpening -= amount;
        }
      }
    }
    effectiveOpening = round2(effectiveOpening);

    // Current period transactions: classify into DEBIT and CREDIT
    let customerDebit = 0;
    let customerCredit = 0;
    const currentEntries = partyDebtorEntries.get(idStr) || [];

    for (const entry of currentEntries) {
      const { side, amount } = classifyEntry(entry);
      if (side === "debit") {
        customerDebit += amount;
      } else {
        customerCredit += amount;
      }
    }

    customerDebit = round2(customerDebit);
    customerCredit = round2(customerCredit);

    // Closing Balance = Opening + Debit (Sales) - Credit (Receipts)
    const closingBalance = round2(effectiveOpening + customerDebit - customerCredit);
    const netReceivable = closingBalance > 0 ? closingBalance : 0;

    let status = "cleared";
    if (closingBalance > 0) status = "pending";
    else if (closingBalance < 0) status = "advance";

    totalOpeningBalance += effectiveOpening;
    totalPeriodDebit += customerDebit;
    totalPeriodCredit += customerCredit;
    totalReceivable += netReceivable;

    // Party GST breakdown
    const partyGst = partyGstMap.get(idStr) || {
      total_gst: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      other_gst: 0,
      ledgers: new Map(),
    };

    const gstLedgersList = Array.from(partyGst.ledgers.entries()).map(
      ([ledger_name, amount]) => ({
        ledger_name,
        amount: round2(amount),
      })
    );

    // Party TDS breakdown
    const partyTds = partyTdsMap.get(idStr) || {
      total_tds: 0,
      tds_receivable: 0,
      ledgers: new Map(),
    };

    const tdsLedgersList = Array.from(partyTds.ledgers.entries()).map(
      ([ledger_name, amount]) => ({
        ledger_name,
        amount: round2(amount),
      })
    );

    const voucherIds = Array.from(partyVouchersSet.get(idStr) || []);

    parties.push({
      party_name: ledger.name,
      ledger_id: ledger._id,
      parent_group: ledger.parent || "Sundry Debtors",
      receivable: {
        opening_balance: effectiveOpening,
        debit: customerDebit,
        credit: customerCredit,
        net_change: round2(customerDebit - customerCredit),
        closing_balance: closingBalance,
        net_receivable: netReceivable,
        status,
      },
      gst: {
        total_gst: round2(partyGst.total_gst),
        cgst: round2(partyGst.cgst),
        sgst: round2(partyGst.sgst),
        igst: round2(partyGst.igst),
        other_gst: round2(partyGst.other_gst),
        ledgers: gstLedgersList,
      },
      tds: {
        total_tds: round2(partyTds.total_tds),
        tds_receivable: round2(partyTds.tds_receivable),
        ledgers: tdsLedgersList,
      },
      vouchers_count: voucherIds.length,
      voucher_ids: voucherIds,
    });
  }

  // 10. Sort parties: highest net receivable first
  parties.sort((a, b) => b.receivable.closing_balance - a.receivable.closing_balance);

  // Pagination
  const totalParties = parties.length;
  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 0;
  const paginatedParties =
    limitNum > 0
      ? parties.slice((pageNum - 1) * limitNum, pageNum * limitNum)
      : parties;

  const debtorsCount = parties.filter((p) => p.receivable.status === "pending").length;

  return {
    company_id: targetCompanyId,
    period: {
      from_date: from_date || null,
      to_date: to_date || null,
    },
    summary: {
      receivable: {
        total_receivable: round2(totalReceivable),
        total_opening_balance: round2(totalOpeningBalance),
        total_debit: round2(totalPeriodDebit),
        total_credit: round2(totalPeriodCredit),
        closing_balance: round2(totalOpeningBalance + totalPeriodDebit - totalPeriodCredit),
      },
      gst: {
        total_gst: round2(summaryGst.total_gst),
        cgst: round2(summaryGst.cgst),
        sgst: round2(summaryGst.sgst),
        igst: round2(summaryGst.igst),
        other_gst: round2(summaryGst.other_gst),
      },
      tds: {
        total_tds: round2(summaryTds.total_tds),
        tds_receivable: round2(summaryTds.tds_receivable),
      },
      debtors_count: debtorsCount,
      vouchers_count: debtorVoucherIds.size,
    },
    total_parties: totalParties,
    page: pageNum,
    limit: limitNum,
    total_pages: limitNum > 0 ? Math.ceil(totalParties / limitNum) || 1 : 1,
    parties: paginatedParties,
  };
};

/**
 * Helper to get or initialize party GST object
 */
function getPartyGstObj(partyId, partyGstMap) {
  if (!partyGstMap.has(partyId)) {
    partyGstMap.set(partyId, {
      total_gst: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      other_gst: 0,
      ledgers: new Map(),
    });
  }
  return partyGstMap.get(partyId);
}

/**
 * Helper to get or initialize party TDS object
 */
function getPartyTdsObj(partyId, partyTdsMap) {
  if (!partyTdsMap.has(partyId)) {
    partyTdsMap.set(partyId, {
      total_tds: 0,
      tds_receivable: 0,
      ledgers: new Map(),
    });
  }
  return partyTdsMap.get(partyId);
}

export default {
  calculateReceivablesGstAndTdsService,
};
