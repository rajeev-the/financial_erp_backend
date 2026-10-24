import mongoose from "mongoose";
import { resolveAccountingData } from "../accounting/accounting.resolver.js";
import LedgerBalanceDetails from "../ledger/ledgerBalanceDetails.schema.js";
import { ApiError } from "../../../utils/api-error.js";

/**
 * Utility: Round a number to 2 decimal places
 */
const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

/**
 * Calculates total Debit (DR), Credit (CR), and net change for cash entries.
 * In Tally XML for Cash (Asset):
 * - Receipts (DR): amount < 0 or entry_type === "DEBIT"
 * - Payments (CR): amount > 0 or entry_type === "CREDIT"
 */
export const calculateCashTotals = (entries = []) => {
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
 * Retrieves baseline opening balance for cash ledgers from LedgerBalanceDetails.
 */
export const getBaselineOpeningBalance = async (companyId, ledgerIds) => {
  if (!ledgerIds || ledgerIds.length === 0) {
    return { openingBalance: 0, baselineDate: null };
  }

  const balanceRecords = await LedgerBalanceDetails.find({
    company_id: companyId,
    ledger_id: { $in: ledgerIds },
  })
    .sort({ from_date: 1 })
    .lean();

  if (balanceRecords.length > 0) {
    const earliestDate = balanceRecords[0].from_date;
    const recordsAtEarliestDate = balanceRecords.filter(
      (b) => String(b.from_date) === String(earliestDate)
    );

    const totalOpening = recordsAtEarliestDate.reduce(
      (sum, b) => sum + Math.abs(Number(b.opening_balance) || 0),
      0
    );

    return {
      openingBalance: round2(totalOpening),
      baselineDate: earliestDate,
    };
  }

  return { openingBalance: 0, baselineDate: null };
};

/**
 * Main Service: Calculates cash balance using resolveAccountingData from accounting module
 * Formula: Closing Balance = Opening Balance + Total DR - Total CR
 */
export const calculateCashBalanceService = async ({
  companyId,
  from_date,
  to_date,
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

  // 1. Resolve accounting data for "Cash-in-Hand" using accounting resolver
  const data = await resolveAccountingData({
    companyId: targetCompanyId,
    groupNames: ["Cash-in-Hand"],
    fromDate,
    toDate,
  });

  const ledgerIds = (data.ledgers || []).map((l) => l._id);

  if (ledgerIds.length === 0) {
    return {
      group: "Cash-in-Hand",
      opening_balance: 0,
      total_debit: 0,
      total_credit: 0,
      net_change: 0,
      closing_balance: 0,
      amount: 0,
      total_amount: 0,
      ledgers_count: 0,
      ledgers: [],
      message: "No cash ledgers found for this company",
    };
  }

  // 2. Baseline opening balance from ledger balance records
  const { openingBalance: baselineOpening, baselineDate } =
    await getBaselineOpeningBalance(targetCompanyId, ledgerIds);

  // 3. Calculate effective Opening Balance as of fromDate:
  // If fromDate is after baselineDate, add prior net transactions [baselineDate, fromDate - 1ms]
  let effectiveOpening = baselineOpening;
  if (fromDate && baselineDate && fromDate > baselineDate) {
    const priorToDate = new Date(fromDate.getTime() - 1);
    const priorData = await resolveAccountingData({
      companyId: targetCompanyId,
      groupNames: ["Cash-in-Hand"],
      fromDate: baselineDate,
      toDate: priorToDate,
    });

    const priorTotals = calculateCashTotals(priorData.entries);
    effectiveOpening = round2(baselineOpening + priorTotals.netChange);
  }

  // 4. Calculate period transactions [fromDate, toDate]
  const { totalDebit, totalCredit, netChange } = calculateCashTotals(data.entries);

  // 5. Final Formula: Opening + DR - CR
  const closingBalance = round2(effectiveOpening + netChange);

  return {
    group: "Cash-in-Hand",
    company_id: targetCompanyId,
    period: {
      from_date: from_date || null,
      to_date: to_date || null,
    },
    opening_balance: effectiveOpening,
    total_debit: totalDebit,
    total_credit: totalCredit,
    net_change: netChange,
    closing_balance: closingBalance,
    amount: closingBalance,
    total_amount: closingBalance,
    vouchers_count: data.vouchers.length,
    ledger_entries_count: data.entries.length,
    ledgers_count: data.ledgers.length,
    ledgers: data.ledgers.map((l) => ({
      _id: l._id,
      name: l.name,
      parent: l.parent,
    })),
  };
};

export default {
  calculateCashBalanceService,
  calculateCashTotals,
  getBaselineOpeningBalance,
};
