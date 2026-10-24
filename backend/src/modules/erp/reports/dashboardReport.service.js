import mongoose from "mongoose";
import LedgerPosting from "../ledger/ledgerPosting.schema.js";
import Company from "../../companies/company.schema.js";
import LedgerBalanceDetails from "../../tally/ledger/ledgerBalanceDetails.schema.js";
import { getCompanyLedgerBuckets } from "./groupHierarchy.helper.js";
import { resolveDateFilter, buildDateMatch } from "./dateFilter.helper.js";
import { ApiError } from "../../../utils/api-error.js";

const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

/**
 * Calculates Dashboard Home KPIs entirely from unified ledger_postings.
 * Supports all filters: from_date, to_date, fy, targetYear, period.
 */
export async function getUnifiedDashboardHomeService(params = {}) {
  const { companyId } = params;
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
  const targetCompanyId = company._id;

  // 1. Resolve Date Range Filters (handles timeline, period, fy, targetYear, from/to dates, quarters)
  const { fromDate: effectiveFrom, toDate: effectiveTo } = resolveDateFilter(params);

  // 2. Load and categorize company ledgers into fast lookup sets
  const buckets = await getCompanyLedgerBuckets(targetCompanyId);

  // 3. Build aggregation match filter on indexed fields
  const matchFilter = { companyId: targetCompanyId };
  if (effectiveFrom || effectiveTo) {
    Object.assign(matchFilter, buildDateMatch(effectiveFrom, effectiveTo, "date"));
  }

  // 4. Single Indexed Aggregation over ledger_postings grouped by ledgerId
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

  // 5. Accumulate totals
  let salesCr = 0;
  let salesDr = 0;
  let purchDr = 0;
  let purchCr = 0;
  let expDr = 0;
  let expCr = 0;
  let cashDr = 0;
  let cashCr = 0;
  let bankDr = 0;
  let bankCr = 0;
  let debtorDr = 0;
  let debtorCr = 0;
  let creditorDr = 0;
  let creditorCr = 0;

  for (const p of postings) {
    const id = p._id.toString();

    if (buckets.salesLedgerIds.has(id)) {
      salesCr += p.totalCredit;
      salesDr += p.totalDebit;
    }
    if (buckets.purchaseLedgerIds.has(id)) {
      purchDr += p.totalDebit;
      purchCr += p.totalCredit;
    }
    if (buckets.expenseLedgerIds.has(id) || buckets.directExpenseLedgerIds.has(id)) {
      expDr += p.totalDebit;
      expCr += p.totalCredit;
    }
    if (buckets.cashLedgerIds.has(id)) {
      cashDr += p.totalDebit;
      cashCr += p.totalCredit;
    }
    if (buckets.bankLedgerIds.has(id)) {
      bankDr += p.totalDebit;
      bankCr += p.totalCredit;
    }
    if (buckets.debtorLedgerIds.has(id)) {
      debtorDr += p.totalDebit;
      debtorCr += p.totalCredit;
    }
    if (buckets.creditorLedgerIds.has(id)) {
      creditorDr += p.totalDebit;
      creditorCr += p.totalCredit;
    }
  }

  // 6. Fetch baseline opening balances for Cash and Bank using earliest baseline date
  const cashIds = Array.from(buckets.cashLedgerIds).map((id) => new mongoose.Types.ObjectId(id));
  const bankIds = Array.from(buckets.bankLedgerIds).map((id) => new mongoose.Types.ObjectId(id));

  const [cashBalanceRecords, bankBalanceRecords] = await Promise.all([
    cashIds.length > 0
      ? LedgerBalanceDetails.find({ company_id: targetCompanyId, ledger_id: { $in: cashIds } }).sort({ from_date: 1 }).lean()
      : [],
    bankIds.length > 0
      ? LedgerBalanceDetails.find({ company_id: targetCompanyId, ledger_id: { $in: bankIds } }).sort({ from_date: 1 }).lean()
      : [],
  ]);

  let cashOpening = 0;
  if (cashBalanceRecords.length > 0) {
    const earliestDate = cashBalanceRecords[0].from_date;
    const recordsAtEarliest = cashBalanceRecords.filter((b) => String(b.from_date) === String(earliestDate));
    for (const b of recordsAtEarliest) {
      cashOpening += Math.abs(Number(b.opening_balance) || 0);
    }
  } else {
    for (const id of buckets.cashLedgerIds) {
      cashOpening += Math.abs(buckets.ledgerMap.get(id)?.openingBalance || 0);
    }
  }

  let bankOpening = 0;
  if (bankBalanceRecords.length > 0) {
    const earliestDate = bankBalanceRecords[0].from_date;
    const recordsAtEarliest = bankBalanceRecords.filter((b) => String(b.from_date) === String(earliestDate));
    for (const b of recordsAtEarliest) {
      const raw = Number(b.opening_balance) || 0;
      // In Tally: raw < 0 is Debit (asset positive balance), raw > 0 is Credit (OD)
      const isDebit = raw < 0;
      bankOpening += isDebit ? Math.abs(raw) : -Math.abs(raw);
    }
  } else {
    for (const id of buckets.bankLedgerIds) {
      const raw = buckets.ledgerMap.get(id)?.openingBalance || 0;
      const isDebit = raw < 0;
      bankOpening += isDebit ? Math.abs(raw) : -Math.abs(raw);
    }
  }

  // 7. Calculate final financial figures in Rupees
  const revenue = round2((salesCr - salesDr) / 100);
  const purchaseAmount = round2(purchDr / 100);
  const expenseAmount = round2(Math.abs(expDr - expCr) / 100);
  const totalExpense = round2(purchaseAmount + expenseAmount);
  const profit = round2(revenue - totalExpense);

  const cashBalance = round2(cashOpening + ((cashDr - cashCr) / 100));
  const bankBalance = round2(bankOpening + ((bankDr - bankCr) / 100));

  // Receivables & Payables (sum of outstanding party balances)
  let totalReceivable = 0;
  for (const id of buckets.debtorLedgerIds) {
    const l = buckets.ledgerMap.get(id);
    const post = postings.find((p) => p._id.toString() === id);
    const dr = post ? post.totalDebit / 100 : 0;
    const cr = post ? post.totalCredit / 100 : 0;
    const net = (l?.openingBalance || 0) + (dr - cr);
    if (net > 0) totalReceivable += net;
  }

  let totalPayable = 0;
  for (const id of buckets.creditorLedgerIds) {
    const l = buckets.ledgerMap.get(id);
    const post = postings.find((p) => p._id.toString() === id);
    const dr = post ? post.totalDebit / 100 : 0;
    const cr = post ? post.totalCredit / 100 : 0;
    const net = (l?.openingBalance || 0) + (cr - dr);
    if (net > 0) totalPayable += net;
  }

  return {
    company_id: company._id,
    company_name: company.name,
    period: {
      from_date: effectiveFrom,
      to_date: effectiveTo,
      fy: params.fy || params.financial_year || params.financialYear || params.targetYear || params.year || null,
    },
    revenue,
    expense: totalExpense,
    profit,
    net_profit: profit,
    totalRevenue: revenue,
    totalExpense,
    cash_balance: cashBalance,
    bank_balance: bankBalance,
    receivable: round2(totalReceivable),
    receivables: round2(totalReceivable),
    total_receivables: round2(totalReceivable),
    payable: round2(totalPayable),
    payables: round2(totalPayable),
    total_payables: round2(totalPayable),
    breakdown: {
      sales: revenue,
      purchase: purchaseAmount,
      indirectExpense: expenseAmount,
    },
  };
}
