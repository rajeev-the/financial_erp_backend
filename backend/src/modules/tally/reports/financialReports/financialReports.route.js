import { Router } from "express";
import { asyncHandler } from "../../../../utils/asyncHandler.js";
import {
  getProfitAndLoss,
  getBalanceSheet,
  getFinancialPosition,
  getGstReport,
} from "./financialReports.controller.js";

const financialReportsRouter = Router();

// Profit & Loss
financialReportsRouter.get("/profit-loss/:companyId", asyncHandler(getProfitAndLoss));
financialReportsRouter.get("/profit-and-loss/:companyId", asyncHandler(getProfitAndLoss));

// Balance Sheet
financialReportsRouter.get("/balance-sheet/:companyId", asyncHandler(getBalanceSheet));

// Financial Position & Ratios
financialReportsRouter.get("/financial-position/:companyId", asyncHandler(getFinancialPosition));

// GST Report & Tax Liability
financialReportsRouter.get("/gst/:companyId", asyncHandler(getGstReport));

export default financialReportsRouter;
