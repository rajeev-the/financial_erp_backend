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
 * 1. Profit & Loss Statement Service
 * Computes:
 * - Trading Account: Sales + Direct Incomes vs Purchases + Direct Expenses -> Gross Profit / Loss
 * - Income Statement: Gross Profit + Indirect Incomes vs Indirect Expenses -> Net Profit / Loss
 */
export async function getProfitAndLossReportService(params = {}) {
  const { companyId } = params;
  const company = await resolveCompanyDoc(companyId);
  const targetCompanyId = company._id;

  const { fromDate: effectiveFrom, toDate: effectiveTo } = resolveDateFilter(params);
  const buckets = await getCompanyLedgerBuckets(targetCompanyId);

  const matchFilter = { companyId: targetCompanyId };
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

  const postMap = new Map();
  for (const p of postings) {
    postMap.set(p._id.toString(), p);
  }

  // Accumulate Trading Account items
  let salesCr = 0, salesDr = 0;
  let purchDr = 0, purchCr = 0;
  let directExpDr = 0, directExpCr = 0;
  let directIncCr = 0, directIncDr = 0;

  // Accumulate P&L Income Statement items
  let indirectExpDr = 0, indirectExpCr = 0;
  let indirectIncCr = 0, indirectIncDr = 0;

  // Detail lists for drill-down
  const salesDetails = [];
  const purchaseDetails = [];
  const directExpDetails = [];
  const indirectExpDetails = [];

  for (const [id, l] of buckets.ledgerMap.entries()) {
    const p = postMap.get(id);
    const dr = p ? p.totalDebit / 100 : 0;
    const cr = p ? p.totalCredit / 100 : 0;
    if (dr === 0 && cr === 0) continue;

    if (buckets.salesLedgerIds.has(id)) {
      salesCr += cr; salesDr += dr;
      salesDetails.push({ id, name: l.name, amount: round2(cr - dr) });
    } else if (buckets.purchaseLedgerIds.has(id)) {
      purchDr += dr; purchCr += cr;
      purchaseDetails.push({ id, name: l.name, amount: round2(dr - cr) });
    } else if (buckets.directExpenseLedgerIds.has(id)) {
      directExpDr += dr; directExpCr += cr;
      directExpDetails.push({ id, name: l.name, amount: round2(dr - cr) });
    } else if (buckets.directIncomeLedgerIds.has(id)) {
      directIncCr += cr; directIncDr += dr;
    } else if (buckets.expenseLedgerIds.has(id)) {
      indirectExpDr += dr; indirectExpCr += cr;
      indirectExpDetails.push({ id, name: l.name, amount: round2(dr - cr) });
    } else if (buckets.indirectIncomeLedgerIds.has(id)) {
      indirectIncCr += cr; indirectIncDr += dr;
    }
  }

  const salesTotal = round2(salesCr - salesDr);
  const directIncomesTotal = round2(directIncCr - directIncDr);
  const totalTradingIncome = round2(salesTotal + directIncomesTotal);

  const purchaseTotal = round2(purchDr - purchCr);
  const directExpensesTotal = round2(directExpDr - directExpCr);
  const totalTradingCost = round2(purchaseTotal + directExpensesTotal);

  const grossProfit = round2(totalTradingIncome - totalTradingCost);

  const indirectIncomesTotal = round2(indirectIncCr - indirectIncDr);
  const indirectExpensesTotal = round2(indirectExpDr - indirectExpCr);

  const netProfit = round2(grossProfit + indirectIncomesTotal - indirectExpensesTotal);

  return {
    company_id: targetCompanyId,
    company_name: company.name,
    period: {
      from_date: effectiveFrom || null,
      to_date: effectiveTo || null,
      fy: params.fy || params.financial_year || params.targetYear || null,
    },
    tradingAccount: {
      income: {
        sales: salesTotal,
        directIncomes: directIncomesTotal,
        total: totalTradingIncome,
        salesBreakdown: salesDetails,
      },
      expense: {
        purchases: purchaseTotal,
        directExpenses: directExpensesTotal,
        total: totalTradingCost,
        purchaseBreakdown: purchaseDetails,
        directExpenseBreakdown: directExpDetails,
      },
      grossProfit,
      isGrossProfit: grossProfit >= 0,
    },
    incomeStatement: {
      grossProfit,
      indirectIncomes: indirectIncomesTotal,
      totalIncome: round2(grossProfit + indirectIncomesTotal),
      indirectExpenses: indirectExpensesTotal,
      indirectExpenseBreakdown: indirectExpDetails,
      netProfit,
      isNetProfit: netProfit >= 0,
    },
  };
}

