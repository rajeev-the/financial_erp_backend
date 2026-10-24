import mongoose from "mongoose";
import { resolveAccountingData } from "../accounting/accounting.resolver.js";
import { ACCOUNTING_CONFIG } from "../accounting/accounting.config.js";
import LedgerBalanceDetails from "../ledger/ledgerBalanceDetails.schema.js";
import Company from "../../companies/company.schema.js";
import { ApiError } from "../../../utils/api-error.js";
import { ok } from "../../../utils/response.js";

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

  // In Tally XML for Sundry Debtors (Asset account):
  // - Debit (Sales / Invoices): amount < 0 or is_deemed_positive === true
  // - Credit (Receipts / Payments / TDS): amount > 0 or is_deemed_positive === false
  if (rawAmount < 0 || entry.is_deemed_positive === true) {
    return { side: "debit", amount: absAmount };
  } else {
    return { side: "credit", amount: absAmount };
  }
};

/**
 * Fetch baseline opening balances for customer ledgers from LedgerBalanceDetails
 */
export const getDebtorBaselineBalances = async (companyId, ledgerIds, fromDate) => {
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
        // In Tally: Debtors are assets.
        // Debit (positive receivable) has rawOpening < 0 or is_deemed_positive === true
        // Credit (advance payment received) has rawOpening > 0 or is_deemed_positive === false
        const isDebit = rawOpening < 0 || record.is_deemed_positive === true;
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
 * Main Service: Calculate Receivables Balance
 * Flow:
 * 1. Root Group: "Sundry Debtors"
 * 2. Find Sub-Groups recursively
 * 3. Find Customer Ledgers
 * 4. Get Ledger Entries & classify transactions (DEBIT: Sales/Invoiced, CREDIT: Payment Received)
 * 5. Calculate Net Outstanding per customer & total RECEIVABLE BALANCE
 */


export const calculateReceivablesService = async ({
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
  // 2. Resolve "Sundry Debtors", sub-groups, ledgers & entries
  // --------------------------------------------------
  const data = await resolveAccountingData({
    companyId: targetCompanyId,
    groupNames: ["Sundry Debtors"],
    fromDate,
    toDate,
  });

  let customerLedgers = data.ledgers || [];

  // Optional filtering by party_name or ledger_id
  if (ledger_id) {
    customerLedgers = customerLedgers.filter(
      (l) => String(l._id) === String(ledger_id)
    );
  } else if (party_name) {
    const search = party_name.trim().toLowerCase();
    customerLedgers = customerLedgers.filter((l) =>
      l.name?.trim().toLowerCase().includes(search)
    );
  }

  const customerLedgerIds = customerLedgers.map((l) => l._id);

  if (customerLedgerIds.length === 0) {
    return {
      group: "Sundry Debtors",
      company_id: targetCompanyId,
      period: {
        from_date: from_date || null,
        to_date: to_date || null,
      },
      total_receivable: 0,
      total_amount: 0,
      amount: 0,
      total_debit: 0,
      total_credit: 0,
      total_customers: 0,
      debtors_count: 0,
      customers: [],
      message: "No customer ledgers found for this company under Sundry Debtors",
    };
  }

  // --------------------------------------------------
  // 3. Baseline opening balances & prior period adjustments
  // --------------------------------------------------
  const { balanceMap, baselineDate } = await getDebtorBaselineBalances(
    targetCompanyId,
    customerLedgerIds,
    fromDate
  );

  let priorEntriesByLedger = new Map();
  if (fromDate && baselineDate && fromDate > baselineDate) {
    const priorToDate = new Date(fromDate.getTime() - 1);
    const priorData = await resolveAccountingData({
      companyId: targetCompanyId,
      groupNames: ["Sundry Debtors"],
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
  // 4. Group current period entries by customer ledger
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
  // 5. Classify transactions & calculate Net Outstanding per customer
  // --------------------------------------------------
  const customers = [];
  let totalPeriodDebit = 0;
  let totalPeriodCredit = 0;
  let totalOpeningBalance = 0;
  let totalReceivable = 0;

  for (const ledger of customerLedgers) {
    const idStr = String(ledger._id);
    let effectiveOpening = balanceMap.get(idStr) || 0;

    // Adjust opening balance with prior period transactions if fromDate > baselineDate
    if (fromDate && baselineDate && fromDate > baselineDate && priorEntriesByLedger.has(idStr)) {
      const priorEntries = priorEntriesByLedger.get(idStr);
      for (const entry of priorEntries) {
        const { side, amount } = classifyEntry(entry);
        if (side === "debit") {
          effectiveOpening += amount;
        } else {
          effectiveOpening -= amount;
        }
      }
    }

    effectiveOpening = round2(effectiveOpening);

    // Current period transactions: classify into DEBIT and CREDIT
    let customerDebit = 0;
    let customerCredit = 0;
    const currentEntries = currentEntriesByLedger.get(idStr) || [];

    for (const entry of currentEntries) {
      const { side, amount } = classifyEntry(entry);
      if (side === "debit") {
        customerDebit += amount;
      } else {
        customerCredit += amount;
      }
    }

    customerDebit = round2(customerDebit);
    customerCredit = round2(customerCredit);

    // Net Outstanding: Opening + Debit (Sales) - Credit (Receipts)
    const netOutstanding = round2(effectiveOpening + customerDebit - customerCredit);

    // Status classification
    let status = "cleared";
    if (netOutstanding > 0) {
      status = "pending"; // Customer owes money (Receivable)
    } else if (netOutstanding < 0) {
      status = "advance"; // Customer paid in advance
    }

    // Accumulate summary metrics
    totalOpeningBalance += effectiveOpening;
    totalPeriodDebit += customerDebit;
    totalPeriodCredit += customerCredit;

    // Receivable balance is the positive amount owed by customers
    if (netOutstanding > 0) {
      totalReceivable += netOutstanding;
    }

    customers.push({
      ledger_id: ledger._id,
      party_name: ledger.name,
      parent_group: ledger.parent || "Sundry Debtors",
      group_id: ledger.group_id,
      opening_balance: effectiveOpening,
      total_debit: customerDebit, // Sales / Invoiced Amount
      total_credit: customerCredit, // Payments Received
      net_change: round2(customerDebit - customerCredit),
      closing_balance: netOutstanding,
      net_outstanding: netOutstanding > 0 ? netOutstanding : 0,
      status,
      transactions_count: currentEntries.length,
    });
  }

  // --------------------------------------------------
  // 6. Sort customers: highest outstanding first
  // --------------------------------------------------
  customers.sort((a, b) => b.closing_balance - a.closing_balance);

  totalReceivable = round2(totalReceivable);
  totalPeriodDebit = round2(totalPeriodDebit);
  totalPeriodCredit = round2(totalPeriodCredit);
  totalOpeningBalance = round2(totalOpeningBalance);
  const totalClosingBalance = round2(
    totalOpeningBalance + totalPeriodDebit - totalPeriodCredit
  );

  const debtorsCount = customers.filter((c) => c.status === "pending").length;

  return {
    group: "Sundry Debtors",
    company_id: targetCompanyId,
    period: {
      from_date: from_date || null,
      to_date: to_date || null,
    },
    total_receivable: totalReceivable,
    closing_balance: totalClosingBalance,
    amount: totalReceivable,
    total_amount: totalReceivable,
    total_opening_balance: totalOpeningBalance,
    total_debit: totalPeriodDebit, // Total Sales / Invoiced Amount
    total_credit: totalPeriodCredit, // Total Payments Received
    total_customers: customers.length,
    debtors_count: debtorsCount,
    groups_count: data.groups.length,
    vouchers_count: data.vouchers.length,
    customers,
  };
};


/**
 * Pure Calculation Service: Receivables Grouped by Party
 * Utilizes ACCOUNTING_CONFIG.receivable:
 * {
 *   type: "outstanding",
 *   groups: ["Sundry Debtors"],
 *   normal_side: "debit",
 * }
 */
export const calculateReceivablesByPartyService = async ({
  companyId,
  from_date,
  to_date,
  party_name,
  status,
  page,
  limit,
}) => {
  if (!companyId) {
    throw ApiError.badRequest("Company ID is required");
  }

  // 1. Resolve Company ID (supports ObjectId, tally_company_guid, or company name)
  let targetCompanyId = null;
  if (mongoose.Types.ObjectId.isValid(companyId)) {
    targetCompanyId = new mongoose.Types.ObjectId(companyId);
  } else {
    const compDoc = await Company.findOne({
      $or: [{ tally_company_guid: companyId }, { name: companyId }],
      is_deleted: { $ne: true },
    }).select("_id");
    if (compDoc) {
      targetCompanyId = compDoc._id;
    }
  }

  if (!targetCompanyId) {
    throw ApiError.notFound("Company not found or invalid Company ID");
  }

  // 2. Read configuration from ACCOUNTING_CONFIG
  const config = ACCOUNTING_CONFIG.receivable || {
    type: "outstanding",
    groups: ["Sundry Debtors"],
    normal_side: "debit",
  };
  const groupNames = config.groups || ["Sundry Debtors"];
  const normalSide = config.normal_side || "debit";

  // 3. Parse dates
  const fromDate = from_date ? new Date(from_date) : null;
  let toDate = null;
  if (to_date) {
    toDate = new Date(to_date);
    toDate.setHours(23, 59, 59, 999);
  }

  // 4. Resolve "Sundry Debtors", child groups, ledgers, and transactions
  const data = await resolveAccountingData({
    companyId: targetCompanyId,
    groupNames,
    fromDate,
    toDate,
  });

  let customerLedgers = data.ledgers || [];
  if (party_name && party_name.trim()) {
    const search = party_name.trim().toLowerCase();
    customerLedgers = customerLedgers.filter((l) =>
      l.name?.trim().toLowerCase().includes(search)
    );
  }

  const customerLedgerIds = customerLedgers.map((l) => l._id);

  if (customerLedgerIds.length === 0) {
    return {
      accounting_config: {
        requirement: "receivable",
        type: config.type,
        groups: groupNames,
        normal_side: normalSide,
      },
      company_id: targetCompanyId,
      period: {
        from_date: from_date || null,
        to_date: to_date || null,
      },
      total_receivables_amount: 0,
      total_amount: 0,
      total_debit: 0,
      total_credit: 0,
      total_opening_balance: 0,
      total_parties: 0,
      debtors_count: 0,
      page: Number(page) || 1,
      limit: Number(limit) || 0,
      total_pages: 1,
      parties: [],
      data: [],
      message: "No customer ledgers found for this company under Sundry Debtors",
    };
  }

  // 5. Fetch baseline opening balances & prior period adjustments
  const { balanceMap, baselineDate } = await getDebtorBaselineBalances(
    targetCompanyId,
    customerLedgerIds,
    fromDate
  );

  let priorEntriesByLedger = new Map();
  if (fromDate && baselineDate && fromDate > baselineDate) {
    const priorToDate = new Date(fromDate.getTime() - 1);
    const priorData = await resolveAccountingData({
      companyId: targetCompanyId,
      groupNames,
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

  // 6. Map vouchers for enriched bill/voucher details
  const voucherMap = new Map();
  for (const v of data.vouchers || []) {
    if (v?._id) voucherMap.set(String(v._id), v);
  }

  // 7. Group current period entries by customer ledger
  const currentEntriesByLedger = new Map();
  for (const entry of data.entries || []) {
    const idStr = String(entry.ledger_id);
    if (!currentEntriesByLedger.has(idStr)) {
      currentEntriesByLedger.set(idStr, []);
    }
    currentEntriesByLedger.get(idStr).push(entry);
  }

  // 8. Classify transactions and calculate Net Outstanding per customer
  const parties = [];
  let totalPeriodDebit = 0;
  let totalPeriodCredit = 0;
  let totalOpeningBalance = 0;
  let totalReceivable = 0;

  for (const ledger of customerLedgers) {
    const idStr = String(ledger._id);
    let effectiveOpening = balanceMap.get(idStr) || 0;

    // Adjust opening balance with prior period transactions if fromDate > baselineDate
    if (fromDate && baselineDate && fromDate > baselineDate && priorEntriesByLedger.has(idStr)) {
      const priorEntries = priorEntriesByLedger.get(idStr);
      for (const entry of priorEntries) {
        const { side, amount } = classifyEntry(entry);
        if (side === "debit") {
          effectiveOpening += amount;
        } else {
          effectiveOpening -= amount;
        }
      }
    }

    effectiveOpening = round2(effectiveOpening);

    // Current period transactions: classify into DEBIT and CREDIT
    let customerDebit = 0;
    let customerCredit = 0;
    const currentEntries = currentEntriesByLedger.get(idStr) || [];
    const bills = [];

    for (const entry of currentEntries) {
      const { side, amount } = classifyEntry(entry);
      if (side === "debit") {
        customerDebit += amount;
      } else {
        customerCredit += amount;
      }

      const v = voucherMap.get(String(entry.voucher_id));
      const vDate = v?.date || entry.createdAt;
      const billDateStr = vDate
        ? new Date(vDate).toISOString().split("T")[0]
        : "N/A";
      const billDueStr = v?.effective_date
        ? new Date(v.effective_date).toISOString().split("T")[0]
        : billDateStr;

      if (Array.isArray(entry.bills_allocation) && entry.bills_allocation.length > 0) {
        for (const bAlloc of entry.bills_allocation) {
          bills.push({
            id: entry._id,
            voucher_id: entry.voucher_id,
            voucher_number: v?.voucher_number || "N/A",
            voucher_type: v?.voucher_type || "N/A",
            bill_ref: bAlloc.name || v?.voucher_number || "N/A",
            bill_date: billDateStr,
            bill_due: billDueStr,
            side,
            closing_amount: Math.abs(Number(bAlloc.amount) || amount),
            amount: Math.abs(Number(bAlloc.amount) || amount),
            bill_type: bAlloc.bill_type || "Agst Ref",
          });
        }
      } else {
        bills.push({
          id: entry._id,
          voucher_id: entry.voucher_id,
          voucher_number: v?.voucher_number || "N/A",
          voucher_type: v?.voucher_type || "N/A",
          bill_ref: v?.reference || v?.voucher_number || `VCH-${entry.voucher_id}`,
          bill_date: billDateStr,
          bill_due: billDueStr,
          side,
          closing_amount: amount,
          amount,
        });
      }
    }

    customerDebit = round2(customerDebit);
    customerCredit = round2(customerCredit);

    // Net Outstanding according to normal_side = "debit": Opening + Debit (Sales) - Credit (Receipts)
    const closingBalance = normalSide === "debit"
      ? round2(effectiveOpening + customerDebit - customerCredit)
      : round2(effectiveOpening + customerCredit - customerDebit);

    const netOutstanding = closingBalance > 0 ? closingBalance : 0;

    // Status classification
    let partyStatus = "cleared";
    if (closingBalance > 0) {
      partyStatus = "pending"; // Customer owes money (Receivable)
    } else if (closingBalance < 0) {
      partyStatus = "advance"; // Customer paid in advance
    }

    totalOpeningBalance += effectiveOpening;
    totalPeriodDebit += customerDebit;
    totalPeriodCredit += customerCredit;

    if (closingBalance > 0) {
      totalReceivable += closingBalance;
    }

    // Filter by status if requested (e.g., 'pending')
    if (status && status !== "all" && partyStatus !== status.toLowerCase()) {
      continue;
    }

    parties.push({
      party_name: ledger.name,
      ledger_id: ledger._id,
      parent_group: ledger.parent || "Sundry Debtors",
      group_id: ledger.group_id,
      opening_balance: effectiveOpening,
      total_debit: customerDebit,   // Sales / Invoices
      total_credit: customerCredit, // Receipts / Payments
      net_change: round2(customerDebit - customerCredit),
      closing_balance: closingBalance,
      total_closing_amount: netOutstanding,
      closing_amount: netOutstanding,
      net_outstanding: netOutstanding,
      status: partyStatus,
      total_number_of_bills: bills.length,
      bills,
    });
  }

  // 9. Sort by closing balance descending (highest debtor first)
  parties.sort((a, b) => b.closing_balance - a.closing_balance);

  totalReceivable = round2(totalReceivable);
  totalPeriodDebit = round2(totalPeriodDebit);
  totalPeriodCredit = round2(totalPeriodCredit);
  totalOpeningBalance = round2(totalOpeningBalance);

  const debtorsCount = parties.filter((p) => p.status === "pending").length;
  const totalParties = parties.length;

  // 10. Optional pagination
  let paginatedParties = parties;
  if (page && limit) {
    const p = Math.max(1, Number(page));
    const lim = Math.max(1, Number(limit));
    paginatedParties = parties.slice((p - 1) * lim, p * lim);
  }

  return {
    accounting_config: {
      requirement: "receivable",
      type: config.type,
      groups: groupNames,
      normal_side: normalSide,
    },
    company_id: targetCompanyId,
    period: {
      from_date: from_date || null,
      to_date: to_date || null,
    },
    total_receivables_amount: totalReceivable,
    total_amount: totalReceivable,
    total_closing_balance: round2(totalOpeningBalance + totalPeriodDebit - totalPeriodCredit),
    total_opening_balance: totalOpeningBalance,
    total_debit: totalPeriodDebit,
    total_credit: totalPeriodCredit,
    total_parties: totalParties,
    debtors_count: debtorsCount,
    page: Number(page) || 1,
    limit: limit ? Number(limit) : totalParties,
    total_pages: limit ? Math.ceil(totalParties / Number(limit)) || 1 : 1,
    parties: paginatedParties,
    data: paginatedParties,
  };
};


export default {
  calculateReceivablesService,
  calculateReceivablesByPartyService,
  classifyEntry,
  getDebtorBaselineBalances,
};
