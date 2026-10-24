import mongoose from "mongoose";
import { resolveAccountingData } from "../accounting/accounting.resolver.js";
import LedgerBalanceDetails from "../ledger/ledgerBalanceDetails.schema.js";
import { ApiError } from "../../../utils/api-error.js";

/**
 * Utility: Round a number to 2 decimal places
 */
const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

/**
 * Calculates total Debit (DR), Credit (CR), and net change for a given list of bank ledger entries.
 * In Tally XML for Bank (Asset):
 * - Deposits / Receipts (DR): amount < 0 or entry_type === "DEBIT"
 * - Withdrawals / Payments (CR): amount > 0 or entry_type === "CREDIT"
 */
export const calculateBankTotals = (entries = []) => {
  let totalDebit = 0;
  let totalCredit = 0;

  for (const entry of entries) {
    const rawAmount = Number(entry.amount) || 0;
    if (!rawAmount) continue;

    const isDebit =
      entry.entry_type === "DEBIT" ||
      (entry.entry_type !== "CREDIT" && rawAmount < 0);

    const absAmount = Math.abs(rawAmount);

    if (isDebit) {
      totalDebit += absAmount;
    } else {
      totalCredit += absAmount;
    }
  }

  totalDebit = round2(totalDebit);
  totalCredit = round2(totalCredit);
  const netChange = round2(totalDebit - totalCredit);

  return {
    totalDebit,
    totalCredit,
    netChange,
  };
};

/**
 * Retrieves baseline opening balance for each bank ledger from LedgerBalanceDetails.
 * If fromDate is specified, finds the latest baseline period starting on or before fromDate.
 * Returns { balanceMap, baselineDate }
 */
export const getBankBaselineBalances = async (companyId, ledgerIds, fromDate) => {
  if (!ledgerIds || ledgerIds.length === 0) {
    return { balanceMap: new Map(), baselineDate: null };
  }

  const balanceRecords = await LedgerBalanceDetails.find({
    company_id: companyId,
    ledger_id: { $in: ledgerIds },
  })
    .sort({ from_date: 1 })
    .lean();

  if (!balanceRecords || balanceRecords.length === 0) {
    return { balanceMap: new Map(), baselineDate: null };
  }

  // Determine baseline date:
  // If fromDate is specified, find the latest baseline period that starts on or before fromDate.
  // Otherwise, use the earliest recorded baseline period.
  let baselineDate = balanceRecords[0].from_date ? new Date(balanceRecords[0].from_date) : null;

  if (fromDate) {
    const eligibleRecords = balanceRecords.filter(
      (r) => r.from_date && new Date(r.from_date) <= fromDate
    );
    if (eligibleRecords.length > 0) {
      eligibleRecords.sort(
        (a, b) => new Date(b.from_date).getTime() - new Date(a.from_date).getTime()
      );
      baselineDate = new Date(eligibleRecords[0].from_date);
    }
  }

  const balanceMap = new Map();

  for (const record of balanceRecords) {
    const recDate = record.from_date ? new Date(record.from_date) : null;
    if (
      baselineDate &&
      recDate &&
      recDate.getTime() === baselineDate.getTime()
    ) {
      const idStr = String(record.ledger_id);
      const rawOpening = Number(record.opening_balance) || 0;
      if (rawOpening !== 0) {
        // In Tally: Bank accounts are Assets
        // Debit (positive bank balance): rawOpening < 0 or is_deemed_positive === true
        // Credit (bank overdraft / CC / OD): rawOpening > 0
        const isDebit = rawOpening < 0;
        const opening = isDebit ? Math.abs(rawOpening) : -Math.abs(rawOpening);
        balanceMap.set(idStr, opening);
      } else {
        balanceMap.set(idStr, 0);
      }
    }
  }

  return { balanceMap, baselineDate };
};

/**
 * Main Service: Calculates bank balance per ledger and in aggregate
 * Formula per bank: Closing Balance = Opening Balance + Total DR - Total CR
 */
