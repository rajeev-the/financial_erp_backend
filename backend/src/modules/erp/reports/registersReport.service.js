import mongoose from "mongoose";
import UnifiedVoucher from "../voucher/voucher.unified.schema.js";
import Company from "../../companies/company.schema.js";
import { resolveDateFilter, buildDateMatch } from "./dateFilter.helper.js";
import { ApiError } from "../../../utils/api-error.js";

const MONTH_NAMES = [
  "April", "May", "June", "July", "August", "September",
  "October", "November", "December", "January", "February", "March",
];

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
 * 12-Month Sales or Purchase Register summary.
 * Handles ALL filters:
 * - voucherType, voucher_type, type (default 'SALES')
 * - fy, financial_year, targetYear, year
 * - from_date, to_date, period, timeline, quarter
 * - from_year, from_month, to_year, to_month
 * - partyId, partyName
 */
export async function getMonthlyRegisterService(params = {}) {
  const { companyId, voucherType, voucher_type, type, partyId } = params;
  const company = await resolveCompanyDoc(companyId);
  const targetCompanyId = company._id;

  const targetVoucherType = (voucherType || voucher_type || type || "SALES").toUpperCase();

  const { fromDate, toDate } = resolveDateFilter(params);

  const matchFilter = {
    companyId: targetCompanyId,
    voucherType: targetVoucherType,
    status: "POSTED",
  };
  if (fromDate || toDate) {
    Object.assign(matchFilter, buildDateMatch(fromDate, toDate, "date"));
  }
  if (partyId && mongoose.Types.ObjectId.isValid(partyId)) {
    matchFilter["party.ledgerId"] = new mongoose.Types.ObjectId(partyId);
  }

  const monthlyAgg = await UnifiedVoucher.aggregate([
    { $match: matchFilter },
    {
      $project: {
        yearMonth: { $substr: ["$date", 0, 7] }, // "YYYY-MM"
        month: { $substr: ["$date", 5, 2] },     // "MM"
        year: { $substr: ["$date", 0, 4] },      // "YYYY"
        grandTotal: "$summary.grandTotal",
        taxTotal: "$summary.taxTotal",
        subtotal: "$summary.subtotal",
      },
    },
    {
      $group: {
        _id: "$yearMonth",
        monthNum: { $first: "$month" },
        yearNum: { $first: "$year" },
        count: { $sum: 1 },
        totalAmountPaise: { $sum: "$grandTotal" },
        totalTaxPaise: { $sum: "$taxTotal" },
        totalSubtotalPaise: { $sum: "$subtotal" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const months = monthlyAgg.map((m) => {
    const monthInt = parseInt(m.monthNum, 10);
    // FY order: Apr(4)=0 ... Dec(12)=8, Jan(1)=9, Feb(2)=10, Mar(3)=11
    const fyIndex = monthInt >= 4 ? monthInt - 4 : monthInt + 8;
    return {
      yearMonth: m._id,
      monthName: MONTH_NAMES[fyIndex] || m._id,
      voucherCount: m.count,
      grossAmount: (m.totalAmountPaise || 0) / 100,
      taxAmount: (m.totalTaxPaise || 0) / 100,
      netAmount: (m.totalSubtotalPaise || 0) / 100,
    };
  });

  const totalGross = months.reduce((sum, m) => sum + m.grossAmount, 0);
  const totalTax = months.reduce((sum, m) => sum + m.taxAmount, 0);
  const totalVouchers = months.reduce((sum, m) => sum + m.voucherCount, 0);

  return {
    company_id: targetCompanyId,
    company_name: company.name,
    voucherType: targetVoucherType,
    period: {
      from_date: fromDate || null,
      to_date: toDate || null,
      fy: params.fy || params.financial_year || params.targetYear || null,
    },
    totalVouchers,
    totalGrossAmount: Math.round(totalGross * 100) / 100,
    totalTaxAmount: Math.round(totalTax * 100) / 100,
    months,
  };
}

/**
 * Detailed voucher list for a specific Year-Month drill-down.
 * Handles ALL filters:
 * - yearMonth: "YYYY-MM"
 * - search, q, voucherNumber, partyName
 * - paymentStatus, status
 * - minAmount, maxAmount
 * - sortBy, sortOrder
 * - page, limit
 */
export async function getMonthlyVouchersService(params = {}) {
  const {
    companyId,
    voucherType,
    voucher_type,
    type,
    yearMonth,
    search,
    q,
    voucherNumber,
    partyName,
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

  if (!yearMonth) {
    throw ApiError.badRequest("yearMonth (YYYY-MM) is required");
  }

  const company = await resolveCompanyDoc(companyId);
  const targetCompanyId = company._id;
  const targetVoucherType = (voucherType || voucher_type || type || "SALES").toUpperCase();

  const startDate = `${yearMonth}-01`;
  const [yearStr, monthStr] = yearMonth.split("-");
  const lastDay = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10), 0).getDate();
  const endDate = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;

  const filter = {
    companyId: targetCompanyId,
    voucherType: targetVoucherType,
    status: "POSTED",
    date: { $gte: startDate, $lte: endDate },
  };

  // Payment status filter
  const pStatus = (paymentStatus || payment_status || status || "").toUpperCase();
  if (pStatus && pStatus !== "ALL" && pStatus !== "POSTED") {
    filter.paymentStatus = pStatus;
  }

  // Search keyword
  const searchKeyword = (search || q || voucherNumber || partyName || "").trim();
  if (searchKeyword) {
    filter.$or = [
      { voucherNumber: new RegExp(searchKeyword, "i") },
      { "party.name": new RegExp(searchKeyword, "i") },
      { "party.gstin": new RegExp(searchKeyword, "i") },
    ];
  }

  // Amount filters (converted to paise in DB)
  if (minAmount !== undefined && minAmount !== null) {
    filter["summary.grandTotal"] = { ...(filter["summary.grandTotal"] || {}), $gte: Math.round(parseFloat(minAmount) * 100) };
  }
  if (maxAmount !== undefined && maxAmount !== null) {
    filter["summary.grandTotal"] = { ...(filter["summary.grandTotal"] || {}), $lte: Math.round(parseFloat(maxAmount) * 100) };
  }

  // Sorting
  const effSort = (sortBy || sort_by || "date").toLowerCase();
  const effOrder = (sortOrder || sort_order || "desc").toLowerCase() === "asc" ? 1 : -1;
  const sortStage = {};
  if (effSort === "amount" || effSort === "grandtotal") {
    sortStage["summary.grandTotal"] = effOrder;
  } else if (effSort === "partyname") {
    sortStage["party.name"] = effOrder;
  } else if (effSort === "vouchernumber") {
    sortStage.voucherNumber = effOrder;
  } else {
    sortStage.date = effOrder;
    sortStage.createdAt = effOrder;
  }

  const pageNum = Math.max(1, parseInt(page, 10));
  const rawLimit = String(limit).toLowerCase();
  const take = rawLimit === "all" || rawLimit === "0" ? 0 : Math.min(500, Math.max(1, parseInt(limit, 10)));
  const skip = take > 0 ? (pageNum - 1) * take : 0;

  let query = UnifiedVoucher.find(filter).sort(sortStage);
  if (skip > 0) query = query.skip(skip);
  if (take > 0) query = query.limit(take);

  const [vouchers, total] = await Promise.all([
    query.select("voucherNumber date party summary paymentStatus status").lean(),
    UnifiedVoucher.countDocuments(filter),
  ]);

  const formatted = vouchers.map((v) => ({
    _id: v._id,
    voucherNumber: v.voucherNumber,
    date: v.date,
    partyName: v.party?.name || "Cash",
    gstin: v.party?.gstin || null,
    totalAmount: (v.summary?.grandTotal || 0) / 100,
    taxAmount: (v.summary?.taxTotal || 0) / 100,
    paymentStatus: v.paymentStatus,
    status: v.status,
  }));

  return {
    company_id: targetCompanyId,
    company_name: company.name,
    voucherType: targetVoucherType,
    yearMonth,
    total,
    page: pageNum,
    limit: take || total,
    totalPages: take > 0 ? Math.ceil(total / take) : 1,
    vouchers: formatted,
  };
}
