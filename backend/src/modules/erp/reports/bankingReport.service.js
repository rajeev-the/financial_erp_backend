import mongoose from "mongoose";
import LedgerPosting from "../ledger/ledgerPosting.schema.js";
import Company from "../../companies/company.schema.js";
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
 * Banking Accounts & Liquidity Report Service
 * Computes:
 * 1. Comprehensive breakdown of all Bank and Cash accounts.
 * 2. Opening balance, total deposits (Dr), total withdrawals (Cr), closing balance.
 * 3. Total liquidity (Cash + Bank), net period cash flow.
 */
export async function getBankingAccountsReportService(params = {}) {
  const {
    companyId,
    type,
    accountType,
    search,
    q,
  } = params;

  const company = await resolveCompanyDoc(companyId);
  const targetCompanyId = company._id;

  const { fromDate: effectiveFrom, toDate: effectiveTo } = resolveDateFilter(params);

  const buckets = await getCompanyLedgerBuckets(targetCompanyId);

  // Filter accounts by type: 'BANK', 'CASH', or 'ALL'
  const filterType = (type || accountType || "ALL").trim().toUpperCase();
  const targetLedgerIds = new Set();

  if (filterType === "BANK" || filterType === "ALL") {
    for (const id of buckets.bankLedgerIds) targetLedgerIds.add(id);
  }
  if (filterType === "CASH" || filterType === "ALL") {
    for (const id of buckets.cashLedgerIds) targetLedgerIds.add(id);
  }

  const accountIdsArray = Array.from(targetLedgerIds).map((id) => new mongoose.Types.ObjectId(id));

  // 1. Calculate Prior Postings Delta (if fromDate specified)
  const priorDeltaMap = new Map();
  if (effectiveFrom) {
    const priorAgg = await LedgerPosting.aggregate([
      {
        $match: {
          companyId: targetCompanyId,
          ledgerId: { $in: accountIdsArray },
          date: { $lt: effectiveFrom },
        },
      },
      {
        $group: {
          _id: "$ledgerId",
          totalDebit: { $sum: "$debit" },
          totalCredit: { $sum: "$credit" },
        },
      },
    ]);

    for (const item of priorAgg) {
      const netPriorDr = ((item.totalDebit || 0) - (item.totalCredit || 0)) / 100;
      priorDeltaMap.set(item._id.toString(), netPriorDr);
    }
  }

  // 2. Query Period Postings for each account
  const periodMatch = {
    companyId: targetCompanyId,
    ledgerId: { $in: accountIdsArray },
  };
  if (effectiveFrom || effectiveTo) {
    Object.assign(periodMatch, buildDateMatch(effectiveFrom, effectiveTo, "date"));
  }

  const periodAgg = await LedgerPosting.aggregate([
    { $match: periodMatch },
    {
      $group: {
        _id: "$ledgerId",
        totalDebit: { $sum: "$debit" },
        totalCredit: { $sum: "$credit" },
        lastDate: { $max: "$date" },
        txCount: { $sum: 1 },
      },
    },
  ]);

  const periodMap = new Map();
  for (const item of periodAgg) {
    periodMap.set(item._id.toString(), item);
  }

  // 3. Assemble Accounts
  const searchKeyword = (search || q || "").trim().toLowerCase();
  const bankAccounts = [];
  const cashAccounts = [];

  let overallBankTotal = 0;
  let overallCashTotal = 0;
  let overallDeposits = 0;
  let overallWithdrawals = 0;

  for (const id of targetLedgerIds) {
    const l = buckets.ledgerMap.get(id);
    if (!l) continue;

    if (searchKeyword && !l.name.toLowerCase().includes(searchKeyword)) {
      continue;
    }

    const isBank = buckets.bankLedgerIds.has(id);

    // In Tally: raw opening < 0 is Debit (asset positive balance), raw > 0 is Credit (OD)
    const rawOpening = l.openingBalance || 0;
    const baseOpeningDr = rawOpening < 0 ? Math.abs(rawOpening) : (rawOpening > 0 ? -Math.abs(rawOpening) : 0);

    const priorDelta = priorDeltaMap.get(id) || 0;
    const periodOpening = round2(baseOpeningDr + priorDelta);

    const p = periodMap.get(id);
    const deposits = p ? p.totalDebit / 100 : 0;
    const withdrawals = p ? p.totalCredit / 100 : 0;
    const closing = round2(periodOpening + (deposits - withdrawals));

    const accountObj = {
      id: l.id,
      name: l.name,
      accountType: isBank ? "BANK" : "CASH",
      parentGroup: l.parent,
      openingBalance: periodOpening,
      deposits: round2(deposits),
      withdrawals: round2(withdrawals),
      closingBalance: closing,
      isOverdrawn: closing < 0,
      transactionCount: p?.txCount || 0,
      lastTransactionDate: p?.lastDate || null,
    };

    overallDeposits += deposits;
    overallWithdrawals += withdrawals;

    if (isBank) {
      bankAccounts.push(accountObj);
      overallBankTotal += closing;
    } else {
      cashAccounts.push(accountObj);
      overallCashTotal += closing;
    }
  }

  // Sort descending by closing balance
  bankAccounts.sort((a, b) => b.closingBalance - a.closingBalance);
  cashAccounts.sort((a, b) => b.closingBalance - a.closingBalance);

  return {
    company_id: targetCompanyId,
    company_name: company.name,
    period: {
      from_date: effectiveFrom || null,
      to_date: effectiveTo || null,
    },
    liquiditySummary: {
      totalBankBalance: round2(overallBankTotal),
      totalCashBalance: round2(overallCashTotal),
      totalLiquidity: round2(overallBankTotal + overallCashTotal),
      totalDeposits: round2(overallDeposits),
      totalWithdrawals: round2(overallWithdrawals),
      netPeriodCashFlow: round2(overallDeposits - overallWithdrawals),
      activeBankCount: bankAccounts.length,
      activeCashCount: cashAccounts.length,
    },
    bankAccounts,
    cashAccounts,
  };
}
