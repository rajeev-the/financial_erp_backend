import mongoose from "mongoose";
import SalesRegister from "./salesRegister.schema.js";
import { ApiError } from "../../../utils/api-error.js";
import { ok } from "../../../utils/response.js";
import { calculateAccountingService } from "../accounting/accounting.controller.js";

const getSalesRegister = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { from_date, to_date } = req.query;
    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      throw ApiError.badRequest("A valid company ID is required");
    }
    const compIdFilter = new mongoose.Types.ObjectId(companyId);
    const salesRegisterDoc = await SalesRegister.findOne({
      company_id: compIdFilter,
      is_deleted: { $ne: true },
    }).lean();

    const rawData = salesRegisterDoc?.data || [];

    // Extract year and month from from_date / to_date
    const toKey = (year, month) => year * 100 + month;

    let fromKey = null;
    let toKey2  = null;

    if (from_date) {
      const d = new Date(from_date);
      fromKey = toKey(d.getFullYear(), d.getMonth() + 1);
    }
    if (to_date) {
      const d = new Date(to_date);
      toKey2 = toKey(d.getFullYear(), d.getMonth() + 1);
    }

    const filteredData = rawData.filter((item) => {
      if (!item) return false;

      const itemKey = toKey(Number(item.year), Number(item.month));

      if (fromKey && itemKey < fromKey) return false;
      if (toKey2 && itemKey > toKey2) return false;

      return true;
    });

    // ── Sort Chronologically ──────────────────────────────────────────────────
    filteredData.sort((a, b) => {
      return (
        toKey(Number(a.year), Number(a.month)) -
        toKey(Number(b.year), Number(b.month))
      );
    });

    // ── Compute Totals ────────────────────────────────────────────────────────
    let totalDebitAmount = 0;
    let totalCreditAmount = 0;
    let totalClosingAmount = 0;

    for (const item of filteredData) {
      totalDebitAmount += Number(item.debitAmount) || 0;
      totalCreditAmount += Number(item.creditAmount) || 0;
      totalClosingAmount += Number(item.closingAmount) || 0;
    }

    const round = (n) => Math.round(n * 100) / 100;

    // ── Respond ───────────────────────────────────────────────────────────────
    return ok(
      res,
      {
        company_id: companyId,
        filters: {
          from_date: from_date || null,
          to_date: to_date || null,
        },
        total_debit_amount: round(totalDebitAmount),
        total_credit_amount: round(totalCreditAmount),
        total_closing_amount: round(totalClosingAmount),
        count: filteredData.length,
        data: filteredData,
      },
      "Sales register retrieved successfully",
    );
  } catch (error) {
    next(error);
  }
};

const getsales = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { from_date, to_date } = req.query;
    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      throw ApiError.badRequest("A valid company ID is required");
    }
    const data = await calculateAccountingService({
      companyId,
      requirement: "sales",
      from_date,
      to_date,
    });

    return ok(res, data, "Sales register retrieved successfully");
  } catch (error) {
    next(error);
  }
};

export { getSalesRegister, getsales };
