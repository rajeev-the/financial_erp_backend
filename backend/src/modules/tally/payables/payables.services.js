import mongoose from "mongoose";
import { resolveAccountingData } from "../accounting/accounting.resolver.js";
import LedgerBalanceDetails from "../ledger/ledgerBalanceDetails.schema.js";
import { ApiError } from "../../../utils/api-error.js";

/**
 * Utility: Round number to 2 decimal places
 */
const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

/**
 * Classify a ledger entry into debit or credit
 * In Tally:
 * - DEBIT: entry_type === "DEBIT" or (is_deemed_positive === false with positive amount)
 * - CREDIT: entry_type === "CREDIT" or (is_deemed_positive === true)
 */
export const classifyEntry = (entry) => {
  const rawAmount = Number(entry.amount) || 0;
  const absAmount = Math.abs(rawAmount);

  if (entry.entry_type === "DEBIT") return { side: "debit", amount: absAmount };
  if (entry.entry_type === "CREDIT") return { side: "credit", amount: absAmount };

  if (rawAmount < 0 || entry.is_deemed_positive === true) {
    return { side: "debit", amount: absAmount };
  } else {
    return { side: "credit", amount: absAmount };
  }
};

/**
 * Fetch baseline opening balances for vendor/creditor ledgers from LedgerBalanceDetails
 */
export const getCreditorBaselineBalances = async (companyId, ledgerIds, fromDate) => {
  if (!ledgerIds || ledgerIds.length === 0) {
    return { balanceMap: new Map(), baselineDate: null };
  }

  const query = {
    company_id: companyId,
    ledger_id: { $in: ledgerIds },
  };

  const balanceRecords = await LedgerBalanceDetails.find(query)
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
        // In Tally: Creditors are liabilities.
        // Credit (amount owed to vendor): rawOpening > 0
        // Debit (advance payment made to vendor): rawOpening < 0
        const isCredit = rawOpening > 0;
        const opening = isCredit ? Math.abs(rawOpening) : -Math.abs(rawOpening);
        balanceMap.set(idStr, opening);
      } else {
        balanceMap.set(idStr, 0);
      }
    }
  }

  return { balanceMap, baselineDate };
};

/**
 * Main Service: Calculate Payables Balance
 * Flow:
 * 1. Root Group: "Sundry Creditors" / "Sundry Creditor"
 * 2. Find Sub-Groups recursively
 * 3. Find Vendor Ledgers
 * 4. Get Ledger Entries & classify transactions (CREDIT: Purchases/Invoiced, DEBIT: Payment Made)
 * 5. Calculate Net Outstanding per vendor & total PAYABLE BALANCE
 */
