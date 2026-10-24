import mongoose from "mongoose";
import UnifiedVoucher from "../voucher/voucher.unified.schema.js";
import Company from "../../companies/company.schema.js";
import { resolveDateFilter, buildDateMatch } from "./dateFilter.helper.js";
import { ApiError } from "../../../utils/api-error.js";

const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

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
 * Core Day Book Service:
 * Retrieves chronologically sorted vouchers across all voucher types for a given date or date range.
 * Supports comprehensive filtering: voucherType, search, paymentStatus, min/max amounts, pagination.
 */
export async function getDayBookReportService(params = {}) {
  const {
    companyId,
    date,
    voucherType,
    voucher_type,
    type,
    search,
    q,
    voucherNumber,
    paymentStatus,
    payment_status,
    status,
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

  // 1. Resolve Date Bounds
  let effectiveFrom = null;
  let effectiveTo = null;

  if (date) {
    // Single date filter
    const single = String(date).slice(0, 10);
    effectiveFrom = single;
    effectiveTo = single;
  } else {
    // Range filter (period, timeline, fy, from_date, to_date)
    const resolved = resolveDateFilter(params);
    effectiveFrom = resolved.fromDate;
    effectiveTo = resolved.toDate;
  }

  // 2. Build Query Filter
  const filter = {
    companyId: targetCompanyId,
    status: "POSTED",
  };

  if (effectiveFrom || effectiveTo) {
    Object.assign(filter, buildDateMatch(effectiveFrom, effectiveTo, "date"));
  }

  // Voucher Type filter
  const targetType = (voucherType || voucher_type || type || "").trim().toUpperCase();
  if (targetType && targetType !== "ALL") {
    filter.voucherType = targetType;
  }

  // Payment Status filter
  const pStatus = (paymentStatus || payment_status || status || "").trim().toUpperCase();
  if (pStatus && pStatus !== "ALL" && pStatus !== "POSTED") {
    filter.paymentStatus = pStatus;
  }

  // Search keyword (matches voucher number, party name, GSTIN, narration)
  const searchKeyword = (search || q || voucherNumber || "").trim();
  if (searchKeyword) {
    filter.$or = [
      { voucherNumber: new RegExp(searchKeyword, "i") },
      { "party.name": new RegExp(searchKeyword, "i") },
      { "party.gstin": new RegExp(searchKeyword, "i") },
      { narration: new RegExp(searchKeyword, "i") },
    ];
  }

  // Min / Max Grand Total filters (DB stores in paise)
  if (minAmount !== undefined && minAmount !== null && minAmount !== "") {
    const minPaise = Math.round(parseFloat(minAmount) * 100);
    filter["summary.grandTotal"] = { ...(filter["summary.grandTotal"] || {}), $gte: minPaise };
  }
  if (maxAmount !== undefined && maxAmount !== null && maxAmount !== "") {
    const maxPaise = Math.round(parseFloat(maxAmount) * 100);
    filter["summary.grandTotal"] = { ...(filter["summary.grandTotal"] || {}), $lte: maxPaise };
  }

  // 3. Sorting Stage
  const effSort = (sortBy || sort_by || "date").toLowerCase();
  const effOrder = (sortOrder || sort_order || "desc").toLowerCase() === "asc" ? 1 : -1;
  const sortStage = {};

  if (effSort === "amount" || effSort === "grandtotal") {
    sortStage["summary.grandTotal"] = effOrder;
  } else if (effSort === "partyname" || effSort === "party") {
    sortStage["party.name"] = effOrder;
  } else if (effSort === "vouchernumber" || effSort === "voucherno") {
    sortStage.voucherNumber = effOrder;
  } else {
    sortStage.date = effOrder;
    sortStage.createdAt = effOrder;
  }

  // 4. Pagination
  const pageNum = Math.max(1, parseInt(page, 10));
  const rawLimit = String(limit).toLowerCase();
  const take = rawLimit === "all" || rawLimit === "0" ? 0 : Math.min(500, Math.max(1, parseInt(limit, 10)));
  const skip = take > 0 ? (pageNum - 1) * take : 0;

  let query = UnifiedVoucher.find(filter).sort(sortStage);
  if (skip > 0) query = query.skip(skip);
  if (take > 0) query = query.limit(take);

  // 5. Query Vouchers & Aggregated Metrics in Parallel
  const [vouchers, total, typeSummaryAgg] = await Promise.all([
    query
      .select("voucherNumber voucherType date party summary paymentStatus narration entries allocations status")
      .lean(),
    UnifiedVoucher.countDocuments(filter),
    UnifiedVoucher.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$voucherType",
          count: { $sum: 1 },
          totalAmountPaise: { $sum: "$summary.grandTotal" },
        },
      },
    ]),
  ]);

  // Format type summary & overall total
  let totalAmountPaise = 0;
  const voucherTypeSummary = {};
  for (const item of typeSummaryAgg) {
    const vType = item._id || "OTHER";
    const amt = (item.totalAmountPaise || 0) / 100;
    voucherTypeSummary[vType] = {
      count: item.count,
      totalAmount: round2(amt),
    };
    totalAmountPaise += item.totalAmountPaise || 0;
  }

  // Format vouchers
  const formattedVouchers = vouchers.map((v) => {
    const grandPaise = v.summary?.grandTotal || 0;
    const settledPaise = (v.allocations || []).reduce((s, a) => s + (a.amount || 0), 0);
    const pendingPaise = Math.max(0, grandPaise - settledPaise);

    const partyName = v.party?.name || (v.entries?.[0]?.ledgerName ?? "General");
    const grandTotal = round2(grandPaise / 100);

    return {
      voucherId: v._id,
      _id: v._id,
      voucherNumber: v.voucherNumber,
      voucher_number: v.voucherNumber,
      voucherType: v.voucherType,
      voucher_type: v.voucherType,
      date: v.date,
      partyName,
      party_ledger_name: partyName,
      partyLedgerId: v.party?.ledgerId || null,
      partyGstin: v.party?.gstin || null,
      grandTotal,
      amount: grandTotal,
      total_amount: grandTotal,
      subtotal: round2((v.summary?.subtotal || 0) / 100),
      taxTotal: round2((v.summary?.taxTotal || 0) / 100),
      settledAmount: round2(settledPaise / 100),
      pendingAmount: round2(pendingPaise / 100),
      paymentStatus: v.paymentStatus,
      narration: v.narration || null,
      entriesCount: v.entries?.length || 0,
      entriesPreview: (v.entries || []).slice(0, 3).map((e) => ({
        ledgerName: e.ledgerName,
        debit: round2((e.debit || 0) / 100),
        credit: round2((e.credit || 0) / 100),
      })),
      ledgerentries: (v.entries || []).map((e) => ({
        ledger_name: e.ledgerName,
        ledgerName: e.ledgerName,
        amount: round2(((e.debit || 0) - (e.credit || 0)) / 100),
        entry_type: (e.debit || 0) > 0 ? "DEBIT" : "CREDIT",
      })),
    };
  });

  return {
    company_id: targetCompanyId,
    company_name: company.name,
    period: {
      from_date: effectiveFrom || null,
      to_date: effectiveTo || null,
      filterMode: date ? "single_date" : "range",
    },
    total,
    page: pageNum,
    limit: take || total,
    totalPages: take > 0 ? Math.ceil(total / take) : 1,
    total_sales: round2(voucherTypeSummary["SALES"]?.totalAmount || 0),
    summary: {
      totalVouchers: total,
      totalAmount: round2(totalAmountPaise / 100),
      byVoucherType: voucherTypeSummary,
    },
    pagination: {
      total,
      page: pageNum,
      limit: take || total,
      totalPages: take > 0 ? Math.ceil(total / take) : 1,
    },
    vouchers: formattedVouchers,
  };
}
