import mongoose from "mongoose";
import ApiError from "../../../utils/api-error.js";
import { ok } from "../../../utils/response.js";
import {
  getKnockoffSalesService,
  getKnockoffPurchasesService,
  getKnockoffCompaniesService,
} from "./knockoff.service.js";

/**
 * Controller to get sales knock-off report against sister companies' purchases
 * Route: GET /api/v1/tally/knockoff/sales
 * Query Params:
 *  - company_id (required): ID of the seller company
 *  - target_company (optional): 'all' (default) or specific sister company ID / name
 */
export const getKnockoffSales = async (req, res) => {
  const companyId = req.query.company_id || req.params.companyId;
  const targetCompany = req.query.target_company || "all";

  if (!companyId) {
    throw ApiError.badRequest("company_id query parameter is required");
  }

  if (!mongoose.Types.ObjectId.isValid(companyId)) {
    throw ApiError.badRequest(`Invalid company_id format: ${companyId}`);
  }

  const result = await getKnockoffSalesService({
    companyId,
    targetCompany,
  });

  return ok(res, result, "Knock-off sales report fetched successfully");
};

/**
 * Controller to get purchase knock-off report for a buyer company against sister companies' sales
 * Route: GET /api/v1/tally/knockoff/purchases
 * Query Params:
 *  - company_id (required): ID of the buyer company
 *  - target_company (optional): 'all' (default) or specific seller sister company ID / name
 */
export const getKnockoffPurchases = async (req, res) => {
  const companyId = req.query.company_id || req.params.companyId;
  const targetCompany = req.query.target_company || "all";

  if (!companyId) {
    throw ApiError.badRequest("company_id query parameter is required");
  }

  if (!mongoose.Types.ObjectId.isValid(companyId)) {
    throw ApiError.badRequest(`Invalid company_id format: ${companyId}`);
  }

  const result = await getKnockoffPurchasesService({
    companyId,
    targetCompany,
  });

  return ok(res, result, "Knock-off purchases report fetched successfully");
};

/**
 * Controller to get list of companies available for knock-off reconciliation
 * Route: GET /api/v1/tally/knockoff/companies
 * Query Params:
 *  - tenant_id (optional): ID of tenant to filter
 */
export const getKnockoffCompanies = async (req, res) => {
  const tenantId = req.query.tenant_id;
  const companies = await getKnockoffCompaniesService({ tenantId });
  return ok(res, companies, "Knock-off companies fetched successfully");
};

export default {
  getKnockoffSales,
  getKnockoffPurchases,
  getKnockoffCompanies,
};

