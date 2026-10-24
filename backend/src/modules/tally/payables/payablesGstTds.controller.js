import { calculatePayablesGstAndTdsService } from "./payablesGstTds.service.js";
import { ApiError } from "../../../utils/api-error.js";
import { ok } from "../../../utils/response.js";

/**
 * Controller to get Payables Bifurcation with GST and TDS
 * Route: GET /cal/gst-tds/:companyId
 * Route alias: GET /payablesgstandtds/:companyId
 */
export const getPayablesGstAndTds = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { from_date, to_date, party_name, page, limit } = req.query;

    if (!companyId) {
      throw ApiError.badRequest("Company ID is required");
    }

    const data = await calculatePayablesGstAndTdsService({
      companyId,
      from_date,
      to_date,
      party_name,
      page,
      limit,
    });

    return ok(res, data, "Payables GST and TDS bifurcation retrieved successfully");
  } catch (error) {
    next(error);
  }
};

export default {
  getPayablesGstAndTds,
};
