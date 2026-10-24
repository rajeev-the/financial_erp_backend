import { calculateReceivablesGstAndTdsService } from "./receivablesGstTds.service.js";
import { ApiError } from "../../../utils/api-error.js";
import { ok } from "../../../utils/response.js";

/**
 * Controller to get Receivables Bifurcation with GST and TDS
 * Route: GET /cal/gst-tds/:companyId
 * Route alias: GET /receivablesgstandtds/:companyId
 */
export const getReceivablesGstAndTds = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { from_date, to_date, party_name, page, limit } = req.query;

    if (!companyId) {
      throw ApiError.badRequest("Company ID is required");
    }

    const data = await calculateReceivablesGstAndTdsService({
      companyId,
      from_date,
      to_date,
      party_name,
      page,
      limit,
    });

    return ok(res, data, "Receivables GST and TDS bifurcation retrieved successfully");
  } catch (error) {
    next(error);
  }
};

export default {
  getReceivablesGstAndTds,
};
