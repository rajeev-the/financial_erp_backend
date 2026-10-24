import { Router } from "express";
import {
  getFinancialYear,
  getFinancialYearRevenueExpenseTrend,
  getGeographicalRevenueSummary,
  getAccountBookSummary,
} from "./summary.controller.js";
import { asyncHandler } from "../../../utils/asyncHandler.js";

const summaryRouter = Router();

summaryRouter.get(
  "/financial-years/:companyId",
  asyncHandler(getFinancialYear),
);
summaryRouter.get(
  "/revenue-expense/:companyId",
  asyncHandler(getFinancialYearRevenueExpenseTrend),
);
summaryRouter.get(
  "/geographical/:companyId",
  asyncHandler(getGeographicalRevenueSummary),
);
summaryRouter.get(
  "/account-book/:companyId",
  asyncHandler(getAccountBookSummary),
);

export default summaryRouter;

