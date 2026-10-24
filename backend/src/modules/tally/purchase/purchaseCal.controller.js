import { calculateAccountingService } from "../accounting/accounting.controller.js";
import { ok } from "../../../utils/response.js";
import mongoose from "mongoose";
import { ApiError } from "../../../utils/api-error.js";

const getPurchaseCal = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { from_date, to_date } = req.query;

    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      throw ApiError.badRequest("A valid company ID is required");
    }

    const data = await calculateAccountingService({
      companyId,
      requirement: "purchase",
      from_date,
      to_date,
    });

    return ok(res, data, "Purchase register retrieved successfully");
  } catch (error) {
    next(error);
  }
};

export { getPurchaseCal };