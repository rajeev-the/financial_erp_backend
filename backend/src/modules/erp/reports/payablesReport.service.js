import mongoose from "mongoose";
import LedgerPosting from "../ledger/ledgerPosting.schema.js";
import UnifiedVoucher from "../voucher/voucher.unified.schema.js";
import Company from "../../companies/company.schema.js";
import Ledger from "../../tally/ledger/ledger.schema.js";
import { getCompanyLedgerBuckets } from "./groupHierarchy.helper.js";
import { resolveDateFilter, buildDateMatch } from "./dateFilter.helper.js";
import { ApiError } from "../../../utils/api-error.js";

const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

/**
 * Resolves Company from ObjectId, company_id, or company name
 */
async function resolveCompanyDoc(companyId) {
  if (!companyId) {
    throw ApiError.badRequest("Valid companyId is required");
  }
  let company = null;
  if (mongoose.Types.ObjectId.isValid(companyId)) {
    company = await Company.findById(companyId).select("name company_id").lean();
  }
  if (!company) {
    company = await Company.findOne({
      $or: [{ company_id: companyId }, { name: companyId }],
      is_deleted: { $ne: true },
    }).select("name company_id").lean();
  }
  if (!company) {
    throw ApiError.notFound("Company not found");
  }
  return company;
}

/**
 * Summary KPI for Payables (Total, Overdue, Not Due)
 * Supports all filters: from_date, to_date, fy, targetYear, period, timeline, etc.
 */
export async function getPayablesSummaryService(params = {}) {
  const { companyId } = params;
  const company = await resolveCompanyDoc(companyId);
  const targetCompanyId = company._id;

  const { fromDate: effectiveFrom, toDate: effectiveTo } = resolveDateFilter(params);

  const buckets = await getCompanyLedgerBuckets(targetCompanyId);

  // Match postings for creditors
  const matchFilter = {
    companyId: targetCompanyId,
    ledgerId: { $in: Array.from(buckets.creditorLedgerIds).map((id) => new mongoose.Types.ObjectId(id)) },
  };
  if (effectiveFrom || effectiveTo) {
    Object.assign(matchFilter, buildDateMatch(effectiveFrom, effectiveTo, "date"));
  }

  const postings = await LedgerPosting.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: "$ledgerId",
        totalDebit: { $sum: "$debit" },
        totalCredit: { $sum: "$credit" },
      },
    },
  ]);

  let totalPayable = 0;
  for (const id of buckets.creditorLedgerIds) {
    const l = buckets.ledgerMap.get(id);
    const post = postings.find((p) => p._id.toString() === id);
    const dr = post ? post.totalDebit / 100 : 0;
    const cr = post ? post.totalCredit / 100 : 0;
    const net = (l?.openingBalance || 0) + (cr - dr);
    if (net > 0) totalPayable += net;
  }

  // Calculate overdue from unpaid/partial purchase vouchers
  const todayStr = new Date().toISOString().slice(0, 10);
  const overdueVouchers = await UnifiedVoucher.find({
    companyId: targetCompanyId,
    voucherType: "PURCHASE",
    status: "POSTED",
    paymentStatus: { $in: ["UNPAID", "PARTIAL"] },
    dueDate: { $lt: todayStr, $ne: null },
  }).select("summary allocations").lean();

  let totalOverdue = 0;
  for (const v of overdueVouchers) {
    const grand = (v.summary?.grandTotal || 0) / 100;
    const settled = (v.allocations || []).reduce((s, a) => s + (a.amount || 0), 0) / 100;
    const pending = Math.max(0, grand - settled);
    totalOverdue += pending;
  }

  totalPayable = round2(totalPayable);
  totalOverdue = round2(totalOverdue);
  const notDue = round2(Math.max(0, totalPayable - totalOverdue));

  return {
    company_id: targetCompanyId,
    company_name: company.name,
    period: {
      from_date: effectiveFrom || null,
      to_date: effectiveTo || null,
      fy: params.fy || params.financial_year || params.targetYear || null,
    },
    totalPayable,
    totalOverdue,
    notDue,
    creditorCount: buckets.creditorLedgerIds.size,
  };
}