export const calculatePayablesService = async ({
  companyId,
  from_date,
  to_date,
  party_name,
  ledger_id,
}) => {
  if (!companyId) {
    throw ApiError.badRequest("Company ID is required");
  }

  const targetCompanyId = mongoose.Types.ObjectId.isValid(companyId)
    ? new mongoose.Types.ObjectId(companyId)
    : companyId;

  // --------------------------------------------------
  // 1. Parse dates
  // --------------------------------------------------
  const fromDate = from_date ? new Date(from_date) : null;
  let toDate = null;
  if (to_date) {
    toDate = new Date(to_date);
    toDate.setHours(23, 59, 59, 999);
  }

  // --------------------------------------------------
  // 2. Resolve "Sundry Creditors", sub-groups, ledgers & entries
  // --------------------------------------------------
  const data = await resolveAccountingData({
    companyId: targetCompanyId,
    groupNames: ["Sundry Creditors"],
    fromDate,
    toDate,
  });

  let vendorLedgers = data.ledgers || [];

  // Optional filtering by party_name or ledger_id
  if (ledger_id) {
    vendorLedgers = vendorLedgers.filter(
      (l) => String(l._id) === String(ledger_id)
    );
  } else if (party_name) {
    const search = party_name.trim().toLowerCase();
    vendorLedgers = vendorLedgers.filter((l) =>
      l.name?.trim().toLowerCase().includes(search)
    );
  }

  const vendorLedgerIds = vendorLedgers.map((l) => l._id);

  if (vendorLedgerIds.length === 0) {
    return {
      group: "Sundry Creditors",
      company_id: targetCompanyId,
      period: {
        from_date: from_date || null,
        to_date: to_date || null,
      },
      total_payable: 0,
      total_amount: 0,
      amount: 0,
      closing_balance: 0,
      total_opening_balance: 0,
      total_debit: 0,
      total_credit: 0,
      total_vendors: 0,
      creditors_count: 0,
      vendors: [],
      customers: [],
      message: "No vendor ledgers found for this company under Sundry Creditors",
    };
  }

  // --------------------------------------------------
  // 3. Baseline opening balances & prior period adjustments
  // --------------------------------------------------
  const { balanceMap, baselineDate } = await getCreditorBaselineBalances(
    targetCompanyId,
    vendorLedgerIds,
    fromDate
  );

  let priorEntriesByLedger = new Map();
  if (fromDate && baselineDate && fromDate > baselineDate) {
    const priorToDate = new Date(fromDate.getTime() - 1);
    const priorData = await resolveAccountingData({
      companyId: targetCompanyId,
      groupNames: ["Sundry Creditors", "Sundry Creditor"],
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

  // --------------------------------------------------
  // 4. Group current period entries by vendor ledger
  // --------------------------------------------------
  const currentEntriesByLedger = new Map();
  for (const entry of data.entries || []) {
    const idStr = String(entry.ledger_id);
    if (!currentEntriesByLedger.has(idStr)) {
      currentEntriesByLedger.set(idStr, []);
    }
    currentEntriesByLedger.get(idStr).push(entry);
  }

  // --------------------------------------------------
  // 5. Classify transactions & calculate Net Outstanding per vendor
  // --------------------------------------------------
  const voucherMap = new Map();
  for (const v of data.vouchers || []) {
    voucherMap.set(String(v._id), v);
  }

  const vendors = [];
  let totalPeriodDebit = 0;
  let totalPeriodCredit = 0;
  let totalOpeningBalance = 0;
  let totalPayable = 0;

  for (const ledger of vendorLedgers) {
    const idStr = String(ledger._id);
    let effectiveOpening = balanceMap.get(idStr) || 0;

    // Adjust opening balance with prior period transactions if fromDate > baselineDate
    // For liabilities: Credit (Purchases) increases what we owe, Debit (Payments) decreases what we owe
    if (fromDate && baselineDate && fromDate > baselineDate && priorEntriesByLedger.has(idStr)) {
      const priorEntries = priorEntriesByLedger.get(idStr);
      for (const entry of priorEntries) {
        const { side, amount } = classifyEntry(entry);
        if (side === "credit") {
          effectiveOpening += amount;
        } else {
          effectiveOpening -= amount;
        }
      }
    }

    effectiveOpening = round2(effectiveOpening);

    // Current period transactions: classify into DEBIT and CREDIT
    let vendorDebit = 0;
    let vendorCredit = 0;
    const currentEntries = currentEntriesByLedger.get(idStr) || [];
    let latestVoucherDate = null;

    for (const entry of currentEntries) {
      const { side, amount } = classifyEntry(entry);
      if (side === "debit") {
        vendorDebit += amount;
      } else {
        vendorCredit += amount;
      }

      if (entry.voucher_id) {
        const v = voucherMap.get(String(entry.voucher_id));
        if (v && v.date) {
          const d = new Date(v.date);
          if (!isNaN(d.getTime())) {
            if (!latestVoucherDate || d > latestVoucherDate) {
              latestVoucherDate = d;
            }
          }
        }
      }
    }

    vendorDebit = round2(vendorDebit);
    vendorCredit = round2(vendorCredit);

    // Net Outstanding for Creditors: Opening (Credit) + Credit (Purchases) - Debit (Payments)
    const netOutstanding = round2(effectiveOpening + vendorCredit - vendorDebit);

    // Status classification
    let status = "cleared";
    if (netOutstanding > 0) {
      status = "pending"; // We owe vendor money (Payable)
    } else if (netOutstanding < 0) {
      status = "advance"; // We paid vendor in advance
    }

    // Accumulate summary metrics
    totalOpeningBalance += effectiveOpening;
    totalPeriodDebit += vendorDebit;
    totalPeriodCredit += vendorCredit;

    // Payable balance is the positive amount owed to vendors
    if (netOutstanding > 0) {
      totalPayable += netOutstanding;
    }

    let overdueDays = 0;
    if (netOutstanding > 0 && latestVoucherDate) {
      const diffTime = Date.now() - latestVoucherDate.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays > 0) overdueDays = diffDays;
    }

    const formattedDate = latestVoucherDate
      ? latestVoucherDate.toISOString().split("T")[0]
      : "N/A";
    const finalAmount = netOutstanding > 0 ? netOutstanding : Math.abs(netOutstanding);

    vendors.push({
      id: ledger._id,
      ledger_id: ledger._id,
      party_name: ledger.name,
      parent_group: ledger.parent || "Sundry Creditors",
      group_name: ledger.parent || "Sundry Creditors",
      group_id: ledger.group_id,
      amount: finalAmount,
      total_balance: finalAmount,
      total_closing_amount: finalAmount,
      opening_balance: effectiveOpening,
      total_debit: vendorDebit, // Payments Made to Vendor
      total_credit: vendorCredit, // Purchases / Invoiced Amount
      net_change: round2(vendorDebit - vendorCredit),
      closing_balance: netOutstanding,
      net_outstanding: netOutstanding > 0 ? netOutstanding : 0,
      status,
      transactions_count: currentEntries.length,
      bill_count: currentEntries.length || 1,
      total_number_of_bills: currentEntries.length || 1,
      due_date: formattedDate,
      bill_due: formattedDate,
      bill_date: formattedDate,
      latest_bill_date: formattedDate,
      overdue_days: overdueDays,
    });
  }

  // --------------------------------------------------
  // 6. Sort vendors: highest outstanding first
  // --------------------------------------------------
  vendors.sort((a, b) => b.closing_balance - a.closing_balance);

  totalPayable = round2(totalPayable);
  totalPeriodDebit = round2(totalPeriodDebit);
  totalPeriodCredit = round2(totalPeriodCredit);
  totalOpeningBalance = round2(totalOpeningBalance);
  const totalClosingBalance = round2(
    totalOpeningBalance + totalPeriodCredit - totalPeriodDebit
  );

  const creditorsCount = vendors.filter((v) => v.status === "pending").length;

  return {
    group: "Sundry Creditors",
    company_id: targetCompanyId,
    period: {
      from_date: from_date || null,
      to_date: to_date || null,
    },
    total_payable: totalPayable,
    closing_balance: totalClosingBalance,
    amount: totalPayable,
    total_amount: totalPayable,
    total_opening_balance: totalOpeningBalance,
    total_debit: totalPeriodDebit, // Total Payments Made to Vendors
    total_credit: totalPeriodCredit, // Total Purchases / Invoiced Amount
    total_vendors: vendors.length,
    creditors_count: creditorsCount,
    groups_count: data.groups.length,
    vouchers_count: data.vouchers.length,
    vendors,
    parties: vendors,
    data: vendors,
    payables: vendors,
    total_parties: vendors.length,
    // Aliases for compatibility
    customers: vendors,
    total_customers: vendors.length,
    debtors_count: creditorsCount,
  };
};

// Also export alias as calculateReceivablesService for compatibility if invoked generically
export const calculateReceivablesService = calculatePayablesService;

export default {
  calculatePayablesService,
  calculateReceivablesService,
  classifyEntry,
  getCreditorBaselineBalances,
};
