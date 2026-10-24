import { getUnifiedDashboardHomeService } from "./dashboardReport.service.js";
import {
  getReceivablesSummaryService,
  getReceivablesPartiesService,
  getCustomerBillsReportService,
} from "./receivablesReport.service.js";
import {
  getPayablesSummaryService,
  getPayablesPartiesService,
  getVendorBillsReportService,
} from "./payablesReport.service.js";
import {
  getMonthlyRegisterService,
  getMonthlyVouchersService,
} from "./registersReport.service.js";
import { getDayBookReportService } from "./daybookReport.service.js";
import { getLedgerStatementReportService } from "./ledgerStatementReport.service.js";
import { getBankingAccountsReportService } from "./bankingReport.service.js";
import {
  getProfitAndLossReportService,
  getBalanceSheetReportService,
  getTrialBalanceReportService,
  getFinancialPositionReportService,
  getGstSummaryReportService,
} from "./financialStatementsReport.service.js";
import { getPartyRankingsReportService } from "./analyticsReport.service.js";
import { getStockSummaryReportService } from "./inventoryReport.service.js";
import { ApiError } from "../../../utils/api-error.js";
import { ok as successResponse } from "../../../utils/response.js";

/**
 * Helper to get target companyId from params, query, header, or body
 */
function resolveReqCompanyId(req) {
  const companyId =
    req.params.companyId ||
    req.query.companyId ||
    req.query.company_id ||
    req.query.company ||
    req.headers["x-company-id"] ||
    req.body?.companyId ||
    req.body?.company_id;

  if (!companyId) {
    throw ApiError.badRequest("companyId is required in URL param, query, header, or body");
  }
  return companyId;
}

// ─── 1. Dashboard Home ────────────────────────────────────────────────────────
export async function getDashboardHomeController(req, res, next) {
  try {
    const companyId = resolveReqCompanyId(req);
    const data = await getUnifiedDashboardHomeService({
      companyId,
      ...req.query,
      ...req.body,
    });
    return successResponse(res, data, "Dashboard home data retrieved successfully");
  } catch (err) {
    next(err);
  }
}

// ─── 2. Receivables Suite ─────────────────────────────────────────────────────
export async function getReceivablesSummaryController(req, res, next) {
  try {
    const companyId = resolveReqCompanyId(req);
    const data = await getReceivablesSummaryService({
      companyId,
      ...req.query,
      ...req.body,
    });
    return successResponse(res, data, "Receivables summary retrieved successfully");
  } catch (err) {
    next(err);
  }
}

export async function getReceivablesPartiesController(req, res, next) {
  try {
    const companyId = resolveReqCompanyId(req);
    const data = await getReceivablesPartiesService({
      companyId,
      ...req.query,
      ...req.body,
    });
    return successResponse(res, data, "Receivables parties retrieved successfully");
  } catch (err) {
    next(err);
  }
}

export async function getCustomerBillsController(req, res, next) {
  try {
    const companyId = resolveReqCompanyId(req);
    const partyId = req.params.partyId || req.query.partyId || req.query.party_id;
    const data = await getCustomerBillsReportService({
      companyId,
      partyId,
      ...req.query,
      ...req.body,
    });
    return successResponse(res, data, "Customer bills aging breakdown retrieved successfully");
  } catch (err) {
    next(err);
  }
}

// ─── 3. Payables Suite ────────────────────────────────────────────────────────
export async function getPayablesSummaryController(req, res, next) {
  try {
    const companyId = resolveReqCompanyId(req);
    const data = await getPayablesSummaryService({
      companyId,
      ...req.query,
      ...req.body,
    });
    return successResponse(res, data, "Payables summary retrieved successfully");
  } catch (err) {
    next(err);
  }
}

export async function getPayablesPartiesController(req, res, next) {
  try {
    const companyId = resolveReqCompanyId(req);
    const data = await getPayablesPartiesService({
      companyId,
      ...req.query,
      ...req.body,
    });
    return successResponse(res, data, "Payables parties retrieved successfully");
  } catch (err) {
    next(err);
  }
}

export async function getVendorBillsController(req, res, next) {
  try {
    const companyId = resolveReqCompanyId(req);
    const partyId = req.params.partyId || req.query.partyId || req.query.party_id;
    const data = await getVendorBillsReportService({
      companyId,
      partyId,
      ...req.query,
      ...req.body,
    });
    return successResponse(res, data, "Vendor bills aging breakdown retrieved successfully");
  } catch (err) {
    next(err);
  }
}

// ─── 4. Sales & Purchase Registers ────────────────────────────────────────────
export async function getMonthlySalesRegisterController(req, res, next) {
  try {
    const companyId = resolveReqCompanyId(req);
    const data = await getMonthlyRegisterService({
      companyId,
      voucherType: "SALES",
      ...req.query,
      ...req.body,
    });
    return successResponse(res, data, "Monthly sales register retrieved successfully");
  } catch (err) {
    next(err);
  }
}

export async function getMonthlySalesVouchersController(req, res, next) {
  try {
    const companyId = resolveReqCompanyId(req);
    const yearMonth = req.params.yearMonth || req.query.yearMonth || req.query.year_month;
    const data = await getMonthlyVouchersService({
      companyId,
      voucherType: "SALES",
      yearMonth,
      ...req.query,
      ...req.body,
    });
    return successResponse(res, data, "Monthly sales vouchers retrieved successfully");
  } catch (err) {
    next(err);
  }
}

