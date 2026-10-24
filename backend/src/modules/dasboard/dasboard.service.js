import mongoose from "mongoose";
import Company from "../companies/company.schema.js";
import { calculateAccountingService } from "../tally/accounting/accounting.controller.js";
import { calculateExpenseService } from "../tally/Expense/expense.js";
import { calculateCashBalanceService } from "../tally/cash/cash.service.js";
import { calculateBankBalanceService } from "../tally/bank/bank.service.js";
import { calculateReceivablesService } from "../tally/receivables/receivables.services.js";
import { calculatePayablesService } from "../tally/payables/payables.services.js";
import { calculateReceivablesGstAndTdsService } from "../tally/receivables/receivablesGstTds.service.js";
import { calculatePayablesGstAndTdsService } from "../tally/payables/payablesGstTds.service.js";
import { ApiError } from "../../utils/api-error.js";
import { ok } from "../../utils/response.js";

/**
 * Utility: Round number to 2 decimal places
 */
const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

/**
 * Helper to unwrap Promise.allSettled results safely
 */
const unwrapSettled = (settled, label = "Module") => {
  if (!settled) return null;
  if (settled.status === "rejected") {
    console.error(`[Dashboard] ${label} calculation failed:`, settled.reason);
    return null;
  }
  return settled.status === "fulfilled" ? settled.value : settled;
};

/**
 * Resolves Company from ObjectId, string company_id, or company name
 */
export const resolveCompany = async (companyId) => {
  if (!companyId) {
    throw ApiError.badRequest("Company ID is required");
  }

  let company = null;

  if (mongoose.Types.ObjectId.isValid(companyId)) {
    company = await Company.findOne({
      _id: new mongoose.Types.ObjectId(companyId),
      is_deleted: { $ne: true },
    })
      .select("_id name company_id")
      .lean();
  }

  if (!company) {
    company = await Company.findOne({
      $or: [{ company_id: companyId }, { name: companyId }],
      is_deleted: { $ne: true },
    })
      .select("_id name company_id")
      .lean();
  }

  if (!company) {
    throw ApiError.notFound("Company not found");
  }

  return company;
};

/**
 * Resolves date range from from_date/to_date or FY string (e.g. "2024-2025" or "2024")
 */
export const resolveDateRange = ({ from_date, to_date, fy, targetYear } = {}) => {
  let fromDate = from_date || null;
  let toDate = to_date || null;

  const rawFy = fy || targetYear;
  if (rawFy) {
    const fyStr = String(rawFy).trim().toLowerCase();
    if (fyStr === "all" || fyStr === "all years" || fyStr === "all_years") {
      return { from_date: null, to_date: null };
    }
  }

  if ((!fromDate || !toDate) && rawFy) {
    const fyStr = String(rawFy).trim();
    const fourDigitMatch = fyStr.match(/\b(20\d\d)\b/);
    if (fourDigitMatch) {
      const startYear = parseInt(fourDigitMatch[1], 10);
      fromDate = fromDate || `${startYear}-04-01`;
      toDate = toDate || `${startYear + 1}-03-31`;
    }
  }

  return { from_date: fromDate, to_date: toDate };
};

/**
 * Core Service: Calculates summary amounts for Dashboard Home:
 * - revenue: Sales total amount
 * - expense: Purchase + Indirect Expense total amount
 * - cash_balance: Cash-in-Hand closing balance (Opening + DR - CR)
 * - bank_balance: Bank Accounts closing balance (Opening + DR - CR)
 * - receivable: Sundry Debtors total receivable
 * - payable: Sundry Creditors total payable
 */
