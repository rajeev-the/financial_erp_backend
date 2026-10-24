/**
 * Pure Calculation Engine for Financial Statements:
 * - Profit & Loss (Trading & PnL)
 * - Balance Sheet (Assets & Liabilities)
 * - Financial Position & Accounting Ratios
 * 
 * Rules: Pure functions only. No database calls, no network I/O, no side effects.
 */

const round = (num) => Math.round((Number(num) || 0) * 100) / 100;

/**
 * Calculates Profit & Loss statement from bucketed accounting figures.
 */
export function calculateProfitAndLoss({
  sales = 0,
  purchases = 0,
  directExpenses = 0,
  indirectExpenses = 0,
  directIncomes = 0,
  indirectIncomes = 0,
  openingStock = 0,
  closingStock = 0,
  salesBreakdown = [],
  purchasesBreakdown = [],
  directExpensesBreakdown = [],
  indirectExpensesBreakdown = [],
  incomesBreakdown = [],
}) {
  const roundedSales = round(sales);
  const roundedPurchases = round(purchases);
  const roundedDirectExpenses = round(directExpenses);
  const roundedIndirectExpenses = round(indirectExpenses);
  const roundedDirectIncomes = round(directIncomes);
  const roundedIndirectIncomes = round(indirectIncomes);
  const roundedOpeningStock = round(openingStock);
  const roundedClosingStock = round(closingStock);

  // Trading Account: Cost of Goods Sold
  // COGS = Opening Stock + Purchases + Direct Expenses - Closing Stock
  const cogs = round(
    roundedOpeningStock + roundedPurchases + roundedDirectExpenses - roundedClosingStock
  );

  // Gross Profit = Sales + Direct Incomes - COGS
  const grossProfit = round(roundedSales + roundedDirectIncomes - cogs);
  const grossProfitMargin = roundedSales > 0 ? round((grossProfit / roundedSales) * 100) : 0;

  // Total Income & Expenses
  const totalIncome = round(roundedSales + roundedDirectIncomes + roundedIndirectIncomes);
  const totalExpenses = round(
    roundedPurchases + roundedDirectExpenses + roundedIndirectExpenses + (roundedOpeningStock - roundedClosingStock)
  );

  // Net Profit = Gross Profit + Indirect Incomes - Indirect Expenses
  const netProfit = round(grossProfit + roundedIndirectIncomes - roundedIndirectExpenses);
  const netProfitMargin = roundedSales > 0 ? round((netProfit / roundedSales) * 100) : 0;

  return {
    trading: {
      revenueFromOperations: roundedSales,
      costOfGoodsSold: Math.max(0, cogs),
      openingStock: roundedOpeningStock,
      purchases: roundedPurchases,
      directExpenses: roundedDirectExpenses,
      closingStock: roundedClosingStock,
      directIncomes: roundedDirectIncomes,
      grossProfit,
      grossProfitMargin,
      isGrossProfitPositive: grossProfit >= 0,
    },
    operating: {
      indirectExpenses: roundedIndirectExpenses,
      indirectIncomes: roundedIndirectIncomes,
      operatingProfit: round(grossProfit - roundedIndirectExpenses),
    },
    summary: {
      totalRevenue: totalIncome,
      totalExpenses,
      netProfit,
      netProfitMargin,
      isNetProfitPositive: netProfit >= 0,
    },
    breakdown: {
      sales: salesBreakdown,
      purchases: purchasesBreakdown,
      directExpenses: directExpensesBreakdown,
      indirectExpenses: indirectExpensesBreakdown,
      incomes: incomesBreakdown,
    },
  };
}

/**
 * Calculates Balance Sheet statement from bucketed assets, liabilities, and net profit.
 */
