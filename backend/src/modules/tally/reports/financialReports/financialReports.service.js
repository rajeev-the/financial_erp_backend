import mongoose from "mongoose";
import TrialBalance from "../../trialBalance/trialBalance.schema.js";
import Ledger from "../../ledger/ledger.schema.js";
import Group from "../../group/group.schema.js";
import StockItem from "../../stock/stock.schema.js";
import {
  calculateProfitAndLoss,
  calculateBalanceSheet,
  calculateFinancialPosition,
} from "./financialReports.calculator.js";
import { ApiError } from "../../../../utils/api-error.js";

/**
 * Standard Tally Primary / Top-level Group Mappings
 */
const GROUP_PATTERNS = {
  sales: ["sales accounts"],
  purchases: ["purchase accounts"],
  directExpenses: ["direct expenses"],
  indirectExpenses: ["indirect expenses"],
  directIncomes: ["direct incomes"],
  indirectIncomes: ["indirect incomes"],
  capitalAccount: ["capital account", "reserves & surplus", "reserves and surplus"],
  securedLoans: ["secured loans"],
  unsecuredLoans: ["unsecured loans", "loans (liability)"],
  sundryCreditors: ["sundry creditors"],
  dutiesAndTaxes: ["duties & taxes", "duties and taxes"],
  provisions: ["provisions"],
  bankOd: ["bank od a/c", "bank occ a/c"],
  currentLiabilities: ["current liabilities"],
  fixedAssets: ["fixed assets"],
  investments: ["investments"],
  sundryDebtors: ["sundry debtors"],
  cashInHand: ["cash-in-hand"],
  bankAccounts: ["bank accounts"],
  depositsAsset: ["deposits (asset)", "loans & advances (asset)"],
  currentAssets: ["current assets"],
};

/**
 * Helper to match group name against patterns
 */
function matchesPattern(groupName, patterns) {
  if (!groupName) return false;
  const lower = groupName.trim().toLowerCase();
  return patterns.some((p) => lower === p || lower.includes(p));
}

/**
 * Extract bucketed accounting numbers from database
 */
