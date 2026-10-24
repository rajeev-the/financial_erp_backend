import mongoose from "mongoose";
import PurchaseRegister from "./purchaseRegister.schema.js";
import PurchaseAccount from "./purchaseAccount.schema.js";
import Company from "../../companies/company.schema.js";
import { ApiError } from "../../../utils/api-error.js";
import { ok } from "../../../utils/response.js";
import { escapeRegex } from "../../../utils/escape-regex.js";

const getPurchaseRegister = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { from_date, to_date } = req.query;
    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      throw ApiError.badRequest("A valid company ID is required");
    }
    const compIdFilter = new mongoose.Types.ObjectId(companyId);
    const purchaseRegisterDoc = await PurchaseRegister.findOne({
      company_id: compIdFilter,
      is_deleted: { $ne: true },
    }).lean();

    const rawData = purchaseRegisterDoc?.data || [];

    // Extract year and month from from_date / to_date
    const toKey = (year, month) => year * 100 + month;

    let fromKey = null;
    let toKey2 = null;

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
      "Purchase register retrieved successfully",
    );
  } catch (error) {
    next(error);
  }
};

const getAllByCompanyId = async (req, res, next) => {
  try {
    const rawCompanyId =
      req.params.companyId ||
      req.params.company_id ||
      req.query.company_id ||
      req.query.companyId ||
      req.query.guid ||
      req.query.company_guid;

    if (!rawCompanyId) {
      throw ApiError.badRequest("Company ID is required");
    }

    let resolvedCompanyId = null;
    if (mongoose.Types.ObjectId.isValid(rawCompanyId)) {
      resolvedCompanyId = new mongoose.Types.ObjectId(rawCompanyId);
    } else {
      const companyDoc = await Company.findOne({
        $or: [{ tally_company_guid: rawCompanyId }, { name: rawCompanyId }],
        is_deleted: { $ne: true },
      }).select("_id");
      if (companyDoc) {
        resolvedCompanyId = companyDoc._id;
      }
    }

    if (!resolvedCompanyId) {
      throw ApiError.notFound(`Company not found with identifier: ${rawCompanyId}`);
    }

    const {
      page = 1,
      limit = 50,
      search = "",
      account_name = "",
      accountName = "",
    } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(50, Math.max(1, Number(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const filter = {
      company_id: resolvedCompanyId,
      is_deleted: { $ne: true },
    };

    const searchText = search || account_name || accountName;
    if (searchText && searchText.trim()) {
      filter.accountName = {
        $regex: new RegExp(escapeRegex(searchText.trim()), "i"),
      };
    }

    const [purchaseAccounts, totalCount] = await Promise.all([
      PurchaseAccount.find(filter)
        .sort({ accountName: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      PurchaseAccount.countDocuments(filter),
    ]);

    return ok(
      res,
      {
        total_count: totalCount,
        count: purchaseAccounts.length,
        page: pageNum,
        limit: limitNum,
        total_pages: Math.ceil(totalCount / limitNum) || 1,
        purchase_accounts: purchaseAccounts,
        data: purchaseAccounts,
      },
      "Purchase accounts retrieved successfully",
    );
  } catch (error) {
    next(error);
  }
};

export { getPurchaseRegister, getAllByCompanyId };
export default { getPurchaseRegister, getAllByCompanyId };