import { Router } from "express";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { getAccountingData } from "./accounting.controller.js";
import {
  getProfitAndLoss,
  getBalanceSheet,
  getFinancialPosition,
} from "../reports/financialReports/financialReports.controller.js";

const accountingRouter = Router();

accountingRouter.get("/profit-loss/:companyId", asyncHandler(getProfitAndLoss));
accountingRouter.get("/profit-and-loss/:companyId", asyncHandler(getProfitAndLoss));
accountingRouter.get("/balance-sheet/:companyId", asyncHandler(getBalanceSheet));
accountingRouter.get("/financial-position/:companyId", asyncHandler(getFinancialPosition));
accountingRouter.get("/:companyId", asyncHandler(getAccountingData));

export default accountingRouter;
