import { Router } from "express";
import {
  getDashboardHomeController,
  getReceivablesSummaryController,
  getReceivablesPartiesController,
  getCustomerBillsController,
  getPayablesSummaryController,
  getPayablesPartiesController,
  getVendorBillsController,
  getMonthlySalesRegisterController,
  getMonthlySalesVouchersController,
  getMonthlyPurchaseRegisterController,
  getMonthlyPurchaseVouchersController,
  getDayBookController,
  getLedgerStatementController,
  getBankingAccountsController,
  getProfitAndLossController,
  getBalanceSheetController,
  getTrialBalanceController,
  getPartyRankingsController,
  getStockSummaryController,
  getFinancialPositionController,
  getGstSummaryController,
} from "./reports.controller.js";

const erpReportsRouter = Router();

// Dashboard Home (supports both with and without :companyId in path)
erpReportsRouter.get("/dashboard/home", getDashboardHomeController);
erpReportsRouter.get("/dashboard/home/:companyId", getDashboardHomeController);

// Receivables Drill-Down Suite
erpReportsRouter.get("/receivables/summary", getReceivablesSummaryController);
erpReportsRouter.get("/receivables/summary/:companyId", getReceivablesSummaryController);

erpReportsRouter.get("/receivables/parties", getReceivablesPartiesController);
erpReportsRouter.get("/receivables/parties/:companyId", getReceivablesPartiesController);

erpReportsRouter.get("/receivables/party/:partyId/bills", getCustomerBillsController);
erpReportsRouter.get("/receivables/bills", getCustomerBillsController);
erpReportsRouter.get("/receivables/bills/:companyId", getCustomerBillsController);

// Payables Drill-Down Suite
erpReportsRouter.get("/payables/summary", getPayablesSummaryController);
erpReportsRouter.get("/payables/summary/:companyId", getPayablesSummaryController);

erpReportsRouter.get("/payables/parties", getPayablesPartiesController);
erpReportsRouter.get("/payables/parties/:companyId", getPayablesPartiesController);

erpReportsRouter.get("/payables/party/:partyId/bills", getVendorBillsController);
erpReportsRouter.get("/payables/bills", getVendorBillsController);
erpReportsRouter.get("/payables/bills/:companyId", getVendorBillsController);

// Sales & Purchase Registers
erpReportsRouter.get("/sales/register/monthly", getMonthlySalesRegisterController);
erpReportsRouter.get("/sales/register/monthly/:companyId", getMonthlySalesRegisterController);

erpReportsRouter.get("/sales/register/month/:yearMonth/vouchers", getMonthlySalesVouchersController);
erpReportsRouter.get("/sales/register/month/:yearMonth/vouchers/:companyId", getMonthlySalesVouchersController);

erpReportsRouter.get("/purchase/register/monthly", getMonthlyPurchaseRegisterController);
erpReportsRouter.get("/purchase/register/monthly/:companyId", getMonthlyPurchaseRegisterController);

erpReportsRouter.get("/purchase/register/month/:yearMonth/vouchers", getMonthlyPurchaseVouchersController);
erpReportsRouter.get("/purchase/register/month/:yearMonth/vouchers/:companyId", getMonthlyPurchaseVouchersController);

// Day Book
erpReportsRouter.get("/daybook", getDayBookController);
erpReportsRouter.get("/daybook/:companyId", getDayBookController);

// Ledger Account Statement Drill-Down
erpReportsRouter.get("/ledger/statement", getLedgerStatementController);
erpReportsRouter.get("/ledger/statement/:companyId", getLedgerStatementController);
erpReportsRouter.get("/ledger/statement/:companyId/:ledgerId", getLedgerStatementController);
erpReportsRouter.get("/ledger/:ledgerId/statement", getLedgerStatementController);

// Banking & Liquidity Accounts Suite
erpReportsRouter.get("/banking/accounts", getBankingAccountsController);
erpReportsRouter.get("/banking/accounts/:companyId", getBankingAccountsController);

// Financial Statements Suite (P&L, Balance Sheet, Trial Balance)
erpReportsRouter.get("/financial/profit-loss", getProfitAndLossController);
erpReportsRouter.get("/financial/profit-loss/:companyId", getProfitAndLossController);

erpReportsRouter.get("/financial/balance-sheet", getBalanceSheetController);
erpReportsRouter.get("/financial/balance-sheet/:companyId", getBalanceSheetController);

erpReportsRouter.get("/financial/trial-balance", getTrialBalanceController);
erpReportsRouter.get("/financial/trial-balance/:companyId", getTrialBalanceController);

// Analytics: Party Volume Rankings
erpReportsRouter.get("/analytics/party-rankings", getPartyRankingsController);
erpReportsRouter.get("/analytics/party-rankings/:companyId", getPartyRankingsController);

// Inventory: Stock Summary & Valuation
erpReportsRouter.get("/inventory/stock-summary", getStockSummaryController);
erpReportsRouter.get("/inventory/stock-summary/:companyId", getStockSummaryController);

// Auxiliary Financial Position & Ratios Suite
erpReportsRouter.get("/financial/position", getFinancialPositionController);
erpReportsRouter.get("/financial/position/:companyId", getFinancialPositionController);

// Auxiliary GST Tax Summary & Liability Suite
erpReportsRouter.get("/financial/gst-summary", getGstSummaryController);
erpReportsRouter.get("/financial/gst-summary/:companyId", getGstSummaryController);
erpReportsRouter.get("/tax/gst-summary", getGstSummaryController);
erpReportsRouter.get("/tax/gst-summary/:companyId", getGstSummaryController);

export default erpReportsRouter;
