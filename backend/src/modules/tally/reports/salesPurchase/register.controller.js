import { getRegisterTotalsService } from "./register.service.js";
import { ok } from "../../../../utils/response.js";

export const getRegisterTotals = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { year, from_year, to_year, from_month, to_month, month } = req.query;

    const data = await getRegisterTotalsService({
      companyId: companyId || req.query.company_id || req.query.companyId,
      year,
      fromYear: from_year,
      toYear: to_year,
      fromMonth: from_month,
      toMonth: to_month,
      month,
    });

    return ok(res, data, "Register totals retrieved successfully");
  } catch (error) {
    next(error);
  }
};