async function extractAccountBuckets(companyId, fromDate, toDate) {
  const targetCompanyId = new mongoose.Types.ObjectId(companyId);

  // 1. Check Trial Balance first
  const tbQuery = {
    company_id: targetCompanyId,
    is_deleted: false,
  };

  if (fromDate) tbQuery.period_from = { $gte: new Date(fromDate) };
  if (toDate) {
    const toEnd = new Date(toDate);
    toEnd.setHours(23, 59, 59, 999);
    tbQuery.period_to = { $lte: toEnd };
  }

  const tbDocs = await TrialBalance.find(tbQuery).lean();

  const buckets = {
    sales: 0,
    purchases: 0,
    directExpenses: 0,
    indirectExpenses: 0,
    directIncomes: 0,
    indirectIncomes: 0,
    capitalAccount: 0,
    reservesAndSurplus: 0,
    securedLoans: 0,
    unsecuredLoans: 0,
    sundryCreditors: 0,
    dutiesAndTaxes: 0,
    provisions: 0,
    bankOverdraft: 0,
    otherCurrentLiabilities: 0,
    fixedAssets: 0,
    investments: 0,
    closingStock: 0,
    sundryDebtors: 0,
    cashInHand: 0,
    bankAccounts: 0,
    loansAndAdvancesAsset: 0,
    otherCurrentAssets: 0,
    salesBreakdown: [],
    purchasesBreakdown: [],
    directExpensesBreakdown: [],
    indirectExpensesBreakdown: [],
    incomesBreakdown: [],
    liabilitiesBreakdown: [],
    assetsBreakdown: [],
  };

  if (tbDocs.length > 0) {
    for (const doc of tbDocs) {
      const gName = doc.groupName || "";
      const dr = Math.abs(doc.closingDebitAmount || 0);
      const cr = Math.abs(doc.closingCreditAmount || 0);
      const netAmount = Math.abs(dr - cr);

      if (matchesPattern(gName, GROUP_PATTERNS.sales)) {
        buckets.sales += cr || netAmount;
        if (doc.accounts) buckets.salesBreakdown.push(...doc.accounts);
      } else if (matchesPattern(gName, GROUP_PATTERNS.purchases)) {
        buckets.purchases += dr || netAmount;
        if (doc.accounts) buckets.purchasesBreakdown.push(...doc.accounts);
      } else if (matchesPattern(gName, GROUP_PATTERNS.directExpenses)) {
        buckets.directExpenses += dr || netAmount;
        if (doc.accounts) buckets.directExpensesBreakdown.push(...doc.accounts);
      } else if (matchesPattern(gName, GROUP_PATTERNS.indirectExpenses)) {
        buckets.indirectExpenses += dr || netAmount;
        if (doc.accounts) buckets.indirectExpensesBreakdown.push(...doc.accounts);
      } else if (matchesPattern(gName, GROUP_PATTERNS.directIncomes)) {
        buckets.directIncomes += cr || netAmount;
        if (doc.accounts) buckets.incomesBreakdown.push(...doc.accounts);
      } else if (matchesPattern(gName, GROUP_PATTERNS.indirectIncomes)) {
        buckets.indirectIncomes += cr || netAmount;
        if (doc.accounts) buckets.incomesBreakdown.push(...doc.accounts);
      } else if (matchesPattern(gName, GROUP_PATTERNS.capitalAccount)) {
        buckets.capitalAccount += cr || netAmount;
        if (doc.accounts) buckets.liabilitiesBreakdown.push(...doc.accounts);
      } else if (matchesPattern(gName, GROUP_PATTERNS.securedLoans)) {
        buckets.securedLoans += cr || netAmount;
        if (doc.accounts) buckets.liabilitiesBreakdown.push(...doc.accounts);
      } else if (matchesPattern(gName, GROUP_PATTERNS.unsecuredLoans)) {
        buckets.unsecuredLoans += cr || netAmount;
        if (doc.accounts) buckets.liabilitiesBreakdown.push(...doc.accounts);
      } else if (matchesPattern(gName, GROUP_PATTERNS.sundryCreditors)) {
        buckets.sundryCreditors += cr || netAmount;
        if (doc.accounts) buckets.liabilitiesBreakdown.push(...doc.accounts);
      } else if (matchesPattern(gName, GROUP_PATTERNS.dutiesAndTaxes)) {
        buckets.dutiesAndTaxes += cr || netAmount;
        if (doc.accounts) buckets.liabilitiesBreakdown.push(...doc.accounts);
      } else if (matchesPattern(gName, GROUP_PATTERNS.provisions)) {
        buckets.provisions += cr || netAmount;
        if (doc.accounts) buckets.liabilitiesBreakdown.push(...doc.accounts);
      } else if (matchesPattern(gName, GROUP_PATTERNS.bankOd)) {
        buckets.bankOverdraft += cr || netAmount;
        if (doc.accounts) buckets.liabilitiesBreakdown.push(...doc.accounts);
      } else if (matchesPattern(gName, GROUP_PATTERNS.currentLiabilities)) {
        buckets.otherCurrentLiabilities += cr || netAmount;
        if (doc.accounts) buckets.liabilitiesBreakdown.push(...doc.accounts);
      } else if (matchesPattern(gName, GROUP_PATTERNS.fixedAssets)) {
        buckets.fixedAssets += dr || netAmount;
        if (doc.accounts) buckets.assetsBreakdown.push(...doc.accounts);
      } else if (matchesPattern(gName, GROUP_PATTERNS.investments)) {
        buckets.investments += dr || netAmount;
        if (doc.accounts) buckets.assetsBreakdown.push(...doc.accounts);
      } else if (matchesPattern(gName, GROUP_PATTERNS.sundryDebtors)) {
        buckets.sundryDebtors += dr || netAmount;
        if (doc.accounts) buckets.assetsBreakdown.push(...doc.accounts);
      } else if (matchesPattern(gName, GROUP_PATTERNS.cashInHand)) {
        buckets.cashInHand += dr || netAmount;
        if (doc.accounts) buckets.assetsBreakdown.push(...doc.accounts);
      } else if (matchesPattern(gName, GROUP_PATTERNS.bankAccounts)) {
        buckets.bankAccounts += dr || netAmount;
        if (doc.accounts) buckets.assetsBreakdown.push(...doc.accounts);
      } else if (matchesPattern(gName, GROUP_PATTERNS.depositsAsset)) {
        buckets.loansAndAdvancesAsset += dr || netAmount;
        if (doc.accounts) buckets.assetsBreakdown.push(...doc.accounts);
      } else if (matchesPattern(gName, GROUP_PATTERNS.currentAssets)) {
        buckets.otherCurrentAssets += dr || netAmount;
        if (doc.accounts) buckets.assetsBreakdown.push(...doc.accounts);
      }
    }
  }

  // 2. Fetch Closing Stock from StockItem collection if not set
  const stockItems = await StockItem.find({ company_id: targetCompanyId, is_deleted: false }).lean();
  const totalStockVal = stockItems.reduce((sum, item) => sum + (Number(item.closing_balance) || 0), 0);
  if (totalStockVal > 0) {
    buckets.closingStock = totalStockVal;
  }

  return buckets;
}

