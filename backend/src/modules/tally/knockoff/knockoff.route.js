import { Router } from "express";
import {
  getKnockoffSales,
  getKnockoffPurchases,
  getKnockoffCompanies,
} from "./knockoff.controller.js";
import { asyncHandler } from "../../../utils/asyncHandler.js";

const knockoffRouter = Router();

// GET /api/v1/tally/knockoff/companies
knockoffRouter.get("/companies", asyncHandler(getKnockoffCompanies));

// GET /api/v1/tally/knockoff/sales?company_id=...&target_company=...
knockoffRouter.get("/sales", asyncHandler(getKnockoffSales));

// GET /api/v1/tally/knockoff/sales/:companyId?target_company=...
knockoffRouter.get("/sales/:companyId", asyncHandler(getKnockoffSales));

// GET /api/v1/tally/knockoff/purchases?company_id=...&target_company=...
knockoffRouter.get("/purchases", asyncHandler(getKnockoffPurchases));

// GET /api/v1/tally/knockoff/purchases/:companyId?target_company=...
knockoffRouter.get("/purchases/:companyId", asyncHandler(getKnockoffPurchases));

export default knockoffRouter;

