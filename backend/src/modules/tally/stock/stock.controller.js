import mongoose from "mongoose";
import StockItem from "./stock.schema.js";
import StockGroup from "./stockgroup.schema.js";
import InventoryEntry from "../voucher/inventoryentry.schema.js";
import Voucher from "../voucher/voucher.schema.js";
import VoucherType from "../voucher/voucherType.schema.js";
import Company from "../../companies/company.schema.js";
import { ApiError } from "../../../utils/api-error.js";
import { ok } from "../../../utils/response.js";
import { escapeRegex } from "../../../utils/escape-regex.js";

const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

export const resolveCompanyId = async (rawCompanyId) => {
  if (!rawCompanyId) return null;

  if (mongoose.Types.ObjectId.isValid(rawCompanyId)) {
    return new mongoose.Types.ObjectId(rawCompanyId);
  }

  // Handle case where string has an accidental extra character (e.g. 25-char copy-paste typo)
  if (typeof rawCompanyId === "string" && rawCompanyId.length === 25) {
    const candidates = Array.from(
      new Set(
        Array.from({ length: 25 }, (_, i) => rawCompanyId.slice(0, i) + rawCompanyId.slice(i + 1))
          .filter((s) => mongoose.Types.ObjectId.isValid(s)),
      ),
    );
    if (candidates.length > 0) {
      const match = await Company.findOne({
        _id: { $in: candidates.map((id) => new mongoose.Types.ObjectId(id)) },
        is_deleted: { $ne: true },
      }).select("_id");
      if (match) return match._id;
    }
  }

  const companyDoc = await Company.findOne({
    $or: [{ tally_company_guid: rawCompanyId }, { name: rawCompanyId }],
    is_deleted: { $ne: true },
  }).select("_id");

  return companyDoc ? companyDoc._id : null;
};