export function calculateBalanceSheet({
  capitalAccount = 0,
  reservesAndSurplus = 0,
  netProfit = 0,
  securedLoans = 0,
  unsecuredLoans = 0,
  sundryCreditors = 0,
  dutiesAndTaxes = 0,
  provisions = 0,
  bankOverdraft = 0,
  otherCurrentLiabilities = 0,
  fixedAssets = 0,
  investments = 0,
  closingStock = 0,
  sundryDebtors = 0,
  cashInHand = 0,
  bankAccounts = 0,
  loansAndAdvancesAsset = 0,
  otherCurrentAssets = 0,
  liabilitiesBreakdown = [],
  assetsBreakdown = [],
}) {
  // 1. Equity / Capital
  const totalEquity = round(capitalAccount + reservesAndSurplus + netProfit);

  // 2. Non-Current Liabilities
  const totalNonCurrentLiabilities = round(securedLoans + unsecuredLoans);

  // 3. Current Liabilities
  const totalCurrentLiabilities = round(
    sundryCreditors + dutiesAndTaxes + provisions + bankOverdraft + otherCurrentLiabilities
  );

  // Total Liabilities & Equity
  const totalLiabilitiesAndEquity = round(
    totalEquity + totalNonCurrentLiabilities + totalCurrentLiabilities
  );

  // 4. Non-Current Assets
  const totalNonCurrentAssets = round(fixedAssets + investments);

  // 5. Current Assets
  const totalCurrentAssets = round(
    closingStock + sundryDebtors + cashInHand + bankAccounts + loansAndAdvancesAsset + otherCurrentAssets
  );

  // Total Assets
  const totalAssets = round(totalNonCurrentAssets + totalCurrentAssets);

  // Check balance difference
  const difference = round(totalAssets - totalLiabilitiesAndEquity);

  return {
    liabilities: {
      equity: {
        capitalAccount: round(capitalAccount),
        reservesAndSurplus: round(reservesAndSurplus),
        netProfit: round(netProfit),
        totalEquity,
      },
      nonCurrentLiabilities: {
        securedLoans: round(securedLoans),
        unsecuredLoans: round(unsecuredLoans),
        total: totalNonCurrentLiabilities,
      },
      currentLiabilities: {
        sundryCreditors: round(sundryCreditors),
        dutiesAndTaxes: round(dutiesAndTaxes),
        provisions: round(provisions),
        bankOverdraft: round(bankOverdraft),
        others: round(otherCurrentLiabilities),
        total: totalCurrentLiabilities,
      },
      totalLiabilitiesAndEquity,
    },
    assets: {
      nonCurrentAssets: {
        fixedAssets: round(fixedAssets),
        investments: round(investments),
        total: totalNonCurrentAssets,
      },
      currentAssets: {
        closingStock: round(closingStock),
        sundryDebtors: round(sundryDebtors),
        cashInHand: round(cashInHand),
        bankAccounts: round(bankAccounts),
        loansAndAdvances: round(loansAndAdvancesAsset),
        others: round(otherCurrentAssets),
        total: totalCurrentAssets,
      },
      totalAssets,
    },
    check: {
      isBalanced: Math.abs(difference) < 1.0,
      difference,
    },
    breakdown: {
      liabilities: liabilitiesBreakdown,
      assets: assetsBreakdown,
    },
  };
}

/**
 * Calculates Financial Position and Liquidity Ratios.
 */
export function calculateFinancialPosition({
  totalAssets = 0,
  totalLiabilities = 0,
  netWorth = 0,
  currentAssets = 0,
  currentLiabilities = 0,
  closingStock = 0,
  cashAndBank = 0,
  totalDebt = 0,
}) {
  const safeCurrentLiab = currentLiabilities > 0 ? currentLiabilities : 1;
  const safeNetWorth = netWorth > 0 ? netWorth : 1;

  const workingCapital = round(currentAssets - currentLiabilities);
  const currentRatio = round(currentAssets / safeCurrentLiab);
  const quickRatio = round((currentAssets - closingStock) / safeCurrentLiab);
  const cashRatio = round(cashAndBank / safeCurrentLiab);
  const debtToEquityRatio = round(totalDebt / safeNetWorth);

  return {
    kpis: {
      totalAssets: round(totalAssets),
      totalLiabilities: round(totalLiabilities),
      netWorth: round(netWorth),
      workingCapital,
    },
    ratios: {
      currentRatio,
      quickRatio,
      cashRatio,
      debtToEquityRatio,
    },
  };
}
