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
 * Party Turnover Volume Rankings Service
 * Computes:
 * - Top Customer Rankings by Sales Revenue (type=revenue)
 * - Top Vendor Rankings by Purchase Volume (type=expense)
 * - Includes turnover, voucher count, average invoice size, % contribution to total business
 */
export async function getPartyRankingsReportService(params = {}) {
  const {
    companyId,
    type = "revenue",
    search,
    q,
    limit = 20,
    page = 1,
  } = params;

  const company = await resolveCompanyDoc(companyId);
  const targetCompanyId = company._id;

  const { fromDate: effectiveFrom, toDate: effectiveTo } = resolveDateFilter(params);

  const isRevenue = String(type).toLowerCase().includes("rev") || String(type).toLowerCase() === "sales";
  const targetVoucherType = isRevenue ? "SALES" : "PURCHASE";

  const matchFilter = {
    companyId: targetCompanyId,
    voucherType: targetVoucherType,
    status: "POSTED",
  };
  if (effectiveFrom || effectiveTo) {
    Object.assign(matchFilter, buildDateMatch(effectiveFrom, effectiveTo, "date"));
  }

  const searchKeyword = (search || q || "").trim();
  if (searchKeyword) {
    matchFilter["party.name"] = new RegExp(searchKeyword, "i");
  }

  const partyAgg = await UnifiedVoucher.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: "$party.ledgerId",
        partyName: { $first: "$party.name" },
        gstin: { $first: "$party.gstin" },
        totalAmountPaise: { $sum: "$summary.grandTotal" },
        voucherCount: { $sum: 1 },
      },
    },
    { $sort: { totalAmountPaise: -1 } },
  ]);

  const overallTurnoverPaise = partyAgg.reduce((sum, p) => sum + (p.totalAmountPaise || 0), 0);
  const overallTurnoverRs = round2(overallTurnoverPaise / 100);

  const totalParties = partyAgg.length;
  const pageNum = Math.max(1, parseInt(page, 10));
  const rawLimit = String(limit).toLowerCase();
  const take = rawLimit === "all" || rawLimit === "0" ? totalParties : Math.min(100, Math.max(1, parseInt(limit, 10)));
  const skip = (pageNum - 1) * take;

  const paginated = partyAgg.slice(skip, skip + take);

  const rankings = paginated.map((p, idx) => {
    const turnoverRs = round2((p.totalAmountPaise || 0) / 100);
    const count = p.voucherCount || 1;
    const avgRs = round2(turnoverRs / count);
    const pctShare = overallTurnoverRs > 0 ? round2((turnoverRs / overallTurnoverRs) * 100) : 0;

    return {
      rank: skip + idx + 1,
      partyId: p._id,
      partyName: p.partyName || "Unspecified Party",
      gstin: p.gstin || null,
      turnover: turnoverRs,
      voucherCount: count,
      averageVoucherAmount: avgRs,
      percentShare: pctShare,
    };
  });

  return {
    company_id: targetCompanyId,
    company_name: company.name,
    rankingType: isRevenue ? "TOP_CUSTOMERS_BY_REVENUE" : "TOP_VENDORS_BY_EXPENSE",
    period: {
      from_date: effectiveFrom || null,
      to_date: effectiveTo || null,
      fy: params.fy || params.financial_year || params.targetYear || null,
    },
    summary: {
      totalTurnover: overallTurnoverRs,
      totalVouchers: partyAgg.reduce((sum, p) => sum + (p.voucherCount || 0), 0),
      totalParties,
    },
    pagination: {
      total: totalParties,
      page: pageNum,
      limit: take,
      totalPages: Math.ceil(totalParties / take) || 1,
    },
    rankings,
  };
}
