import mongoose from "mongoose";
import { calculateAccountingService } from "../accounting/accounting.controller.js";
import Ledger from "../ledger/ledger.schema.js";
import { ApiError } from "../../../utils/api-error.js";
import { ok } from "../../../utils/response.js";

/**
 * Controller to fetch expense and purchase data and group by party name with total amounts,
 * matching the Trial Balance net calculation (Debits - Credits).
 */
export const getExpenseGroupLedger = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { from_date, to_date } = req.query;

    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      throw ApiError.badRequest("A valid company ID is required");
    }

    const fromDate = from_date ?? req.body?.from_date;
    const toDate = to_date ?? req.body?.to_date;

    // 1. Fetch purchase, expense accounting data, and bank/cash ledgers in parallel
    const [purchaseData, expenseData, bankCashLedgers] = await Promise.all([
      calculateAccountingService({
        companyId,
        requirement: "purchase",
        from_date: fromDate,
        to_date: toDate,
      }),
      calculateAccountingService({
        companyId,
        requirement: "expense",
        from_date: fromDate,
        to_date: toDate,
      }),
      Ledger.find(
        {
          company_id: companyId,
          is_deleted: { $ne: true },
          $or: [
            { parent: { $in: ["Bank Accounts", "Bank OD A/c", "Bank OCC A/c", "Cash-in-Hand"] } },
            { name: { $regex: /^(cash|bank\b)/i } },
          ],
        },
        { _id: 1, name: 1 }
      ).lean(),
    ]);

    const bankCashIdSet = new Set(bankCashLedgers.map((l) => String(l._id)));
    const bankCashNameSet = new Set(
      bankCashLedgers.map((l) => l.name?.trim().toLowerCase()).filter(Boolean)
    );

    // 2. Map each voucher ID to its party_ledger_name and party_ledger_id (excluding Bank & Cash accounts)
    const voucherPartyMap = new Map();
    const voucherPartyIdMap = new Map();
    const allVouchers = [
      ...(purchaseData?.vouchers || []),
      ...(expenseData?.vouchers || []),
    ];

    for (const v of allVouchers) {
      if (v?._id) {
        const vId = String(v._id);
        const partyIdStr = v.party_ledger_id
          ? String(typeof v.party_ledger_id === "object" ? v.party_ledger_id._id || v.party_ledger_id : v.party_ledger_id)
          : null;
        const rawPartyName =
          (typeof v.party_ledger_id === "object" ? v.party_ledger_id?.name : null) ||
          (typeof v.party_ledger_name === "string" ? v.party_ledger_name.trim() : null);

        // Do NOT treat Bank or Cash accounts as an expense party!
        const isBankOrCash =
          (partyIdStr && bankCashIdSet.has(partyIdStr)) ||
          (rawPartyName && bankCashNameSet.has(rawPartyName.toLowerCase()));

        // Only assign when there is a valid party and it is not a bank/cash account
        if (rawPartyName && !isBankOrCash) {
          voucherPartyMap.set(vId, rawPartyName);
          voucherPartyIdMap.set(vId, partyIdStr);
        }
      }
    }

    // 3. Deduplicate entries across purchase and expense
    const entryMap = new Map();
    for (const entry of purchaseData?.ledger_entries || []) {
      if (entry?._id) entryMap.set(String(entry._id), entry);
    }
    for (const entry of expenseData?.ledger_entries || []) {
      if (entry?._id) entryMap.set(String(entry._id), entry);
    }

    // 4. Sum entry amounts:
    // In Tally:
    // - Debit entries (expenses) have negative raw amounts (< 0)
    // - Credit entries (reversals, credit notes, discounts, round-off) have positive raw amounts (> 0)
    // Therefore: net expense = -rawAmount
    // - If a voucher has a valid party -> accumulate under partyNetExpenseMap
    // - If a voucher has NO party (party_ledger_id is null or bank/cash) -> accumulate under nonPartyNetExpenseMap
    const partyNetExpenseMap = new Map();
    const partyVouchersSet = new Map();
    const partyLedgersSet = new Map();
    const partyLedgerIdMap = new Map();

    const nonPartyNetExpenseMap = new Map();
    const nonPartyVouchersSet = new Map();
    const nonPartyLedgerIdMap = new Map();

    for (const entry of entryMap.values()) {
      const vId = String(entry.voucher_id);
      const expenseLedgerName = entry.ledger_name?.trim() || null;
      const partyName = voucherPartyMap.get(vId);
      const partyId = voucherPartyIdMap.get(vId);
      const rawAmount = Number(entry.amount) || 0;

      // Deduct rawAmount because debits are negative in Tally (-(-amount) = +expense)
      const netEntryExpense = -rawAmount;

      if (partyName) {
        // --- Party Expenses ---
        const currentExpense = partyNetExpenseMap.get(partyName) || 0;
        partyNetExpenseMap.set(partyName, currentExpense + netEntryExpense);

        if (!partyVouchersSet.has(partyName)) {
          partyVouchersSet.set(partyName, new Set());
        }
        if (entry.voucher_id) {
          partyVouchersSet.get(partyName).add(vId);
        }

        if (!partyLedgersSet.has(partyName)) {
          partyLedgersSet.set(partyName, new Set());
        }
        if (expenseLedgerName) {
          partyLedgersSet.get(partyName).add(expenseLedgerName);
        }

        if (partyId) {
          partyLedgerIdMap.set(partyName, partyId);
        } else if (entry.ledger_id) {
          const lId = typeof entry.ledger_id === "object" ? entry.ledger_id._id || entry.ledger_id : entry.ledger_id;
          if (lId) partyLedgerIdMap.set(partyName, String(lId));
        }
      } else {
        // --- Non-Party / Direct / Journal Expenses ---
        const ledgerKey = expenseLedgerName || "Direct Expense";
        const currentExpense = nonPartyNetExpenseMap.get(ledgerKey) || 0;
        nonPartyNetExpenseMap.set(ledgerKey, currentExpense + netEntryExpense);

        if (!nonPartyVouchersSet.has(ledgerKey)) {
          nonPartyVouchersSet.set(ledgerKey, new Set());
        }
        if (entry.voucher_id) {
          nonPartyVouchersSet.get(ledgerKey).add(vId);
        }

        if (entry.ledger_id) {
          const lId = typeof entry.ledger_id === "object" ? entry.ledger_id._id || entry.ledger_id : entry.ledger_id;
          if (lId) nonPartyLedgerIdMap.set(ledgerKey, String(lId));
        }
      }
    }

    // 5. Build parties list with net expense amount and ledger names
    const parties = Array.from(partyNetExpenseMap.entries())
      .map(([party_name, netExpense]) => {
        const netAmount = Math.round(netExpense * 100) / 100;
        const voucherIds = Array.from(partyVouchersSet.get(party_name) || []);
        const ledgerNames = Array.from(partyLedgersSet.get(party_name) || []);
        return {
          party_name,
          ledger_id: partyLedgerIdMap.get(party_name) || null,
          ledger_name: ledgerNames[0] || party_name,
          ledger_names: ledgerNames,
          amount: netAmount,
          vouchers_count: voucherIds.length,
          voucher_ids: voucherIds,
        };
      })
      .filter((p) => p.amount !== 0)
      .sort((a, b) => b.amount - a.amount);

    // 6. Build non_party_expenses list (journal adjustments, non-vendor expenses)
    const nonPartyExpenses = Array.from(nonPartyNetExpenseMap.entries())
      .map(([ledger_name, netExpense]) => {
        const netAmount = Math.round(netExpense * 100) / 100;
        const voucherIds = Array.from(nonPartyVouchersSet.get(ledger_name) || []);
        return {
          ledger_id: nonPartyLedgerIdMap.get(ledger_name) || null,
          ledger_name,
          amount: netAmount,
          vouchers_count: voucherIds.length,
          voucher_ids: voucherIds,
        };
      })
      .filter((item) => item.amount !== 0)
      .sort((a, b) => b.amount - a.amount);

    // 7. Calculate total amounts across parties and non-parties
    const totalPartyAmount = Math.round(
      parties.reduce((sum, party) => sum + party.amount, 0) * 100
    ) / 100;

    const totalNonPartyAmount = Math.round(
      nonPartyExpenses.reduce((sum, item) => sum + item.amount, 0) * 100
    ) / 100;

    const totalAmount = Math.round((totalPartyAmount + totalNonPartyAmount) * 100) / 100;

    return ok(
      res,
      {
        total_amount: totalAmount,
        total_parties: parties.length,
        total_party_amount: totalPartyAmount,
        total_non_party_amount: totalNonPartyAmount,
        parties,
        non_party_expenses: nonPartyExpenses,
      },
      "Expense parties and amounts retrieved successfully"
    );
  } catch (error) {
    next(error);
  }
};