export async function getMonthlyPurchaseRegisterController(req, res, next) {
  try {
    const companyId = resolveReqCompanyId(req);
    const data = await getMonthlyRegisterService({
      companyId,
      voucherType: "PURCHASE",
      ...req.query,
      ...req.body,
    });
    return successResponse(res, data, "Monthly purchase register retrieved successfully");
  } catch (err) {
    next(err);
  }
}

export async function getMonthlyPurchaseVouchersController(req, res, next) {
  try {
    const companyId = resolveReqCompanyId(req);
    const yearMonth = req.params.yearMonth || req.query.yearMonth || req.query.year_month;
    const data = await getMonthlyVouchersService({
      companyId,
      voucherType: "PURCHASE",
      yearMonth,
      ...req.query,
      ...req.body,
    });
    return successResponse(res, data, "Monthly purchase vouchers retrieved successfully");
  } catch (err) {
    next(err);
  }
}

// ─── 5. Day Book ──────────────────────────────────────────────────────────────
export async function getDayBookController(req, res, next) {
  try {
    const companyId = resolveReqCompanyId(req);
    const data = await getDayBookReportService({
      companyId,
      ...req.query,
      ...req.body,
    });
    return successResponse(res, data, "Day Book retrieved successfully");
  } catch (err) {
    next(err);
  }
}

// ─── 6. Ledger Account Statement Drill-Down ───────────────────────────────────
export async function getLedgerStatementController(req, res, next) {
  try {
    const companyId = resolveReqCompanyId(req);
    const ledgerId = req.params.ledgerId || req.query.ledgerId || req.query.ledger_id;
    const data = await getLedgerStatementReportService({
      companyId,
      ledgerId,
      ...req.query,
      ...req.body,
    });
    return successResponse(res, data, "Ledger statement retrieved successfully");
  } catch (err) {
    next(err);
  }
}

// ─── 7. Cash & Bank Accounts Liquidity Suite ──────────────────────────────────
export async function getBankingAccountsController(req, res, next) {
  try {
    const companyId = resolveReqCompanyId(req);
    const data = await getBankingAccountsReportService({
      companyId,
      ...req.query,
      ...req.body,
    });
    return successResponse(res, data, "Banking & liquidity accounts retrieved successfully");
  } catch (err) {
    next(err);
  }
}

// ─── 8. Financial Statements Suite (P&L, Balance Sheet, Trial Balance) ─────────
export async function getProfitAndLossController(req, res, next) {
  try {
    const companyId = resolveReqCompanyId(req);
    const data = await getProfitAndLossReportService({
      companyId,
      ...req.query,
      ...req.body,
    });
    return successResponse(res, data, "Profit & Loss statement retrieved successfully");
  } catch (err) {
    next(err);
  }
}

export async function getBalanceSheetController(req, res, next) {
  try {
    const companyId = resolveReqCompanyId(req);
    const data = await getBalanceSheetReportService({
      companyId,
      ...req.query,
      ...req.body,
    });
    return successResponse(res, data, "Balance Sheet retrieved successfully");
  } catch (err) {
    next(err);
  }
}

export async function getTrialBalanceController(req, res, next) {
  try {
    const companyId = resolveReqCompanyId(req);
    const data = await getTrialBalanceReportService({
      companyId,
      ...req.query,
      ...req.body,
    });
    return successResponse(res, data, "Trial Balance retrieved successfully");
  } catch (err) {
    next(err);
  }
}

// ─── 9. Analytics: Party Volume Rankings ──────────────────────────────────────
export async function getPartyRankingsController(req, res, next) {
  try {
    const companyId = resolveReqCompanyId(req);
    const data = await getPartyRankingsReportService({
      companyId,
      ...req.query,
      ...req.body,
    });
    return successResponse(res, data, "Party turnover rankings retrieved successfully");
  } catch (err) {
    next(err);
  }
}

// ─── 10. Inventory: Stock Summary & Valuation ─────────────────────────────────
export async function getStockSummaryController(req, res, next) {
  try {
    const companyId = resolveReqCompanyId(req);
    const data = await getStockSummaryReportService({
      companyId,
      ...req.query,
      ...req.body,
    });
    return successResponse(res, data, "Stock summary and valuation retrieved successfully");
  } catch (err) {
    next(err);
  }
}

// ─── 11. Financial Position & Accounting Ratios ──────────────────────────────
export async function getFinancialPositionController(req, res, next) {
  try {
    const companyId = resolveReqCompanyId(req);
    const data = await getFinancialPositionReportService({
      companyId,
      ...req.query,
      ...req.body,
    });
    return successResponse(res, data, "Financial position and accounting ratios retrieved successfully");
  } catch (err) {
    next(err);
  }
}

// ─── 12. GST Tax Summary & Liability ─────────────────────────────────────────
export async function getGstSummaryController(req, res, next) {
  try {
    const companyId = resolveReqCompanyId(req);
    const data = await getGstSummaryReportService({
      companyId,
      ...req.query,
      ...req.body,
    });
    return successResponse(res, data, "GST tax summary and liability retrieved successfully");
  } catch (err) {
    next(err);
  }
}




