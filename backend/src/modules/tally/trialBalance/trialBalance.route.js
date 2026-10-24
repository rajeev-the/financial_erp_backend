import { Router } from "express";
import { getTrialBalanceSummary } from "./trialBalance.controller.js";
import { asyncHandler } from "../../../utils/asyncHandler.js";

const trialBalanceRouter = Router();

trialBalanceRouter.get("/:companyId", asyncHandler(getTrialBalanceSummary));

export default trialBalanceRouter;