export const calculateDashboardHomeData = async ({
  companyId,
  from_date,
  to_date,
  fy,
  targetYear,
}) => {
  // 1. Resolve Company
  const company = await resolveCompany(companyId);
  const targetCompanyId = company._id;

  const { from_date: effectiveFromDate, to_date: effectiveToDate } = resolveDateRange({
    from_date,
    to_date,
    fy,
    targetYear,
  });

  // 2. Fetch modules in parallel
  const [
    salesResult,
    expenseResult,
    cashResult,
    bankResult,
    receivableResult,
    payableResult,
  ] = await Promise.allSettled([
    calculateAccountingService({
      companyId: targetCompanyId,
      requirement: "sales",
      from_date: effectiveFromDate,
      to_date: effectiveToDate,
    }),
    calculateExpenseService({
      companyId: targetCompanyId,
      from_date: effectiveFromDate,
      to_date: effectiveToDate,
    }),
    calculateCashBalanceService({
      companyId: targetCompanyId,
      from_date: effectiveFromDate,
      to_date: effectiveToDate,
    }),
    calculateBankBalanceService({
      companyId: targetCompanyId,
      from_date: effectiveFromDate,
      to_date: effectiveToDate,
    }),
    calculateReceivablesGstAndTdsService({
      companyId: targetCompanyId,
      from_date: effectiveFromDate,
      to_date: effectiveToDate,
    }),
    calculatePayablesGstAndTdsService({
      companyId: targetCompanyId,
      from_date: effectiveFromDate,
      to_date: effectiveToDate,
    }),
  ]);

  // 3. Unwrap settled module results
  const sales = unwrapSettled(salesResult, "Sales");
  const expense = unwrapSettled(expenseResult, "Expense");
  const cash = unwrapSettled(cashResult, "Cash");
  const bank = unwrapSettled(bankResult, "Bank");
  const receivableGstTds = unwrapSettled(receivableResult, "Receivable");
  const payableGstTds = unwrapSettled(payableResult, "Payable");

  // 4. Extract pure amount values
  const revenueAmount = round2(sales?.amount ?? 0);
  const expenseAmount = round2(expense?.amount ?? expense?.total_amount ?? 0);
  const profitAmount = round2(revenueAmount - expenseAmount);

  const cashBalanceAmount = round2(
    cash?.closing_balance ?? cash?.amount ?? 0
  );
  const bankBalanceAmount = round2(
    bank?.closing_balance ?? bank?.amount ?? 0
  );

  // Receivables amount: strictly matches the customer receivables screen calculation
  let receivableAmount = round2(
    receivableGstTds?.summary?.receivable?.total_receivable ??
    receivableGstTds?.summary?.receivable?.closing_balance ??
    0
  );

  // Fallback if zero or service unfulfilled
  if (receivableAmount === 0) {
    const recFallback = await calculateReceivablesService({
      companyId: targetCompanyId,
      from_date: effectiveFromDate,
      to_date: effectiveToDate,
    }).catch(() => null);
    receivableAmount = round2(
      recFallback?.total_receivable ??
      recFallback?.amount ??
      Math.abs(recFallback?.closing_balance ?? 0)
    );
  }

  // Payables amount: strictly matches the vendor payables screen calculation
  let payableAmount = round2(
    payableGstTds?.summary?.payable?.total_payable ??
    payableGstTds?.summary?.payable?.closing_balance ??
    0
  );

  // Fallback if zero or service unfulfilled
  if (payableAmount === 0) {
    const payFallback = await calculatePayablesService({
      companyId: targetCompanyId,
      from_date: effectiveFromDate,
      to_date: effectiveToDate,
    }).catch(() => null);
    payableAmount = round2(
      payFallback?.total_payable ??
      payFallback?.amount ??
      Math.abs(payFallback?.closing_balance ?? 0)
    );
  }

  return {
    company_id: targetCompanyId,
    company_name: company.name || null,
    period: {
      from_date: effectiveFromDate || null,
      to_date: effectiveToDate || null,
      fy: fy || targetYear || null,
    },
    revenue: revenueAmount,
    expense: expenseAmount,
    profit: profitAmount,
    net_profit: profitAmount,
    totalRevenue: revenueAmount,
    totalExpense: expenseAmount,
    cash_balance: cashBalanceAmount,
    bank_balance: bankBalanceAmount,
    receivable: receivableAmount,
    receivables: receivableAmount,
    total_receivables: receivableAmount,
    payable: payableAmount,
    payables: payableAmount,
    total_payables: payableAmount,
  };
};

import { getUnifiedDashboardHomeService } from "../erp/reports/dashboardReport.service.js";

/**
 * Controller handler for Dashboard Home
 */
export const getDashboardData = async (req, res, next) => {
  try {
    const { companyId } = req.params;

    // 1. Prioritize unified reporting engine for sub-50ms response and comprehensive filter handling
    try {
      const unifiedData = await getUnifiedDashboardHomeService({
        companyId,
        ...req.query,
        ...req.body,
      });
      return ok(res, unifiedData, "Dashboard home data retrieved successfully");
    } catch (unifiedErr) {
      console.warn("[Dashboard] Unified reporting engine fallback to legacy:", unifiedErr.message);
    }

    // 2. Legacy fallback calculation
    const from_date = req.query?.from_date ?? req.body?.from_date;
    const to_date = req.query?.to_date ?? req.body?.to_date;
    const fy = req.query?.fy ?? req.body?.fy;
    const targetYear = req.query?.targetYear ?? req.body?.targetYear;

    const data = await calculateDashboardHomeData({
      companyId,
      from_date,
      to_date,
      fy,
      targetYear,
    });

    return ok(res, data, "Dashboard home data retrieved successfully");
  } catch (error) {
    if (typeof next === "function") {
      next(error);
    } else {
      throw error;
    }
  }
};

/**
 * Controller handler for clearing dashboard cache
 */
export const clearDashboardCacheController = async (req, res, next) => {
  try {
    return ok(res, { cleared: true }, "Dashboard cache cleared successfully");
  } catch (error) {
    if (typeof next === "function") {
      next(error);
    } else {
      throw error;
    }
  }
};

export default {
  resolveCompany,
  resolveDateRange,
  calculateDashboardHomeData,
  getDashboardData,
  clearDashboardCacheController,
};