/**
 * 2. Balance Sheet Service
 * Computes:
 * - Liabilities: Capital Account, Loans (Liability), Current Liabilities (Sundry Creditors, Duties & Taxes, Provisions), Net Profit
 * - Assets: Fixed Assets, Investments, Current Assets (Sundry Debtors, Cash, Bank, Other Assets)
 */
export async function getBalanceSheetReportService(params = {}) {
  const { companyId } = params;
  const company = await resolveCompanyDoc(companyId);
  const targetCompanyId = company._id;

  const { fromDate: effectiveFrom, toDate: effectiveTo } = resolveDateFilter(params);
  const buckets = await getCompanyLedgerBuckets(targetCompanyId);

  // 1. Calculate P&L Net Profit for the period
  const plReport = await getProfitAndLossReportService(params);
  const netProfit = plReport.incomeStatement.netProfit;

  // 2. Fetch all postings up to effectiveTo (or all time)
  const matchFilter = { companyId: targetCompanyId };
  if (effectiveTo) {
    matchFilter.date = { $lte: effectiveTo };
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

  const postMap = new Map();
  for (const p of postings) {
    postMap.set(p._id.toString(), p);
  }

  // Helper to compute net balance for a ledger
  // For Liabilities: Credit positive
  // For Assets: Debit positive
  let capitalTotal = 0;
  let loansTotal = 0;
  let creditorsTotal = 0;
  let dutiesTaxesTotal = 0;
  let otherLiabilitiesTotal = 0;

  let fixedAssetsTotal = 0;
  let investmentsTotal = 0;
  let debtorsTotal = 0;
  let bankAccountsTotal = 0;
  let cashInHandTotal = 0;
  let otherAssetsTotal = 0;

  for (const [id, l] of buckets.ledgerMap.entries()) {
    const p = postMap.get(id);
    const dr = p ? p.totalDebit / 100 : 0;
    const cr = p ? p.totalCredit / 100 : 0;

    const rawOpening = l.openingBalance || 0;
    const isLiability = buckets.creditorLedgerIds.has(id) || buckets.capitalLedgerIds.has(id) || buckets.loanLedgerIds.has(id) || buckets.liabilityLedgerIds.has(id);
    const baseOpeningDr = !isLiability ? (rawOpening > 0 ? rawOpening : 0) : (rawOpening < 0 ? Math.abs(rawOpening) : 0);
    const baseOpeningCr = isLiability ? (rawOpening > 0 ? rawOpening : 0) : (rawOpening < 0 ? Math.abs(rawOpening) : 0);

    // Net closing:
    const netDr = (baseOpeningDr + dr) - (baseOpeningCr + cr);
    const netCr = (baseOpeningCr + cr) - (baseOpeningDr + dr);

    if (buckets.capitalLedgerIds.has(id)) {
      capitalTotal += Math.max(0, netCr);
    } else if (buckets.loanLedgerIds.has(id)) {
      loansTotal += Math.max(0, netCr);
    } else if (buckets.creditorLedgerIds.has(id)) {
      creditorsTotal += Math.max(0, netCr);
    } else if (buckets.dutiesAndTaxesLedgerIds.has(id)) {
      dutiesTaxesTotal += netCr;
    } else if (buckets.liabilityLedgerIds.has(id)) {
      otherLiabilitiesTotal += Math.max(0, netCr);
    } else if (buckets.fixedAssetLedgerIds.has(id)) {
      fixedAssetsTotal += Math.max(0, netDr);
    } else if (buckets.investmentLedgerIds.has(id)) {
      investmentsTotal += Math.max(0, netDr);
    } else if (buckets.debtorLedgerIds.has(id)) {
      debtorsTotal += Math.max(0, netDr);
    } else if (buckets.bankLedgerIds.has(id)) {
      bankAccountsTotal += netDr;
    } else if (buckets.cashLedgerIds.has(id)) {
      cashInHandTotal += netDr;
    } else if (buckets.assetLedgerIds.has(id)) {
      otherAssetsTotal += Math.max(0, netDr);
    }
  }

  capitalTotal = round2(capitalTotal);
  loansTotal = round2(loansTotal);
  creditorsTotal = round2(creditorsTotal);
  dutiesTaxesTotal = round2(dutiesTaxesTotal);
  otherLiabilitiesTotal = round2(otherLiabilitiesTotal);

  fixedAssetsTotal = round2(fixedAssetsTotal);
  investmentsTotal = round2(investmentsTotal);
  debtorsTotal = round2(debtorsTotal);
  bankAccountsTotal = round2(bankAccountsTotal);
  cashInHandTotal = round2(cashInHandTotal);
  otherAssetsTotal = round2(otherAssetsTotal);

  const totalCurrentLiabilities = round2(creditorsTotal + Math.max(0, dutiesTaxesTotal) + otherLiabilitiesTotal);
  const totalLiabilities = round2(capitalTotal + loansTotal + totalCurrentLiabilities + netProfit);

  const totalCurrentAssets = round2(debtorsTotal + Math.max(0, bankAccountsTotal) + Math.max(0, cashInHandTotal) + otherAssetsTotal);
  const totalAssets = round2(fixedAssetsTotal + investmentsTotal + totalCurrentAssets);

  const workingCapital = round2(totalCurrentAssets - totalCurrentLiabilities);

  return {
    company_id: targetCompanyId,
    company_name: company.name,
    period: {
      from_date: effectiveFrom || null,
      to_date: effectiveTo || null,
      fy: params.fy || params.financial_year || params.targetYear || null,
    },
    liabilities: {
      capitalAccount: capitalTotal,
      loans: loansTotal,
      currentLiabilities: {
        sundryCreditors: creditorsTotal,
        dutiesAndTaxes: dutiesTaxesTotal,
        otherCurrentLiabilities: otherLiabilitiesTotal,
        total: totalCurrentLiabilities,
      },
      profitAndLossAccount: netProfit,
      totalLiabilities,
    },
    assets: {
      fixedAssets: fixedAssetsTotal,
      investments: investmentsTotal,
      currentAssets: {
        sundryDebtors: debtorsTotal,
        bankAccounts: bankAccountsTotal,
        cashInHand: cashInHandTotal,
        otherCurrentAssets: otherAssetsTotal,
        total: totalCurrentAssets,
      },
      totalAssets,
    },
    analysis: {
      workingCapital,
      isBalanced: Math.abs(totalLiabilities - totalAssets) < 5, // within nominal rounding threshold
      difference: round2(Math.abs(totalLiabilities - totalAssets)),
    },
  };
}

/**
 * 3. Trial Balance Tree Service
 * Computes:
 * Complete chart of accounts tree with Opening Dr/Cr, Period Dr/Cr, Closing Dr/Cr.
 * Verifies Double-Entry Invariant: Total Debit == Total Credit.
 */
export async function getTrialBalanceReportService(params = {}) {
  const { companyId } = params;
  const company = await resolveCompanyDoc(companyId);
  const targetCompanyId = company._id;

  const { fromDate: effectiveFrom, toDate: effectiveTo } = resolveDateFilter(params);
  const buckets = await getCompanyLedgerBuckets(targetCompanyId);

  // 1. Postings delta for prior to fromDate
  const priorDeltaMap = new Map();
  if (effectiveFrom) {
    const priorAgg = await LedgerPosting.aggregate([
      { $match: { companyId: targetCompanyId, date: { $lt: effectiveFrom } } },
      { $group: { _id: "$ledgerId", totalDebit: { $sum: "$debit" }, totalCredit: { $sum: "$credit" } } },
    ]);
    for (const p of priorAgg) {
      priorDeltaMap.set(p._id.toString(), {
        dr: (p.totalDebit || 0) / 100,
        cr: (p.totalCredit || 0) / 100,
      });
    }
  }

  // 2. Postings in period
  const matchFilter = { companyId: targetCompanyId };
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

  const postMap = new Map();
  for (const p of postings) {
    postMap.set(p._id.toString(), {
      dr: (p.totalDebit || 0) / 100,
      cr: (p.totalCredit || 0) / 100,
    });
  }

  let grandTotalOpeningDr = 0;
  let grandTotalOpeningCr = 0;
  let grandTotalPeriodDr = 0;
  let grandTotalPeriodCr = 0;
  let grandTotalClosingDr = 0;
  let grandTotalClosingCr = 0;

  const groupBucketsMap = new Map();

  let catSalesCr = 0, catSalesDr = 0;
  let catPurchDr = 0, catPurchCr = 0;
  let catExpDr = 0, catExpCr = 0;
  let catDebtorCloseDr = 0, catDebtorCloseCr = 0;
  let catCreditorCloseDr = 0, catCreditorCloseCr = 0;
  let catBankCloseDr = 0, catBankCloseCr = 0;
  let catCashCloseDr = 0, catCashCloseCr = 0;

  for (const [id, l] of buckets.ledgerMap.entries()) {
    const rawOpening = l.openingBalance || 0;
    const isLiability = buckets.creditorLedgerIds.has(id) || buckets.capitalLedgerIds.has(id) || buckets.loanLedgerIds.has(id) || buckets.liabilityLedgerIds.has(id);
    const baseDr = !isLiability ? (rawOpening > 0 ? rawOpening : 0) : (rawOpening < 0 ? Math.abs(rawOpening) : 0);
    const baseCr = isLiability ? (rawOpening > 0 ? rawOpening : 0) : (rawOpening < 0 ? Math.abs(rawOpening) : 0);

    const prior = priorDeltaMap.get(id) || { dr: 0, cr: 0 };
    const netOpen = (baseDr + prior.dr) - (baseCr + prior.cr);
    const openDr = netOpen > 0 ? netOpen : 0;
    const openCr = netOpen < 0 ? Math.abs(netOpen) : 0;

    const period = postMap.get(id) || { dr: 0, cr: 0 };
    const netClose = (openDr + period.dr) - (openCr + period.cr);
    const closeDr = netClose > 0 ? netClose : 0;
    const closeCr = netClose < 0 ? Math.abs(netClose) : 0;

    grandTotalOpeningDr += openDr;
    grandTotalOpeningCr += openCr;
    grandTotalPeriodDr += period.dr;
    grandTotalPeriodCr += period.cr;
    grandTotalClosingDr += closeDr;
    grandTotalClosingCr += closeCr;

    // Track category totals matching Dashboard KPIs
    let category = "Other";
    if (buckets.salesLedgerIds.has(id)) {
      category = "Sales Accounts";
      catSalesCr += period.cr;
      catSalesDr += period.dr;
    } else if (buckets.purchaseLedgerIds.has(id)) {
      category = "Purchase Accounts";
      catPurchDr += period.dr;
      catPurchCr += period.cr;
    } else if (buckets.expenseLedgerIds.has(id) || buckets.directExpenseLedgerIds.has(id)) {
      category = "Expenses";
      catExpDr += period.dr;
      catExpCr += period.cr;
    } else if (buckets.debtorLedgerIds.has(id)) {
      category = "Sundry Debtors";
      catDebtorCloseDr += closeDr;
      catDebtorCloseCr += closeCr;
    } else if (buckets.creditorLedgerIds.has(id)) {
      category = "Sundry Creditors";
      catCreditorCloseDr += closeDr;
      catCreditorCloseCr += closeCr;
    } else if (buckets.bankLedgerIds.has(id)) {
      category = "Bank Accounts";
      catBankCloseDr += closeDr;
      catBankCloseCr += closeCr;
    } else if (buckets.cashLedgerIds.has(id)) {
      category = "Cash-in-Hand";
      catCashCloseDr += closeDr;
      catCashCloseCr += closeCr;
    }

    const groupName = l.parent || "Primary";
    if (!groupBucketsMap.has(groupName)) {
      groupBucketsMap.set(groupName, {
        groupName,
        category,
        openingDr: 0,
        openingCr: 0,
        periodDr: 0,
        periodCr: 0,
        closingDr: 0,
        closingCr: 0,
        ledgers: [],
      });
    }

    const g = groupBucketsMap.get(groupName);
    g.openingDr += openDr;
    g.openingCr += openCr;
    g.periodDr += period.dr;
    g.periodCr += period.cr;
    g.closingDr += closeDr;
    g.closingCr += closeCr;

    if (openDr > 0 || openCr > 0 || period.dr > 0 || period.cr > 0 || closeDr > 0 || closeCr > 0) {
      g.ledgers.push({
        id,
        name: l.name,
        category,
        openingBalance: openDr > 0 ? { amount: round2(openDr), type: "Dr" } : { amount: round2(openCr), type: "Cr" },
        periodDebit: round2(period.dr),
        periodCredit: round2(period.cr),
        closingBalance: closeDr > 0 ? { amount: round2(closeDr), type: "Dr" } : { amount: round2(closeCr), type: "Cr" },
      });
    }
  }

  const groups = Array.from(groupBucketsMap.values()).map((g) => ({
    groupName: g.groupName,
    category: g.category,
    openingDebit: round2(g.openingDr),
    openingCredit: round2(g.openingCr),
    periodDebit: round2(g.periodDr),
    periodCredit: round2(g.periodCr),
    closingDebit: round2(g.closingDr),
    closingCredit: round2(g.closingCr),
    ledgerCount: g.ledgers.length,
    ledgers: g.ledgers,
  })).filter((g) => g.periodDebit > 0 || g.periodCredit > 0 || g.closingDebit > 0 || g.closingCredit > 0);

  return {
    company_id: targetCompanyId,
    company_name: company.name,
    period: {
      from_date: effectiveFrom || null,
      to_date: effectiveTo || null,
      fy: params.fy || params.financial_year || params.targetYear || null,
    },
    totals: {
      openingDebit: round2(grandTotalOpeningDr),
      openingCredit: round2(grandTotalOpeningCr),
      periodDebit: round2(grandTotalPeriodDr),
      periodCredit: round2(grandTotalPeriodCr),
      closingDebit: round2(grandTotalClosingDr),
      closingCredit: round2(grandTotalClosingCr),
      isBalanced: Math.abs(grandTotalClosingDr - grandTotalClosingCr) < 5,
      // High-level category reconciliation matching Dashboard Home
      categories: {
        revenue: round2(catSalesCr - catSalesDr),
        purchase: round2(catPurchDr - catPurchCr),
        expense: round2(catExpDr - catExpCr),
        receivables: round2(catDebtorCloseDr),
        netReceivables: round2(catDebtorCloseDr - catDebtorCloseCr),
        payables: round2(catCreditorCloseCr),
        netPayables: round2(catCreditorCloseCr - catCreditorCloseDr),
        bankBalance: round2(catBankCloseDr - catBankCloseCr),
        cashBalance: round2(catCashCloseDr - catCashCloseCr),
      },
    },
    groups,
  };
}

/**
 * 4. Financial Position & Accounting Ratios Service
 * Computes:
 * - Current Ratio, Quick Ratio, Cash Ratio, Debt-to-Equity
 * - Net Worth, Working Capital
 */
export async function getFinancialPositionReportService(params = {}) {
  const bs = await getBalanceSheetReportService(params);

  const currentAssets = bs.assets?.currentAssets?.total || 0;
  const currentLiabilities = bs.liabilities?.currentLiabilities?.total || 0;
  const closingStock = bs.assets?.currentAssets?.closingStock || 0;
  const cashAndBank = (bs.assets?.currentAssets?.cashInHand || 0) + (bs.assets?.currentAssets?.bankAccounts || 0);
  const totalAssets = bs.assets?.totalAssets || 0;
  const totalLiabilities = bs.liabilities?.totalLiabilitiesAndEquity || 0;
  const totalDebt = (bs.liabilities?.nonCurrentLiabilities?.securedLoans || 0) + (bs.liabilities?.nonCurrentLiabilities?.unsecuredLoans || 0);
  const netWorth = bs.liabilities?.equity?.totalEquity || (totalAssets - (currentLiabilities + totalDebt));

  const safeCurrentLiab = currentLiabilities > 0 ? currentLiabilities : 1;
  const safeNetWorth = netWorth > 0 ? netWorth : 1;

  const workingCapital = round2(currentAssets - currentLiabilities);
  const currentRatio = round2(currentAssets / safeCurrentLiab);
  const quickRatio = round2((currentAssets - closingStock) / safeCurrentLiab);
  const cashRatio = round2(cashAndBank / safeCurrentLiab);
  const debtToEquityRatio = round2(totalDebt / safeNetWorth);

  return {
    company_id: bs.company_id,
    company_name: bs.company_name,
    period: bs.period,
    kpis: {
      totalAssets: round2(totalAssets),
      totalLiabilities: round2(totalLiabilities),
      netWorth: round2(netWorth),
      workingCapital,
    },
    ratios: {
      currentRatio,
      quickRatio,
      cashRatio,
      debtToEquityRatio,
    },
    liquidity: {
      currentAssets,
      currentLiabilities,
      cashAndBank,
      closingStock,
    },
  };
}

/**
 * 5. GST Tax Summary Report Service
 * Computes Output GST, Input GST (ITC), and Net GST Liability / Credit
 */
export async function getGstSummaryReportService(params = {}) {
  const { companyId } = params;
  const company = await resolveCompanyDoc(companyId);
  const targetCompanyId = company._id;

  const { fromDate: effectiveFrom, toDate: effectiveTo } = resolveDateFilter(params);
  const buckets = await getCompanyLedgerBuckets(targetCompanyId);

  const dutiesIds = Array.from(buckets.dutiesAndTaxesLedgerIds).map((id) => new mongoose.Types.ObjectId(id));

  const matchFilter = {
    companyId: targetCompanyId,
    ledgerId: { $in: dutiesIds },
  };

  if (effectiveFrom || effectiveTo) {
    Object.assign(matchFilter, buildDateMatch(effectiveFrom, effectiveTo, "date"));
  }

  const postings = await LedgerPosting.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: "$ledgerName",
        totalDebit: { $sum: "$debit" },
        totalCredit: { $sum: "$credit" },
      },
    },
  ]);

  let totalOutputGst = 0; // Credit nature (collected on sales)
  let totalInputGst = 0;  // Debit nature (paid on purchases)
  let cgstOutput = 0, cgstInput = 0;
  let sgstOutput = 0, sgstInput = 0;
  let igstOutput = 0, igstInput = 0;
  let otherOutput = 0, otherInput = 0;

  const taxLedgers = [];

  for (const p of postings) {
    const name = (p._id || "").toUpperCase();
    const dr = (p.totalDebit || 0) / 100;
    const cr = (p.totalCredit || 0) / 100;

    totalOutputGst += cr;
    totalInputGst += dr;

    if (name.includes("CGST")) {
      cgstOutput += cr;
      cgstInput += dr;
    } else if (name.includes("SGST") || name.includes("UTGST")) {
      sgstOutput += cr;
      sgstInput += dr;
    } else if (name.includes("IGST")) {
      igstOutput += cr;
      igstInput += dr;
    } else {
      otherOutput += cr;
      otherInput += dr;
    }

    taxLedgers.push({
      ledgerName: p._id,
      inputGst: round2(dr),
      outputGst: round2(cr),
      netLiability: round2(cr - dr),
    });
  }

  const netPayable = round2(totalOutputGst - totalInputGst);
  const roundedOutput = round2(totalOutputGst);
  const roundedInput = round2(totalInputGst);
  const netTaxPayable = netPayable > 0 ? netPayable : 0;
  const itcBalance = netPayable < 0 ? Math.abs(netPayable) : 0;

  return {
    company_id: targetCompanyId,
    company_name: company.name,
    period: {
      from_date: effectiveFrom || null,
      to_date: effectiveTo || null,
      fy: params.fy || params.financial_year || params.targetYear || null,
    },
    total_output_tax: roundedOutput,
    total_itc: roundedInput,
    net_tax_payable: netTaxPayable,
    itc_balance: itcBalance,
    itc_efficiency: roundedOutput > 0 ? round2((roundedInput / roundedOutput) * 100) : 100.0,
    liability_breakup: [
      { label: "CGST Output", amount: round2(cgstOutput), value: round2(cgstOutput) },
      { label: "SGST / UTGST Output", amount: round2(sgstOutput), value: round2(sgstOutput) },
      { label: "IGST Output", amount: round2(igstOutput), value: round2(igstOutput) },
      { label: "Other Taxes", amount: round2(otherOutput), value: round2(otherOutput) },
    ],
    itc_rows: [
      { label: "CGST Input (ITC)", value: round2(cgstInput), type: "positive" },
      { label: "SGST Input (ITC)", value: round2(sgstInput), type: "positive" },
      { label: "IGST Input (ITC)", value: round2(igstInput), type: "positive" },
      { label: "Other Input (ITC)", value: round2(otherInput), type: "positive" },
    ],
    returns: [
      { name: "GSTR-1", title: "Outward Supplies", description: "Monthly sales & output tax liability" },
      { name: "GSTR-3B", title: "Monthly Summary Return", description: "Summary return & tax payment" },
    ],
    summary: {
      totalOutputGst: roundedOutput,
      totalInputGst: roundedInput,
      netGstPayable: netTaxPayable,
      itcBalance,
    },
    breakdown: {
      cgst: { output: round2(cgstOutput), input: round2(cgstInput), net: round2(cgstOutput - cgstInput) },
      sgst: { output: round2(sgstOutput), input: round2(sgstInput), net: round2(sgstOutput - sgstInput) },
      igst: { output: round2(igstOutput), input: round2(igstInput), net: round2(igstOutput - igstInput) },
      other: { output: round2(otherOutput), input: round2(otherInput), net: round2(otherOutput - otherInput) },
    },
    taxLedgers,
  };
}