/**
 * Service to calculate pure Profit & Loss Statement
 */
export async function getProfitAndLossService({ companyId, fromDate, toDate }) {
  if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
    throw ApiError.badRequest("Valid companyId is required");
  }

  const buckets = await extractAccountBuckets(companyId, fromDate, toDate);
  const result = calculateProfitAndLoss(buckets);

  return {
    companyId,
    period: {
      from: fromDate || null,
      to: toDate || null,
    },
    ...result,
  };
}

/**
 * Service to calculate pure Balance Sheet Statement
 */
export async function getBalanceSheetService({ companyId, fromDate, toDate }) {
  if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
    throw ApiError.badRequest("Valid companyId is required");
  }

  const buckets = await extractAccountBuckets(companyId, fromDate, toDate);
  const pnl = calculateProfitAndLoss(buckets);
  const netProfit = pnl.summary.netProfit;

  const result = calculateBalanceSheet({
    ...buckets,
    netProfit,
  });

  return {
    companyId,
    period: {
      from: fromDate || null,
      to: toDate || null,
    },
    ...result,
  };
}

/**
 * Service to calculate Financial Position & Accounting Ratios
 */
export async function getFinancialPositionService({ companyId, fromDate, toDate }) {
  if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
    throw ApiError.badRequest("Valid companyId is required");
  }

  const buckets = await extractAccountBuckets(companyId, fromDate, toDate);
  const pnl = calculateProfitAndLoss(buckets);
  const bs = calculateBalanceSheet({ ...buckets, netProfit: pnl.summary.netProfit });

  const totalAssets = bs.assets.totalAssets;
  const currentAssets = bs.assets.currentAssets.total;
  const currentLiabilities = bs.liabilities.currentLiabilities.total;
  const totalLiabilities =
    bs.liabilities.nonCurrentLiabilities.total + bs.liabilities.currentLiabilities.total;
  const netWorth = bs.liabilities.equity.totalEquity;
  const totalDebt = bs.liabilities.nonCurrentLiabilities.total;
  const cashAndBank =
    bs.assets.currentAssets.cashInHand + bs.assets.currentAssets.bankAccounts;

  const position = calculateFinancialPosition({
    totalAssets,
    totalLiabilities,
    netWorth,
    currentAssets,
    currentLiabilities,
    closingStock: buckets.closingStock,
    cashAndBank,
    totalDebt,
  });

  return {
    companyId,
    period: {
      from: fromDate || null,
      to: toDate || null,
    },
    ...position,
  };
}
