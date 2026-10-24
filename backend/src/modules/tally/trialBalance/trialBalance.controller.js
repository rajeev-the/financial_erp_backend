import mongoose from "mongoose";
import { getTrialBalanceSummaryService } from "./trialBalance.service.js";
import { ok, fail } from "../../../utils/response.js";
import { ApiError } from "../../../utils/api-error.js";

export const getTrialBalanceSummary = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    let { from_date, to_date, fromDate, toDate, timeline, fy, targetYear } = req.query;

    const compId = companyId || req.query.company_id || req.query.companyId;
    if (!compId || !mongoose.Types.ObjectId.isValid(compId)) {
      throw ApiError.badRequest("A valid company ID is required");
    }

    let effFromDate = from_date || fromDate || null;
    let effToDate = to_date || toDate || null;
    const rawFy = fy || targetYear;

    if ((!effFromDate || !effToDate) && rawFy) {
      const fyStr = String(rawFy).trim().toLowerCase();
      if (fyStr !== "all" && fyStr !== "all years") {
        const match = fyStr.match(/\b(20\d\d)\b/);
        if (match) {
          const y = parseInt(match[1], 10);
          effFromDate = effFromDate || `${y}-04-01`;
          effToDate = effToDate || `${y + 1}-03-31`;
        }
      }
    }

    const selectedTimeline = timeline ? String(timeline).trim().toLowerCase() : null;

    if (selectedTimeline && selectedTimeline !== "year" && selectedTimeline !== "all") {
      return fail(res, "Invalid timeline. Expected 'all' or 'year'", 400);
    }

    const effectiveTimeline =
      selectedTimeline || (effFromDate || effToDate ? "year" : "all");

    const data = await getTrialBalanceSummaryService({
      companyId: compId,
      fromDate: effFromDate,
      toDate: effToDate,
      timeline: effectiveTimeline,
    });

    return ok(res, data, "Trial balance summary retrieved successfully");
  } catch (error) {
    next(error);
  }
};
