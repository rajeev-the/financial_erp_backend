import mongoose from "mongoose";
import UnifiedVoucher from "../voucher/voucher.unified.schema.js";
import Company from "../../companies/company.schema.js";
import LedgerPosting from "../ledger/ledgerPosting.schema.js";
import { getCompanyLedgerBuckets } from "./groupHierarchy.helper.js";
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
 * - Includes turnover, amount, voucher count, voucher IDs, and non-party expenses
 */
export async function getPartyRankingsReportService(params = {}) {
  const {
    companyId,
    type = "revenue",
    search,
    q,
    limit = 50,
    page = 1,
  } = params;

  const company = await resolveCompanyDoc(companyId);
  const targetCompanyId = company._id;

  const { fromDate: effectiveFrom, toDate: effectiveTo } = resolveDateFilter(params);

  const isRevenue = String(type).toLowerCase().includes("rev") || String(type).toLowerCase() === "sales";
  const buckets = await getCompanyLedgerBuckets(targetCompanyId);

  const searchKeyword = (search || q || "").trim();

  let overallTurnoverRs = 0;
  let totalParties = 0;
  let rankings = [];
  let nonPartyExpenses = [];
  let totalNonPartyAmount = 0;
  let totalPartyAmount = 0;

  const pageNum = Math.max(1, parseInt(page, 10));
  const rawLimit = String(limit).toLowerCase();

  if (isRevenue) {
    // ─── REVENUE: Group LedgerPostings across sales accounts ────────────────
    const salesLedgerOids = Array.from(buckets.salesLedgerIds).map((id) => new mongoose.Types.ObjectId(id));
    const postingMatch = {
      companyId: targetCompanyId,
      ledgerId: { $in: salesLedgerOids },
    };
    if (effectiveFrom || effectiveTo) {
      Object.assign(postingMatch, buildDateMatch(effectiveFrom, effectiveTo, "date"));
    }
    if (searchKeyword) {
      postingMatch.partyName = new RegExp(searchKeyword, "i");
    }

    const salesPostings = await LedgerPosting.aggregate([
      { $match: postingMatch },
      {
        $group: {
          _id: "$partyName",
          netPaise: { $sum: { $subtract: ["$credit", "$debit"] } },
          voucherCount: { $sum: 1 },
          voucherIds: { $addToSet: { $toString: "$voucherId" } },
        },
      },
      { $sort: { netPaise: -1 } },
    ]);

    // Keep parties with positive revenue contributions
    const validParties = salesPostings.filter((p) => p.netPaise > 0);
    const overallTurnoverPaise = salesPostings.reduce((sum, p) => sum + p.netPaise, 0);
    overallTurnoverRs = round2(overallTurnoverPaise / 100);

    totalParties = validParties.length;
    const take = rawLimit === "all" || rawLimit === "0" ? totalParties : Math.min(200, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * take;
    const paginated = validParties.slice(skip, skip + take);

    rankings = paginated.map((p, idx) => {
      const partyRevRs = round2(p.netPaise / 100);
      const vIds = p.voucherIds || [];
      const count = vIds.length || p.voucherCount || 1;
      const avgRs = round2(partyRevRs / count);
      const pctShare = overallTurnoverRs > 0 ? round2((partyRevRs / overallTurnoverRs) * 100) : 0;
      const partyDisplayName = p._id || "Unspecified Customer";

      return {
        rank: skip + idx + 1,
        partyId: p._id,
        party_name: partyDisplayName,
        partyName: partyDisplayName,
        gstin: null,
        amount: partyRevRs,
        total_amount: partyRevRs,
        totalAmount: partyRevRs,
        turnover: partyRevRs,
        voucherCount: count,
        vouchersCount: count,
        vouchers_count: count,
        voucher_ids: vIds,
        voucherIds: vIds,
        averageVoucherAmount: avgRs,
        percentShare: pctShare,
      };
    });

    totalPartyAmount = overallTurnoverRs;
  } else {
    // ─── EXPENSES: Group LedgerPostings across expense & purchase accounts ──
    const allExpenseOids = Array.from(buckets.expenseLedgerIds)
      .concat(Array.from(buckets.directExpenseLedgerIds))
      .concat(Array.from(buckets.purchaseLedgerIds))
      .map((id) => new mongoose.Types.ObjectId(id));

    const postingMatch = {
      companyId: targetCompanyId,
      ledgerId: { $in: allExpenseOids },
    };
    if (effectiveFrom || effectiveTo) {
      Object.assign(postingMatch, buildDateMatch(effectiveFrom, effectiveTo, "date"));
    }
    if (searchKeyword) {
      postingMatch.partyName = new RegExp(searchKeyword, "i");
    }

    // 1. Group by party name
    const partyExpensePostings = await LedgerPosting.aggregate([
      { $match: postingMatch },
      {
        $group: {
          _id: "$partyName",
          netPaise: { $sum: { $subtract: ["$debit", "$credit"] } },
          voucherCount: { $sum: 1 },
          voucherIds: { $addToSet: { $toString: "$voucherId" } },
        },
      },
      { $sort: { netPaise: -1 } },
    ]);

    // 2. Group by ledgerId for all expense categories
    const ledgerExpensePostings = await LedgerPosting.aggregate([
      { $match: postingMatch },
      {
        $group: {
          _id: "$ledgerId",
          netPaise: { $sum: { $subtract: ["$debit", "$credit"] } },
          voucherCount: { $sum: 1 },
          voucherIds: { $addToSet: { $toString: "$voucherId" } },
        },
      },
      { $sort: { netPaise: -1 } },
    ]);

    const totalExpensePaise = ledgerExpensePostings.reduce((sum, p) => sum + p.netPaise, 0);
    overallTurnoverRs = round2(totalExpensePaise / 100);

    // Vendor parties
    const validParties = partyExpensePostings.filter((p) => p.netPaise > 0);
    totalParties = validParties.length;
    const take = rawLimit === "all" || rawLimit === "0" ? totalParties : Math.min(200, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * take;
    const paginated = validParties.slice(skip, skip + take);

    rankings = paginated.map((p, idx) => {
      const partyExpRs = round2(p.netPaise / 100);
      const vIds = p.voucherIds || [];
      const count = vIds.length || p.voucherCount || 1;
      const avgRs = round2(partyExpRs / count);
      const pctShare = overallTurnoverRs > 0 ? round2((partyExpRs / overallTurnoverRs) * 100) : 0;
      const partyDisplayName = p._id || "Miscellaneous / General";

      return {
        rank: skip + idx + 1,
        partyId: p._id,
        party_name: partyDisplayName,
        partyName: partyDisplayName,
        gstin: null,
        amount: partyExpRs,
        total_amount: partyExpRs,
        totalAmount: partyExpRs,
        turnover: partyExpRs,
        voucherCount: count,
        vouchersCount: count,
        vouchers_count: count,
        voucher_ids: vIds,
        voucherIds: vIds,
        averageVoucherAmount: avgRs,
        percentShare: pctShare,
      };
    });

    totalPartyAmount = round2(validParties.reduce((s, p) => s + (p.netPaise / 100), 0));

    // Non-party expense ledgers
    nonPartyExpenses = ledgerExpensePostings
      .filter((lp) => lp.netPaise > 0)
      .map((lp) => {
        const l = buckets.ledgerMap.get(lp._id.toString());
        const netAmt = round2(lp.netPaise / 100);
        const vIds = lp.voucherIds || [];
        return {
          ledger_name: l?.name || "Miscellaneous Expense",
          ledgerName: l?.name || "Miscellaneous Expense",
          amount: netAmt,
          total_amount: netAmt,
          totalAmount: netAmt,
          vouchers_count: vIds.length || lp.voucherCount || 1,
          vouchersCount: vIds.length || lp.voucherCount || 1,
          voucher_count: vIds.length || lp.voucherCount || 1,
          voucher_ids: vIds,
          voucherIds: vIds,
        };
      });

    totalNonPartyAmount = overallTurnoverRs;
  }

  const take = rawLimit === "all" || rawLimit === "0" ? totalParties : Math.min(200, Math.max(1, parseInt(limit, 10)));

  return {
    company_id: targetCompanyId,
    companyId: targetCompanyId,
    company_name: company.name,
    companyName: company.name,
    rankingType: isRevenue ? "TOP_CUSTOMERS_BY_REVENUE" : "TOP_VENDORS_BY_EXPENSE",
    period: {
      from_date: effectiveFrom || null,
      to_date: effectiveTo || null,
      fy: params.fy || params.financial_year || params.targetYear || null,
    },
    total_amount: overallTurnoverRs,
    totalAmount: overallTurnoverRs,
    total_party_amount: totalPartyAmount,
    totalPartyAmount: totalPartyAmount,
    total_non_party_amount: totalNonPartyAmount,
    totalNonPartyAmount: totalNonPartyAmount,
    total_parties: totalParties,
    totalParties: totalParties,
    summary: {
      totalTurnover: overallTurnoverRs,
      totalPartyTurnover: totalPartyAmount,
      totalNonPartyTurnover: totalNonPartyAmount,
      totalVouchers: rankings.reduce((sum, p) => sum + (p.vouchersCount || 0), 0),
      totalParties,
    },
    pagination: {
      total: totalParties,
      page: pageNum,
      limit: take,
      totalPages: Math.ceil(totalParties / take) || 1,
    },
    parties: rankings,
    rankings,
    non_party_expenses: nonPartyExpenses,
    nonPartyExpenses,
  };
}