export const calculateBankBalanceService = async ({
  companyId,
  from_date,
  to_date,
  ledger_id,
  ledger_name,
}) => {
  const targetCompanyId = mongoose.Types.ObjectId.isValid(companyId)
    ? new mongoose.Types.ObjectId(companyId)
    : companyId;

  // Parse dates
  const fromDate = from_date ? new Date(from_date) : null;
  let toDate = null;
  if (to_date) {
    toDate = new Date(to_date);
    toDate.setHours(23, 59, 59, 999);
  }

  // 1. Resolve accounting data for "Bank Accounts" group using accounting resolver
  const data = await resolveAccountingData({
    companyId: targetCompanyId,
    groupNames: ["Bank Accounts"],
    fromDate,
    toDate,
  });

  let targetLedgers = data.ledgers || [];

  // Filter by specific ledger if requested
  if (ledger_id) {
    targetLedgers = targetLedgers.filter(
      (l) => String(l._id) === String(ledger_id)
    );
  } else if (ledger_name) {
    const searchName = ledger_name.trim().toLowerCase();
    targetLedgers = targetLedgers.filter(
      (l) => l.name?.trim().toLowerCase() === searchName
    );
  }

  const targetLedgerIds = targetLedgers.map((l) => l._id);

  if (targetLedgerIds.length === 0) {
    return {
      group: "Bank Accounts",
      opening_balance: 0,
      total_debit: 0,
      total_credit: 0,
      net_change: 0,
      closing_balance: 0,
      amount: 0,
      total_amount: 0,
      banks_count: 0,
      banks: [],
      message: "No bank ledgers found for this company",
    };
  }

  // 2. Fetch baseline opening balances for all target bank ledgers
  const { balanceMap, baselineDate } = await getBankBaselineBalances(
    targetCompanyId,
    targetLedgerIds,
    fromDate
  );

  // 3. Pre-fetch prior entries if fromDate is strictly after baselineDate to adjust opening balances
  let priorEntriesByLedger = new Map();
  if (fromDate && baselineDate && fromDate > baselineDate) {
    const priorToDate = new Date(fromDate.getTime() - 1);
    const priorData = await resolveAccountingData({
      companyId: targetCompanyId,
      groupNames: ["Bank Accounts"],
      fromDate: baselineDate,
      toDate: priorToDate,
    });

    for (const entry of priorData.entries || []) {
      const idStr = String(entry.ledger_id);
      if (!priorEntriesByLedger.has(idStr)) {
        priorEntriesByLedger.set(idStr, []);
      }
      priorEntriesByLedger.get(idStr).push(entry);
    }
  }

  // 4. Group current period entries by ledger
  const currentEntriesByLedger = new Map();
  for (const entry of data.entries || []) {
    const idStr = String(entry.ledger_id);
    if (!currentEntriesByLedger.has(idStr)) {
      currentEntriesByLedger.set(idStr, []);
    }
    currentEntriesByLedger.get(idStr).push(entry);
  }

  // 5. Calculate metrics for each bank ledger
  const bankBreakdown = [];
  let aggregateOpening = 0;
  let aggregateDebit = 0;
  let aggregateCredit = 0;

  for (const ledger of targetLedgers) {
    const idStr = String(ledger._id);
    let effectiveOpening = balanceMap.get(idStr) || 0;

    // If fromDate is given and falls after baselineDate, add prior period net change
    if (fromDate && baselineDate && fromDate > baselineDate && priorEntriesByLedger.has(idStr)) {
      const priorEntries = priorEntriesByLedger.get(idStr) || [];
      const priorTotals = calculateBankTotals(priorEntries);
      effectiveOpening = round2(effectiveOpening + priorTotals.netChange);
    }

    effectiveOpening = round2(effectiveOpening);

    const currentEntries = currentEntriesByLedger.get(idStr) || [];
    const { totalDebit, totalCredit, netChange } = calculateBankTotals(currentEntries);
    const closingBalance = round2(effectiveOpening + netChange);

    aggregateOpening += effectiveOpening;
    aggregateDebit += totalDebit;
    aggregateCredit += totalCredit;

    bankBreakdown.push({
      ledger_id: ledger._id,
      ledger_name: ledger.name,
      parent: ledger.parent,
      opening_balance: effectiveOpening,
      total_debit: totalDebit,
      total_credit: totalCredit,
      net_change: netChange,
      closing_balance: closingBalance,
      entries_count: currentEntries.length,
    });
  }

  aggregateOpening = round2(aggregateOpening);
  aggregateDebit = round2(aggregateDebit);
  aggregateCredit = round2(aggregateCredit);
  const aggregateNetChange = round2(aggregateDebit - aggregateCredit);
  const aggregateClosing = round2(aggregateOpening + aggregateNetChange);

  return {
    group: "Bank Accounts",
    company_id: targetCompanyId,
    period: {
      from_date: from_date || null,
      to_date: to_date || null,
    },
    opening_balance: aggregateOpening,
    total_debit: aggregateDebit,
    total_credit: aggregateCredit,
    net_change: aggregateNetChange,
    closing_balance: aggregateClosing,
    amount: aggregateClosing,
    total_amount: aggregateClosing,
    banks_count: bankBreakdown.length,
    banks: bankBreakdown,
    vouchers_count: data.vouchers.length,
    ledger_entries_count: data.entries.length,
  };
};

export default {
  calculateBankBalanceService,
  calculateBankTotals,
  getBankBaselineBalances,
};
