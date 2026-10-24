import mongoose from "mongoose";
import TrialBalance from "./trialBalance.schema.js";
import Receivable from "../receivables/receivable.schema.js";
import Company from "../../companies/company.schema.js";
import Payable from "../payables/payable.schema.js";
import { ApiError } from "../../../utils/api-error.js";
const GROUP_MAP = {
  salesAccounts: ["Sales Accounts"],
  purchaseAccounts: ["Purchase Accounts"],
  capitalAccount: ["Capital Account"],
  loansLiability: ["Loans (Liability)", "Secured Loans", "Unsecured Loans"],
  currentAssets: ["Current Assets"],
  currentLiabilities: ["Current Liabilities"],
  directExpenses: ["Direct Expenses"],
  indirectExpenses: ["Indirect Expenses"],
  directIncomes: ["Direct Incomes"],
  indirectIncomes: ["Indirect Incomes"],
  fixedAssets: ["Fixed Assets"],
  investments: ["Investments"],
};

const GROUP_NAME_TO_KEY = {};
for (const [key, names] of Object.entries(GROUP_MAP)) {
  for (const name of names) {
    GROUP_NAME_TO_KEY[name.toLowerCase()] = key;
  }
}

const round = (n) => Math.round(n * 100) / 100;

export const getTrialBalanceSummaryService = async ({
  companyId,
  fromDate,
  toDate,
  timeline,
}) => {
  const compIdFilter =
    companyId && mongoose.Types.ObjectId.isValid(companyId)
      ? new mongoose.Types.ObjectId(companyId)
      : null;

  if (!compIdFilter) {
    throw ApiError.badRequest("A valid company_id is required");
  }

  // Build query
  const query = {
    company_id: compIdFilter,
    is_deleted: false,
  };

  if (timeline) {
    query.timeline = timeline;
  }

  // Dates are stored as UTC dates.
  // Add end-of-day buffer to to_date to ensure the entire day is included.
  if (fromDate) {
    query.period_from = { $gte: new Date(fromDate) };
  }
  if (toDate) {
    const toEnd = new Date(toDate);
    toEnd.setHours(23, 59, 59, 999);
    query.period_to = { $lte: toEnd };
  }

  const trialBalanceData = await TrialBalance.find(query).lean();

  // Initialise result buckets
  const result = {};
  for (const key of Object.keys(GROUP_MAP)) {
    result[key] = {
      closingDebitAmount: 0,
      closingCreditAmount: 0,
      accounts: [],
    };
  }
  result.others = { closingDebitAmount: 0, closingCreditAmount: 0, groups: [] };

  // Pass 1: assign each top-level TrialBalance doc to its bucket by EXACT group name.
  for (const doc of trialBalanceData) {
    const bucketKey = GROUP_NAME_TO_KEY[doc.groupName?.trim().toLowerCase()];

    if (bucketKey) {
      result[bucketKey].closingDebitAmount += doc.closingDebitAmount || 0;
      result[bucketKey].closingCreditAmount += doc.closingCreditAmount || 0;
      if (doc.accounts?.length > 0) {
        result[bucketKey].accounts.push(...doc.accounts);
      }
    } else {
      result.others.closingDebitAmount += doc.closingDebitAmount || 0;
      result.others.closingCreditAmount += doc.closingCreditAmount || 0;
      result.others.groups.push({
        groupName: doc.groupName,
        closingDebitAmount: doc.closingDebitAmount || 0,
        closingCreditAmount: doc.closingCreditAmount || 0,
        accounts: doc.accounts || [],
      });
    }
  }

  // Capital Account override: when no date filter is applied, multiple years of
  // TrialBalance docs are returned and their amounts would be summed (wrong).
  // Use only the doc with the latest period_to to show just the last year's data.
  if (!fromDate && !toDate) {
    const capitalDocs = trialBalanceData.filter(
      (d) => d.groupName?.trim().toLowerCase() === "capital account",
    );
    if (capitalDocs.length > 0) {
      capitalDocs.sort((a, b) => {
        const dateA = new Date(a.period_to ?? a.period_from ?? 0).getTime();
        const dateB = new Date(b.period_to ?? b.period_from ?? 0).getTime();
        return dateB - dateA; // descending — latest first
      });
      const latest = capitalDocs[0];
      result.capitalAccount = {
        closingDebitAmount: latest.closingDebitAmount || 0,
        closingCreditAmount: latest.closingCreditAmount || 0,
        accounts: latest.accounts || [],
      };
    }
  }

  // Round all bucket amounts
  for (const key of Object.keys(result)) {
    result[key].closingDebitAmount = round(result[key].closingDebitAmount);
    result[key].closingCreditAmount = round(result[key].closingCreditAmount);
  }

  // Calculate high-level totals
  const totalSales = result.salesAccounts?.closingCreditAmount || 0;
  const totalPurchases = result.purchaseAccounts?.closingDebitAmount || 0;

  let cashInHand = 0;
  let bankBalance = 0;
  let netProfit = 0;
  let pnlFound = false;

  for (const doc of trialBalanceData) {
    const groupNameLower = doc.groupName?.trim().toLowerCase();
    if (
      groupNameLower === "cash-in-hand" ||
      groupNameLower === "cash in hand" ||
      groupNameLower === "cash"
    ) {
      cashInHand += (doc.closingDebitAmount || 0) + (doc.closingCreditAmount || 0);
    }
    if (
      groupNameLower === "bank accounts" ||
      groupNameLower === "bank account" ||
      groupNameLower === "bank"
    ) {
      bankBalance += (doc.closingDebitAmount || 0) + (doc.closingCreditAmount || 0);
    }
    if (/profit\s*(&|and)?\s*loss|p\s*&\s*l/i.test(doc.groupName || "")) {
      netProfit += (doc.closingDebitAmount || 0) + (doc.closingCreditAmount || 0);
      pnlFound = true;
    }

    if (Array.isArray(doc.accounts)) {
      for (const acc of doc.accounts) {
        const accName = acc.accountName?.trim().toLowerCase();
        if (
          accName === "cash-in-hand" ||
          accName === "cash in hand" ||
          accName === "cash"
        ) {
          cashInHand += (acc.closingDebitAmount || 0) + (acc.closingCreditAmount || 0);
        }
        if (
          accName === "bank accounts" ||
          accName === "bank account" ||
          accName === "bank"
        ) {
          bankBalance += (acc.closingDebitAmount || 0) + (acc.closingCreditAmount || 0);
        }
        if (/profit\s*(&|and)?\s*loss|p\s*&\s*l/i.test(acc.accountName || "")) {
          netProfit += (acc.closingDebitAmount || 0) + (acc.closingCreditAmount || 0);
          pnlFound = true;
        }
      }
    }
  }

  if (!pnlFound) {
    netProfit = totalSales + totalPurchases;
  }

  let receivables = 0;
  let payables = 0;

  const [recCount, payCount] = await Promise.all([
    Receivable.countDocuments({ company_id: compIdFilter, is_deleted: false }),
    Payable.countDocuments({ company_id: compIdFilter, is_deleted: false }),
  ]);

  if (recCount > 0 || payCount > 0) {
    const recQuery = { company_id: compIdFilter, is_deleted: false };
    const payQuery = { company_id: compIdFilter, is_deleted: false };

    if (fromDate) {
      recQuery.bill_date = {
        ...(recQuery.bill_date || {}),
        $gte: new Date(fromDate),
      };
      payQuery.bill_date = {
        ...(payQuery.bill_date || {}),
        $gte: new Date(fromDate),
      };
    }
    if (toDate) {
      const toEnd = new Date(toDate);
      toEnd.setHours(23, 59, 59, 999);
      recQuery.bill_date = { ...(recQuery.bill_date || {}), $lte: toEnd };
      payQuery.bill_date = { ...(payQuery.bill_date || {}), $lte: toEnd };
    }

    const [recDocs, payDocs] = await Promise.all([
      Receivable.find(recQuery).lean(),
      Payable.find(payQuery).lean(),
    ]);

    for (const r of recDocs) receivables += Math.abs(r.closing_amount || 0);
    for (const p of payDocs) payables += Math.abs(p.closing_amount || 0);
  }

  return {
    totalSales,
    totalPurchases,
    cashInHand: round(cashInHand),
    bankBalance: round(bankBalance),
    receivables: round(receivables),
    payables: round(payables),
    netProfit: round(netProfit),
    breakdown: result,
  };
};
