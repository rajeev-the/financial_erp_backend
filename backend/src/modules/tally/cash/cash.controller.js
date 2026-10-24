import mongoose from "mongoose";
import { calculateCashBalanceService } from "./cash.service.js";
import { ApiError } from "../../../utils/api-error.js";
import { ok } from "../../../utils/response.js";

/**
 * Controller to get Cash Balance calculation for a company
 * Formula: Opening Balance + DR - CR
 */
export const getCashBalance = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const from_date = req.query?.from_date ?? req.body?.from_date;
    const to_date = req.query?.to_date ?? req.body?.to_date;

    if (!companyId) {
      throw ApiError.badRequest("Company ID is required");
    }

    const data = await calculateCashBalanceService({
      companyId,
      from_date,
      to_date,
    });

    return ok(res, data, "Cash balance calculated successfully");
  } catch (error) {
    if (typeof next === "function") {
      next(error);
    } else {
      throw error;
    }
  }
};

export default {
  getCashBalance,
};
