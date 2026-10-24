import mongoose from "mongoose";
import StockItem from "../../tally/stock/stock.schema.js";
import Company from "../../companies/company.schema.js";
import { ApiError } from "../../../utils/api-error.js";

const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

async function resolveCompanyDoc(companyId) {
  if (!companyId) {
    throw ApiError.badRequest("Valid companyId is required");
  }
  let company = null;
  if (mongoose.Types.ObjectId.isValid(companyId)) {
    company = await Company.findById(companyId).select("name company_id").lean();
  }
  if (!company) {
    company = await Company.findOne({
      $or: [{ company_id: companyId }, { name: companyId }],
      is_deleted: { $ne: true },
    }).select("name company_id").lean();
  }
  if (!company) {
    throw ApiError.notFound("Company not found");
  }
  return company;
}

/**
 * Stock Summary & Valuation Service
 * Computes:
 * - Opening Quantity & Valuation
 * - Closing Quantity, Average Rate, and Closing Valuation
 * - Item group / category filtering and search
 */
export async function getStockSummaryReportService(params = {}) {
  const {
    companyId,
    search,
    q,
    parent,
    group,
    category,
    page = 1,
    limit = 50,
    sortBy = "value",
    sort_by,
    sortOrder = "desc",
    sort_order,
  } = params;

  const company = await resolveCompanyDoc(companyId);
  const targetCompanyId = company._id;

  const filter = {
    company_id: targetCompanyId,
    is_deleted: { $ne: true },
  };

  const searchKeyword = (search || q || "").trim();
  if (searchKeyword) {
    filter.$or = [
      { name: new RegExp(searchKeyword, "i") },
      { parent: new RegExp(searchKeyword, "i") },
      { category: new RegExp(searchKeyword, "i") },
    ];
  }

  const groupFilter = (parent || group || "").trim();
  if (groupFilter) {
    filter.parent = new RegExp(groupFilter, "i");
  }

  const catFilter = (category || "").trim();
  if (catFilter) {
    filter.category = new RegExp(catFilter, "i");
  }

  const items = await StockItem.find(filter).lean();

  let overallStockValue = 0;
  let overallItemCount = items.length;

  const formattedItems = items.map((item) => {
    const openQty = Number(item.opening_quantity) || 0;
    const openVal = Number(item.opening_value) || 0;
    const closeQty = Number(item.closing_quantity) || openQty;
    const closeVal = Number(item.closing_value) || openVal;
    const closeRate = Number(item.closing_rate) || (closeQty > 0 ? closeVal / closeQty : 0);

    overallStockValue += closeVal;

    return {
      id: item._id,
      name: item.name,
      parent: item.parent || "Primary",
      category: item.category || null,
      unit: item.base_unit || "Nos",
      openingQuantity: openQty,
      openingValue: round2(openVal),
      closingQuantity: closeQty,
      closingRate: round2(closeRate),
      closingValue: round2(closeVal),
    };
  });

  // Sort
  const effSort = (sortBy || sort_by || "value").toLowerCase();
  const effOrder = (sortOrder || sort_order || "desc").toLowerCase();

  formattedItems.sort((a, b) => {
    let cmp = 0;
    if (effSort === "name") {
      cmp = a.name.localeCompare(b.name);
    } else if (effSort === "quantity" || effSort === "qty") {
      cmp = a.closingQuantity - b.closingQuantity;
    } else {
      cmp = a.closingValue - b.closingValue;
    }
    return effOrder === "asc" ? cmp : -cmp;
  });

  const pageNum = Math.max(1, parseInt(page, 10));
  const rawLimit = String(limit).toLowerCase();
  const take = rawLimit === "all" || rawLimit === "0" ? overallItemCount : Math.min(200, Math.max(1, parseInt(limit, 10)));
  const skip = (pageNum - 1) * take;

  return {
    company_id: targetCompanyId,
    company_name: company.name,
    summary: {
      totalItemsCount: overallItemCount,
      totalStockValuation: round2(overallStockValue),
    },
    pagination: {
      total: overallItemCount,
      page: pageNum,
      limit: take,
      totalPages: Math.ceil(overallItemCount / take) || 1,
    },
    stockItems: formattedItems.slice(skip, skip + take),
  };
}
