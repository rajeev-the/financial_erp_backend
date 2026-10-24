import mongoose from "mongoose";
import { calculateAccountingService } from "../accounting/accounting.controller.js";
import { ApiError } from "../../../utils/api-error.js";
import { ok } from "../../../utils/response.js";

/**
 * Service to calculate total expense by combining purchase and indirect expenses
 */
export const calculateExpenseService = async ({ companyId, from_date, to_date }) => {
  const [purchaseData, expenseData] = await Promise.all([
    calculateAccountingService({
      companyId,
      requirement: "purchase",
      from_date,
      to_date,
    }),
    calculateAccountingService({
      companyId,
      requirement: "expense",
      from_date,
      to_date,
    }),
  ]);

  // Extract amounts safely
  const purchaseAmount = purchaseData?.amount ?? purchaseData?.total_amount ?? 0;
  const expenseAmount = expenseData?.amount ?? expenseData?.total_amount ?? 0;

  // Combine amounts
  const totalCombinedAmount = purchaseAmount + expenseAmount;
  const totalDebit = (purchaseData?.total_debit ?? 0) + (expenseData?.total_debit ?? 0);
  const totalCredit = (purchaseData?.total_credit ?? 0) + (expenseData?.total_credit ?? 0);

  // Deduplicate and combine vouchers
  const voucherMap = new Map();
  for (const v of purchaseData?.vouchers || []) {
    if (v?._id) voucherMap.set(String(v._id), v);
  }
  for (const v of expenseData?.vouchers || []) {
    if (v?._id && !voucherMap.has(String(v._id))) {
      voucherMap.set(String(v._id), v);
    }
  }

  const combinedVouchers = Array.from(voucherMap.values());
  const combinedLedgerEntries = [
    ...(purchaseData?.ledger_entries || []),
    ...(expenseData?.ledger_entries || []),
  ];

  return {
    amount: totalCombinedAmount,
    total_amount: totalCombinedAmount,
    total_debit: totalDebit,
    total_credit: totalCredit,
    vouchers: combinedVouchers,
    ledger_entries: combinedLedgerEntries,
    breakdow: {
      purchase: purchaseAmount,
      expense: expenseAmount,
    },
  
  };
};

export const getExpenseCalculation = async (req, res) => {
  const { companyId } = req.params;
  const { from_date, to_date } = req.query;

  if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
    throw ApiError.badRequest("A valid company ID is required");
  }

  const result = await calculateExpenseService({
    companyId,
    from_date: from_date ?? req.body?.from_date,
    to_date: to_date ?? req.body?.to_date,
  });

  return ok(res, result, "Expense data retrieved successfully");
};

export default {
  calculateExpenseService,
  getExpenseCalculation,
};
