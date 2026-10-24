import mongoose from "mongoose";
import LedgerPosting from "../ledger/ledgerPosting.schema.js";
import Ledger from "../../tally/ledger/ledger.schema.js";
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
 * Ledger Account Statement & Running Balance Service
 * Computes:
 * 1. Base opening + prior delta (prior to from_date) -> period Opening Balance
 * 2. Chronological transactions (from_date <= date <= to_date) with debit, credit
 * 3. Exact running balance after every single transaction
 * 4. Total debits, total credits, and Closing Balance
 */
export async function getLedgerStatementReportService(params = {}) {
  const {
    companyId,
    ledgerId,
    ledger_name,
    ledgerName,
    party_name,
    partyName,
    name,
    page = 1,
    limit = 100,
  } = params;

  const company = await resolveCompanyDoc(companyId);
  const targetCompanyId = company._id;

  // 1. Resolve Target Ledger
  let targetLedgerId = null;
  let ledgerDoc = null;

  if (ledgerId && mongoose.Types.ObjectId.isValid(ledgerId)) {
    targetLedgerId = new mongoose.Types.ObjectId(ledgerId);
    ledgerDoc = await Ledger.findById(targetLedgerId).lean();
  } else {
    const lName = ledger_name || ledgerName || party_name || partyName || name;
    if (lName) {
      ledgerDoc = await Ledger.findOne({
        company_id: targetCompanyId,
        $or: [
          { name: new RegExp(`^${lName.trim()}$`, "i") },
          { name: new RegExp(lName.trim(), "i") },
        ],
      }).lean();
      if (ledgerDoc) {
        targetLedgerId = ledgerDoc._id;
      }
    }
  }

  if (!targetLedgerId || !ledgerDoc) {
    throw ApiError.badRequest("Valid ledgerId or ledger_name is required");
  }

  // 2. Resolve Date Bounds
  const { fromDate: effectiveFrom, toDate: effectiveTo } = resolveDateFilter(params);

  // 3. Determine Account Normal Balance Type (Dr for Assets/Debtors/Expenses, Cr for Liabilities/Creditors/Incomes)
  const buckets = await getCompanyLedgerBuckets(targetCompanyId);
  const ledgerIdStr = targetLedgerId.toString();

  const isLiabilityOrIncome =
    buckets.creditorLedgerIds.has(ledgerIdStr) ||
    buckets.salesLedgerIds.has(ledgerIdStr) ||
    (ledgerDoc.parent && (
      ledgerDoc.parent.includes("Creditor") ||
      ledgerDoc.parent.includes("Liability") ||
      ledgerDoc.parent.includes("Capital") ||
      ledgerDoc.parent.includes("Sales")
    ));

  // Base opening from ledger master
  // In Tally XML: negative raw opening is Debit, positive is Credit
  const rawBaseOpening = ledgerDoc.opening_balance || ledgerDoc.openingBalance || 0;
  let baseOpeningDrCr = 0;
  if (typeof rawBaseOpening === "number") {
    // If standard number, negative is Debit in Tally conventions
    baseOpeningDrCr = rawBaseOpening < 0 ? Math.abs(rawBaseOpening) : -Math.abs(rawBaseOpening);
  }

  // 4. Calculate Prior Postings Delta (where date < effectiveFrom)
  let priorDebit = 0;
  let priorCredit = 0;

  if (effectiveFrom) {
    const priorMatch = {
      companyId: targetCompanyId,
      ledgerId: targetLedgerId,
      date: { $lt: effectiveFrom },
    };

    const priorAgg = await LedgerPosting.aggregate([
      { $match: priorMatch },
      {
        $group: {
          _id: null,
          totalDebit: { $sum: "$debit" },
          totalCredit: { $sum: "$credit" },
        },
      },
    ]);

    if (priorAgg.length > 0) {
      priorDebit = (priorAgg[0].totalDebit || 0) / 100;
      priorCredit = (priorAgg[0].totalCredit || 0) / 100;
    }
  }

  // Net Opening Balance (in Debit terms: Debit positive, Credit negative)
  const netOpeningDr = baseOpeningDrCr + (priorDebit - priorCredit);

  // 5. Query Postings in Date Range sorted chronologically
  const periodMatch = {
    companyId: targetCompanyId,
    ledgerId: targetLedgerId,
  };
  if (effectiveFrom || effectiveTo) {
    Object.assign(periodMatch, buildDateMatch(effectiveFrom, effectiveTo, "date"));
  }

  const postings = await LedgerPosting.find(periodMatch)
    .sort({ date: 1, createdAt: 1 })
    .lean();

  // 6. Compute Running Balance for each transaction
  let runningDr = netOpeningDr;
  let totalPeriodDebit = 0;
  let totalPeriodCredit = 0;

  const transactions = [];

  for (const post of postings) {
    const dr = (post.debit || 0) / 100;
    const cr = (post.credit || 0) / 100;
    totalPeriodDebit += dr;
    totalPeriodCredit += cr;

    runningDr += (dr - cr);

    let balanceType = "Dr";
    let displayBalance = runningDr;

    if (isLiabilityOrIncome) {
      // For liability/creditor, Credit is positive
      balanceType = runningDr <= 0 ? "Cr" : "Dr";
      displayBalance = Math.abs(runningDr);
    } else {
      // For asset/debtor/bank, Debit is positive
      balanceType = runningDr >= 0 ? "Dr" : "Cr";
      displayBalance = Math.abs(runningDr);
    }

    let particulars = post.partyName || "";
    if (!particulars) {
      if (post.voucherType === "SALES") particulars = "Sales Account";
      else if (post.voucherType === "PURCHASE") particulars = "Purchase Account";
      else if (post.voucherType === "RECEIPT") particulars = "Receipt / Collection";
      else if (post.voucherType === "PAYMENT") particulars = "Payment / Disbursement";
      else particulars = `${post.voucherType} Entry`;
    }

    transactions.push({
      postingId: post._id,
      voucherId: post.voucherId,
      voucherNumber: post.voucherNumber,
      voucherType: post.voucherType,
      date: post.date,
      particulars,
      debit: round2(dr),
      credit: round2(cr),
      runningBalance: round2(displayBalance),
      runningBalanceType: balanceType,
    });
  }

  // 7. Calculate Period Opening and Closing Balance Objects
  const openingBalAbs = Math.abs(netOpeningDr);
  const openingBalType = isLiabilityOrIncome
    ? (netOpeningDr <= 0 ? "Cr" : "Dr")
    : (netOpeningDr >= 0 ? "Dr" : "Cr");

  const closingBalAbs = Math.abs(runningDr);
  const closingBalType = isLiabilityOrIncome
    ? (runningDr <= 0 ? "Cr" : "Dr")
    : (runningDr >= 0 ? "Dr" : "Cr");

  // 8. Pagination of transactions
  const totalTxCount = transactions.length;
  const pageNum = Math.max(1, parseInt(page, 10));
  const rawLimit = String(limit).toLowerCase();
  const take = rawLimit === "all" || rawLimit === "0" ? totalTxCount : Math.min(1000, Math.max(1, parseInt(limit, 10)));
  const skip = (pageNum - 1) * take;
  const paginatedTransactions = transactions.slice(skip, skip + take);

  return {
    company_id: targetCompanyId,
    company_name: company.name,
    ledger: {
      id: targetLedgerId,
      name: ledgerDoc.name,
      parent: ledgerDoc.parent,
      gstin: ledgerDoc.gstin || null,
      phone: ledgerDoc.phone || null,
      stateCode: ledgerDoc.stateCode || null,
      accountType: isLiabilityOrIncome ? "Liability / Income / Creditor" : "Asset / Expense / Debtor",
    },
    period: {
      from_date: effectiveFrom || null,
      to_date: effectiveTo || null,
    },
    openingBalance: {
      amount: round2(openingBalAbs),
      type: openingBalType,
    },
    summary: {
      totalDebit: round2(totalPeriodDebit),
      totalCredit: round2(totalPeriodCredit),
      netMovement: round2(totalPeriodDebit - totalPeriodCredit),
      transactionCount: totalTxCount,
    },
    closingBalance: {
      amount: round2(closingBalAbs),
      type: closingBalType,
    },
    pagination: {
      total: totalTxCount,
      page: pageNum,
      limit: take || totalTxCount,
      totalPages: take > 0 ? Math.ceil(totalTxCount / take) : 1,
    },
    ledger_name: ledgerDoc.name,
    total_count: totalTxCount,
    total_amount: round2(totalPeriodDebit + totalPeriodCredit),
    total_dr_amount: round2(totalPeriodDebit),
    total_cr_amount: round2(totalPeriodCredit),
    transactions: paginatedTransactions,
    vouchers: paginatedTransactions,
  };
}