export const getAllByCompanyId = async (req, res, next) => {
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

    const resolvedCompanyId = await resolveCompanyId(rawCompanyId);

    if (!resolvedCompanyId) {
      throw ApiError.notFound(`Company not found with identifier: ${rawCompanyId}`);
    }

    const {
      page = 1,
      limit = 50,
      search = "",
      name = "",
      parent = "",
      category = "",
      base_unit = "",
    } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(1000, Math.max(1, Number(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const filter = {
      company_id: resolvedCompanyId,
      is_deleted: { $ne: true },
    };

    const searchText = search || name;
    if (searchText && searchText.trim()) {
      filter.name = {
        $regex: new RegExp(escapeRegex(searchText.trim()), "i"),
      };
    }

    if (parent && parent.trim()) {
      filter.parent = {
        $regex: new RegExp(escapeRegex(parent.trim()), "i"),
      };
    }

    if (category && category.trim()) {
      filter.category = {
        $regex: new RegExp(escapeRegex(category.trim()), "i"),
      };
    }

    if (base_unit && base_unit.trim()) {
      filter.base_unit = {
        $regex: new RegExp(escapeRegex(base_unit.trim()), "i"),
      };
    }

    const [stockItems, totalCount, openingAgg] = await Promise.all([
      StockItem.find(filter)
        .sort({ name: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      StockItem.countDocuments(filter),
      StockItem.aggregate([
        { $match: filter },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$opening_value", 0] } } } },
      ]),
    ]);

    const totalOpeningValue = round2(openingAgg[0]?.total ?? 0);

    const enrichedItems = stockItems.map((s) => {
      const openVal = Number(s.opening_value) || 0;
      const openQty = Number(s.opening_quantity) || 0;
      const openRate = Number(s.opening_rate) || (openQty > 0 ? round2(openVal / openQty) : 0);
      const cat = s.category || s.parent || "General";
      return {
        ...s,
        id: s._id,
        name: s.name,
        itemName: s.name,
        unitName: s.base_unit || s.unit_name || "",
        category: cat,
        categoryName: cat,
        groupName: s.parent || cat,
        openingValue: openVal,
        closingValue: openVal,
        opening_value: openVal,
        closing_value: openVal,
        qty: openQty,
        rate: openRate,
      };
    });

    const totalPages = Math.ceil(totalCount / limitNum) || 1;

    return ok(
      res,
      {
        total_count: totalCount,
        count: enrichedItems.length,
        total_stock_items: totalCount,
        total_opening_value: totalOpeningValue,
        total_closing_value: totalOpeningValue,
        page: pageNum,
        limit: limitNum,
        total_pages: totalPages,
        totalRecords: totalCount,
        totalPages,
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalRecords: totalCount,
          totalPages,
        },
        stock_items: enrichedItems,
        items: enrichedItems,
        data: enrichedItems,
      },
      "Stock items retrieved successfully",
    );
  } catch (error) {
    next(error);
  }
};

export const getAllStockGroupsByCompanyId = async (req, res, next) => {
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

    const resolvedCompanyId = await resolveCompanyId(rawCompanyId);

    if (!resolvedCompanyId) {
      throw ApiError.notFound(`Company not found with identifier: ${rawCompanyId}`);
    }

    const {
      page = 1,
      limit = 50,
      search = "",
      name = "",
      parent = "",
    } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(1000, Math.max(1, Number(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const filter = {
      company_id: resolvedCompanyId,
      is_deleted: { $ne: true },
    };

    const searchText = search || name;
    if (searchText && searchText.trim()) {
      filter.name = {
        $regex: new RegExp(escapeRegex(searchText.trim()), "i"),
      };
    }

    if (parent && parent.trim()) {
      filter.parent = {
        $regex: new RegExp(escapeRegex(parent.trim()), "i"),
      };
    }

    const [stockGroups, totalCount] = await Promise.all([
      StockGroup.find(filter)
        .sort({ name: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      StockGroup.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCount / limitNum) || 1;

    return ok(
      res,
      {
        total_count: totalCount,
        count: stockGroups.length,
        page: pageNum,
        limit: limitNum,
        total_pages: totalPages,
        totalRecords: totalCount,
        totalPages,
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalRecords: totalCount,
          totalPages,
        },
        stock_groups: stockGroups,
        data: stockGroups,
      },
      "Stock groups retrieved successfully",
    );
  } catch (error) {
    next(error);
  }
};

export const getTopSellingStockItems = async (req, res, next) => {
  try {
    const rawCompanyId =
      req.params.companyId || req.query.company_id || req.query.companyId;

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
      if (companyDoc) resolvedCompanyId = companyDoc._id;
    }

    if (!resolvedCompanyId) {
      throw ApiError.notFound("Company not found");
    }

    const targetYear = req.query.targetYear || req.query.fy || req.query.year;
    let startDate = req.query.from_date || null;
    let endDate = req.query.to_date || null;

    if ((!startDate || !endDate) && targetYear) {
      const match = String(targetYear).match(/\b(20\d\d)\b/);
      if (match) {
        const y = parseInt(match[1], 10);
        startDate = `${y}-04-01`;
        endDate = `${y + 1}-03-31`;
      }
    }

    // 1. Fetch matching sales voucher types
    const salesVoucherTypes = await VoucherType.find({
      company_id: resolvedCompanyId,
      is_deleted: false,
      parent: "Sales",
    })
      .select("name")
      .lean();

    const salesTypeNames = [
      ...new Set([...salesVoucherTypes.map((v) => v.name), "Sales"]),
    ];

    const voucherFilter = {
      company_id: resolvedCompanyId,
      is_deleted: false,
      is_cancelled: false,
      vchtype: { $in: salesTypeNames },
    };

    if (startDate && endDate) {
      voucherFilter.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const salesVoucherIds = await Voucher.find(voucherFilter).distinct("_id");

    const inventoryMatch = {
      company_id: resolvedCompanyId,
      is_deleted: { $ne: true },
    };

    if (salesVoucherIds.length > 0) {
      inventoryMatch.voucher_id = { $in: salesVoucherIds };
    }

    // 2. Aggregate sales by stock item
    const aggregatedItems = await InventoryEntry.aggregate([
      { $match: inventoryMatch },
      {
        $group: {
          _id: "$stock_item_name",
          revenue: { $sum: { $abs: "$amount" } },
          vouchersCount: { $sum: 1 },
          unit: { $first: "$unit_name" },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
    ]);

    if (aggregatedItems && aggregatedItems.length > 0) {
      const formatted = aggregatedItems.map((item) => ({
        itemName: item._id,
        serviceName: item._id,
        stockItemName: item._id,
        quantity: item.vouchersCount,
        revenue: Math.round(Number(item.revenue || 0) * 100) / 100,
        amount: Math.round(Number(item.revenue || 0) * 100) / 100,
        unit: item.unit || "",
      }));

      return ok(res, formatted, "Top selling items retrieved successfully");
    }

    // 3. Fallback to StockItem closing value if no sales inventory entries exist
    const fallbackStockItems = await StockItem.find({
      company_id: resolvedCompanyId,
      is_deleted: { $ne: true },
    })
      .sort({ closing_value: -1 })
      .limit(10)
      .lean();

    const fallbackFormatted = fallbackStockItems.map((item) => ({
      itemName: item.name,
      serviceName: item.name,
      stockItemName: item.name,
      quantity: Number(item.closing_balance || item.opening_balance || 0),
      revenue: Math.abs(Number(item.closing_value || item.opening_value || 0)),
      amount: Math.abs(Number(item.closing_value || item.opening_value || 0)),
      unit: item.base_unit || "",
    }));

    return ok(res, fallbackFormatted, "Top selling items retrieved successfully");
  } catch (error) {
    next(error);
  }
};

export default {
  getAllByCompanyId,
  getAllStockGroupsByCompanyId,
  getTopSellingStockItems,
};