/**
 * Paginated, searchable vendor ledger list with real-time balances.
 * Handles ALL filters:
 * - Search: search, party_name, partyName, q, name
 * - Balance & Status: status ('all'|'outstanding'|'positive'|'zero'|'negative'|'advance'|'overdue'), overdueOnly, minBalance, maxBalance
 * - Group/Category: parent, group, state, stateCode
 * - Date Range: from_date, to_date, period, timeline, fy
 * - Sorting: sortBy ('balance'|'name'|'amount'|'date'|'lastDate'), sortOrder ('asc'|'desc')
 * - Pagination: page, limit
 */
export async function getPayablesPartiesService(params = {}) {
  const {
    companyId,
    search,
    party_name,
    partyName,
    q,
    name,
    page = 1,
    limit = 50,
    sortBy = "balance",
    sort_by,
    sortOrder = "desc",
    sort_order,
    order,
    status,
    overdueOnly,
    overdue_only,
    overdue,
    minBalance,
    min_balance,
    maxBalance,
    max_balance,
    parent,
    group,
    state,
    stateCode,
    state_code,
  } = params;

  const company = await resolveCompanyDoc(companyId);
  const targetCompanyId = company._id;

  const { fromDate: effectiveFrom, toDate: effectiveTo } = resolveDateFilter(params);

  const buckets = await getCompanyLedgerBuckets(targetCompanyId);
  const creditorIds = Array.from(buckets.creditorLedgerIds).map((id) => new mongoose.Types.ObjectId(id));

  // Build match filter for postings
  const matchFilter = { companyId: targetCompanyId, ledgerId: { $in: creditorIds } };
  if (effectiveFrom || effectiveTo) {
    Object.assign(matchFilter, buildDateMatch(effectiveFrom, effectiveTo, "date"));
  }

  // Single aggregate for transaction totals with voucher IDs
  const postings = await LedgerPosting.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: "$ledgerId",
        totalDebit: { $sum: "$debit" },
        totalCredit: { $sum: "$credit" },
        lastDate: { $max: "$date" },
        voucherIds: { $addToSet: { $toString: "$voucherId" } },
        vouchersCount: { $sum: 1 },
      },
    },
  ]);

  const postingMap = new Map();
  for (const p of postings) {
    postingMap.set(p._id.toString(), p);
  }

  const searchKeyword = (search || party_name || partyName || q || name || "").trim().toLowerCase();
  const groupFilter = (parent || group || "").trim().toLowerCase();
  const stateFilter = (state || stateCode || state_code || "").trim().toLowerCase();
  const isOverdueOnly = Boolean(overdueOnly || overdue_only || overdue || status === "overdue");
  const statusFilter = (status || "").trim().toLowerCase();
  const minBal = minBalance !== undefined ? parseFloat(minBalance) : (min_balance !== undefined ? parseFloat(min_balance) : null);
  const maxBal = maxBalance !== undefined ? parseFloat(maxBalance) : (max_balance !== undefined ? parseFloat(max_balance) : null);

  let partyList = [];
  let totalPayableSum = 0;
  let totalOpeningBalSum = 0;
  let totalDebitSum = 0;
  let totalCreditSum = 0;
  let totalVouchersSum = 0;

  for (const id of buckets.creditorLedgerIds) {
    const l = buckets.ledgerMap.get(id);
    if (!l) continue;

    // Search filter
    if (searchKeyword) {
      const matchName = (l.name || "").toLowerCase().includes(searchKeyword);
      const matchGstin = (l.gstin || "").toLowerCase().includes(searchKeyword);
      const matchPhone = (l.phone || "").toLowerCase().includes(searchKeyword);
      if (!matchName && !matchGstin && !matchPhone) continue;
    }

    // Group / Parent filter
    if (groupFilter) {
      const matchGroup = (l.parent || "").toLowerCase().includes(groupFilter);
      if (!matchGroup) continue;
    }

    // State filter
    if (stateFilter) {
      const matchState = (l.stateCode || "").toLowerCase() === stateFilter;
      if (!matchState) continue;
    }

    const p = postingMap.get(id);
    const dr = p ? p.totalDebit / 100 : 0;
    const cr = p ? p.totalCredit / 100 : 0;
    const netBalance = round2((l.openingBalance || 0) + (cr - dr));
    const vIds = p?.voucherIds || [];
    const vCount = p?.vouchersCount || vIds.length;

    // Balance status filter
    if (isOverdueOnly && netBalance <= 0) continue;
    if (statusFilter === "outstanding" || statusFilter === "positive") {
      if (netBalance <= 0) continue;
    } else if (statusFilter === "zero") {
      if (netBalance !== 0) continue;
    } else if (statusFilter === "negative" || statusFilter === "advance") {
      if (netBalance >= 0) continue;
    }

    // Min / Max balance filters
    if (minBal !== null && netBalance < minBal) continue;
    if (maxBal !== null && netBalance > maxBal) continue;

    if (netBalance > 0) totalPayableSum += netBalance;
    totalOpeningBalSum += (l.openingBalance || 0);
    totalDebitSum += dr;
    totalCreditSum += cr;
    totalVouchersSum += vCount;

    partyList.push({
      id: l.id,
      ledger_id: l.id,
      ledgerId: l.id,
      name: l.name,
      party_name: l.name,
      partyName: l.name,
      parent: l.parent,
      parent_group: l.parent,
      parentGroup: l.parent,
      gstin: l.gstin,
      stateCode: l.stateCode,
      phone: l.phone,
      openingBalance: l.openingBalance,
      periodDebit: round2(dr),
      periodCredit: round2(cr),
      currentBalance: netBalance,
      closingBalance: netBalance,
      lastTransactionDate: p?.lastDate || null,
      payable: {
        opening_balance: l.openingBalance || 0,
        debit: round2(dr),
        credit: round2(cr),
        net_change: round2(cr - dr),
        closing_balance: netBalance,
        net_payable: netBalance,
        status: netBalance > 0 ? "pending" : "cleared",
      },
      gst: { total_gst: 0, cgst: 0, sgst: 0, igst: 0, other_gst: 0, ledgers: [] },
      tds: { total_tds: 0, tds_payable: 0, ledgers: [] },
      vouchers_count: vCount,
      vouchersCount: vCount,
      voucher_ids: vIds,
      voucherIds: vIds,
    });
  }

  // Sorting
  const effectiveSortBy = (sortBy || sort_by || "balance").toLowerCase();
  const effectiveSortOrder = (sortOrder || sort_order || order || "desc").toLowerCase();

  partyList.sort((a, b) => {
    let cmp = 0;
    if (effectiveSortBy === "name") {
      cmp = (a.name || "").localeCompare(b.name || "");
    } else if (effectiveSortBy === "date" || effectiveSortBy === "lastdate") {
      cmp = (a.lastTransactionDate || "").localeCompare(b.lastTransactionDate || "");
    } else if (effectiveSortBy === "openingbalance") {
      cmp = (a.openingBalance || 0) - (b.openingBalance || 0);
    } else {
      cmp = (a.currentBalance || 0) - (b.currentBalance || 0);
    }
    return effectiveSortOrder === "asc" ? cmp : -cmp;
  });

  const total = partyList.length;
  const pageNum = Math.max(1, parseInt(page, 10));
  const rawLimit = String(limit).toLowerCase();
  const take = rawLimit === "all" || rawLimit === "0" ? total : Math.min(500, Math.max(1, parseInt(limit, 10)));
  const skip = (pageNum - 1) * take;
  const paginated = partyList.slice(skip, skip + take);

  return {
    company_id: targetCompanyId,
    companyId: targetCompanyId,
    company_name: company.name,
    companyName: company.name,
    total,
    page: pageNum,
    limit: take,
    totalPages: Math.ceil(total / take) || 1,
    total_pages: Math.ceil(total / take) || 1,
    totalParties: total,
    total_parties: total,
    totalPayable: round2(totalPayableSum),
    total_payable: round2(totalPayableSum),
    period: {
      from_date: effectiveFrom || null,
      to_date: effectiveTo || null,
      fy: params.fy || params.financial_year || params.targetYear || null,
    },
    summary: {
      payable: {
        total_payable: round2(totalPayableSum),
        total_opening_balance: round2(totalOpeningBalSum),
        total_debit: round2(totalDebitSum),
        total_credit: round2(totalCreditSum),
        closing_balance: round2(totalPayableSum),
      },
      gst: { total_gst: 0, cgst: 0, sgst: 0, igst: 0, other_gst: 0 },
      tds: { total_tds: 0, tds_payable: 0 },
      creditors_count: total,
      vouchers_count: totalVouchersSum,
    },
    parties: paginated,
  };
}

/**
 * Bill-by-Bill Aging Breakdown for a single vendor.
 * Supports partyId (ObjectId) OR party_name query lookup.
 * Handles ALL filters:
 * - Aging bracket: bracket, agingBracket ('all'|'0-30'|'31-60'|'61-90'|'90+')
 * - Status: paymentStatus, status ('ALL'|'UNPAID'|'PARTIAL'|'PAID'|'OVERDUE')
 * - Search: search, voucherNumber, bill_no
 * - Date Range: from_date, to_date, period, timeline, fy
 * - Min/Max amount: minAmount, maxAmount
 * - Sorting: sortBy, sortOrder
 * - Pagination: page, limit
 */
export async function getVendorBillsReportService(params = {}) {
  const {
    companyId,
    partyId,
    party_name,
    partyName,
    party,
    paymentStatus,
    payment_status,
    status,
    agingBracket,
    aging_bracket,
    bracket,
    search,
    voucherNumber,
    voucher_number,
    bill_no,
    minAmount,
    maxAmount,
    sortBy = "date",
    sort_by,
    sortOrder = "desc",
    sort_order,
    page = 1,
    limit = 50,
  } = params;

  const company = await resolveCompanyDoc(companyId);
  const targetCompanyId = company._id;

  // Resolve target party ledger
  let resolvedPartyId = null;
  let partyDoc = null;

  if (partyId && mongoose.Types.ObjectId.isValid(partyId)) {
    resolvedPartyId = new mongoose.Types.ObjectId(partyId);
    partyDoc = await Ledger.findById(resolvedPartyId).select("name gstin phone opening_balance").lean();
  } else {
    const pName = party_name || partyName || party || partyId;
    if (pName) {
      partyDoc = await Ledger.findOne({
        company_id: targetCompanyId,
        $or: [
          { name: new RegExp(`^${pName.trim()}$`, "i") },
          { name: new RegExp(pName.trim(), "i") },
        ],
      }).select("name gstin phone opening_balance").lean();
      if (partyDoc) {
        resolvedPartyId = partyDoc._id;
      }
    }
  }

  if (!resolvedPartyId) {
    throw ApiError.badRequest("Valid partyId or party_name is required");
  }

  // Build filter for UnifiedVoucher
  const filter = {
    companyId: targetCompanyId,
    "party.ledgerId": resolvedPartyId,
    status: "POSTED",
  };

  const { fromDate: effectiveFrom, toDate: effectiveTo } = resolveDateFilter(params);
  if (effectiveFrom || effectiveTo) {
    Object.assign(filter, buildDateMatch(effectiveFrom, effectiveTo, "date"));
  }

  // Payment status filter
  const pStatus = (paymentStatus || payment_status || status || "").toUpperCase();
  if (pStatus && pStatus !== "ALL") {
    if (pStatus === "OVERDUE") {
      filter.paymentStatus = { $in: ["UNPAID", "PARTIAL"] };
      filter.dueDate = { $lt: new Date().toISOString().slice(0, 10), $ne: null };
    } else {
      filter.paymentStatus = pStatus;
    }
  }

  // Bill number / narration search
  const billSearch = (search || voucherNumber || voucher_number || bill_no || "").trim();
  if (billSearch) {
    filter.$or = [
      { voucherNumber: new RegExp(billSearch, "i") },
      { narration: new RegExp(billSearch, "i") },
    ];
  }

  const vouchers = await UnifiedVoucher.find(filter)
    .sort({ date: -1, createdAt: -1 })
    .lean();

  const today = new Date();
  const targetBracket = (agingBracket || aging_bracket || bracket || "").trim().toLowerCase();
  const minAmt = minAmount !== undefined ? parseFloat(minAmount) : null;
  const maxAmt = maxAmount !== undefined ? parseFloat(maxAmount) : null;

  const bracketTotals = {
    "0-30": 0,
    "31-60": 0,
    "61-90": 0,
    "90+": 0,
  };

  let totalPendingPaise = 0;
  let totalGrandPaise = 0;
  const bills = [];

  for (const v of vouchers) {
    const grandPaise = v.summary?.grandTotal || 0;
    const settledPaise = (v.allocations || []).reduce((s, a) => s + (a.amount || 0), 0);
    const pendingPaise = Math.max(0, grandPaise - settledPaise);
    const grandRs = grandPaise / 100;
    const pendingRs = pendingPaise / 100;

    // Amount range filter
    if (minAmt !== null && grandRs < minAmt) continue;
    if (maxAmt !== null && grandRs > maxAmt) continue;

    // Aging calculation
    const dueDate = v.dueDate ? new Date(v.dueDate) : new Date(v.date);
    const diffTime = today.getTime() - dueDate.getTime();
    const agingDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));

    let b = "0-30";
    if (agingDays > 90) b = "90+";
    else if (agingDays > 60) b = "61-90";
    else if (agingDays > 30) b = "31-60";

    // Track totals
    if (pendingRs > 0) {
      bracketTotals[b] = round2(bracketTotals[b] + pendingRs);
    }
    totalPendingPaise += pendingPaise;
    totalGrandPaise += grandPaise;

    // Bracket filter
    if (targetBracket && targetBracket !== "all") {
      if (b !== targetBracket) continue;
    }

    bills.push({
      voucherId: v._id,
      voucherNumber: v.voucherNumber,
      voucherType: v.voucherType,
      date: v.date,
      dueDate: v.dueDate,
      grandTotal: grandRs,
      settledAmount: settledPaise / 100,
      pendingAmount: pendingRs,
      paymentStatus: v.paymentStatus,
      agingDays,
      agingBracket: b,
      isOverdue: agingDays > 0 && pendingPaise > 0,
      narration: v.narration,
    });
  }

  // Sort bills
  const effSort = (sortBy || sort_by || "date").toLowerCase();
  const effOrder = (sortOrder || sort_order || "desc").toLowerCase();

  bills.sort((a, b) => {
    let cmp = 0;
    if (effSort === "duedate") {
      cmp = (a.dueDate || "").localeCompare(b.dueDate || "");
    } else if (effSort === "amount" || effSort === "grandtotal") {
      cmp = a.grandTotal - b.grandTotal;
    } else if (effSort === "pendingamount") {
      cmp = a.pendingAmount - b.pendingAmount;
    } else if (effSort === "agingdays") {
      cmp = a.agingDays - b.agingDays;
    } else if (effSort === "vouchernumber") {
      cmp = (a.voucherNumber || "").localeCompare(b.voucherNumber || "");
    } else {
      cmp = (a.date || "").localeCompare(b.date || "");
    }
    return effOrder === "asc" ? cmp : -cmp;
  });

  const total = bills.length;
  const pageNum = Math.max(1, parseInt(page, 10));
  const rawLimit = String(limit).toLowerCase();
  const take = rawLimit === "all" || rawLimit === "0" ? total : Math.min(500, Math.max(1, parseInt(limit, 10)));
  const skip = (pageNum - 1) * take;

  return {
    party: {
      id: resolvedPartyId,
      name: partyDoc?.name || null,
      phone: partyDoc?.phone || null,
      gstin: partyDoc?.gstin || null,
    },
    total,
    page: pageNum,
    limit: take,
    totalPages: Math.ceil(total / take) || 1,
    totalGrandTotal: round2(totalGrandPaise / 100),
    totalPendingAmount: round2(totalPendingPaise / 100),
    bracketTotals,
    bills: bills.slice(skip, skip + take),
  };
}
