import StockItem from "../tally/stock/stock.schema.js";
import StockGroup from "../tally/stock/stockgroup.schema.js";
import Ledger from "../tally/ledger/ledger.schema.js";
import Group from "../tally/group/group.schema.js";
import Unit from "../tally/unit/unit.schema.js";
import Godown from "../tally/godown/godown.schema.js";
import CostCenter from "../tally/costcenter/costcenter.schema.js";
import { resolveCompanyId } from "../tally/stock/stock.controller.js";
import { escapeRegex } from "../../utils/escape-regex.js";
import { ApiError } from "../../utils/api-error.js";

const extractCompanyId = (req) => {
  return (
    req.params.companyId ||
    req.params.company_id ||
    req.query.company_id ||
    req.query.companyId ||
    req.query.guid ||
    req.query.company_guid ||
    req.headers["x-company-id"]
  );
};

/* =========================================================
   STOCK GROUPS
   Route: GET /api/database/master/stock-groups
   Query: page, limit, company_id, search, name, parent
========================================================= */
export const getMasterStockGroups = async (req, res, next) => {
  try {
    const rawCompanyId = extractCompanyId(req);
    if (!rawCompanyId) {
      throw ApiError.badRequest("Company ID is required");
    }

    const resolvedCompanyId = await resolveCompanyId(rawCompanyId);
    if (!resolvedCompanyId) {
      throw ApiError.notFound(`Company not found with identifier: ${rawCompanyId}`);
    }

    const isAll = req.path.endsWith("/all");
    const {
      page = 1,
      limit = isAll ? 1000 : 50,
      search = "",
      name = "",
      parent = "",
    } = req.query;

    const pageNum = isAll ? 1 : Math.max(1, Number(page) || 1);
    const limitNum = isAll ? 5000 : Math.min(1000, Math.max(1, Number(limit) || 50));
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

    const formattedData = stockGroups.map((group) => {
      const gName = group.name || "";
      const gParent = group.parent || "Primary";
      const hsn = group.hsn_code || group.hsn || "";
      const taxRate = group.tax_rate ?? "";

      return {
        id: group._id,
        _id: group._id,
        guid: group.guid,
        name: gName,
        parent: gParent,
        parent_group: gParent,
        is_addable: group.is_addable ?? false,
        hsn_code: hsn,
        tax_rate: taxRate,
        Name: gName,
        Parent: gParent,
        HSNCode: hsn,
        TaxRate: taxRate,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
      };
    });

    return res.status(200).json({
      success: true,
      message: "Stock groups retrieved successfully",
      page: pageNum,
      limit: limitNum,
      totalRecords: totalCount,
      totalPages,
      total_count: totalCount,
      total_pages: totalPages,
      count: formattedData.length,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalRecords: totalCount,
        totalPages,
      },
      data: formattedData,
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
   STOCK ITEMS
   Route: GET /api/database/master/stock-items
   Query: page, limit, company_id, search, name, parent, category, base_unit
========================================================= */
export const getMasterStockItems = async (req, res, next) => {
  try {
    const rawCompanyId = extractCompanyId(req);
    if (!rawCompanyId) {
      throw ApiError.badRequest("Company ID is required");
    }

    const resolvedCompanyId = await resolveCompanyId(rawCompanyId);
    if (!resolvedCompanyId) {
      throw ApiError.notFound(`Company not found with identifier: ${rawCompanyId}`);
    }

    const isAll = req.path.endsWith("/all");
    const {
      page = 1,
      limit = isAll ? 1000 : 50,
      search = "",
      name = "",
      parent = "",
      category = "",
      base_unit = "",
      unit = "",
    } = req.query;

    const pageNum = isAll ? 1 : Math.max(1, Number(page) || 1);
    const limitNum = isAll ? 5000 : Math.min(1000, Math.max(1, Number(limit) || 50));
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

    const unitFilter = base_unit || unit;
    if (unitFilter && unitFilter.trim()) {
      filter.base_unit = {
        $regex: new RegExp(escapeRegex(unitFilter.trim()), "i"),
      };
    }

    const [stockItems, totalCount] = await Promise.all([
      StockItem.find(filter)
        .sort({ name: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      StockItem.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCount / limitNum) || 1;

    const formattedData = stockItems.map((item) => {
      const iName = item.name || "";
      const iParent = item.parent || "";
      const iUnit = item.base_unit || "";
      const iCategory = item.category || "";
      const itemCode = item.item_code || item.part_no || item.code || "";
      const hsnCode = item.hsn_code || item.gst_hsn_code || "";
      const taxRate = item.tax_rate ?? item.gst_rate ?? "";

      return {
        id: item._id,
        _id: item._id,
        guid: item.guid,
        name: iName,
        parent: iParent,
        stock_group: iParent,
        item_group: iParent,
        category: iCategory,
        unit: iUnit,
        base_unit: iUnit,
        base_units: iUnit,
        item_code: itemCode,
        hsn_code: hsnCode,
        tax_rate: taxRate,
        closing_balance_qty: item.closing_balance_qty ?? item.closing_balance ?? 0,
        standard_cost: item.standard_cost ?? 0,
        standard_price: item.standard_price ?? 0,
        closing_value: item.closing_value ?? 0,
        opening_balance_qty: item.opening_balance_qty ?? item.opening_balance ?? 0,
        opening_value: item.opening_value ?? 0,
        description: item.description || "",
        Name: iName,
        Parent: iParent,
        Unit: iUnit,
        Category: iCategory,
        ItemCode: itemCode,
        HSNCode: hsnCode,
        TaxRate: taxRate,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    });

    return res.status(200).json({
      success: true,
      message: "Stock items retrieved successfully",
      page: pageNum,
      limit: limitNum,
      totalRecords: totalCount,
      totalPages,
      total_count: totalCount,
      total_pages: totalPages,
      count: formattedData.length,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalRecords: totalCount,
        totalPages,
      },
      data: formattedData,
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
   LEDGERS
   Route: GET /api/database/master/ledgers
========================================================= */
export const getMasterLedgers = async (req, res, next) => {
  try {
    const rawCompanyId = extractCompanyId(req);
    if (!rawCompanyId) {
      throw ApiError.badRequest("Company ID is required");
    }

    const resolvedCompanyId = await resolveCompanyId(rawCompanyId);
    if (!resolvedCompanyId) {
      throw ApiError.notFound(`Company not found with identifier: ${rawCompanyId}`);
    }

    const isAll = req.path.endsWith("/all");
    const {
      page = 1,
      limit = isAll ? 1000 : 50,
      search = "",
      name = "",
      parent = "",
    } = req.query;

    const pageNum = isAll ? 1 : Math.max(1, Number(page) || 1);
    const limitNum = isAll ? 5000 : Math.min(1000, Math.max(1, Number(limit) || 50));
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

    const [ledgers, totalCount] = await Promise.all([
      Ledger.find(filter)
        .sort({ name: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Ledger.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCount / limitNum) || 1;

    const formattedData = ledgers.map((item) => ({
      id: item._id,
      _id: item._id,
      name: item.name,
      ledger_group: item.parent || item.ledger_group,
      parent: item.parent,
      classification: item.classification,
      opening_balance: item.opening_balance,
      closing_balance: item.closing_balance,
      is_revenue: item.is_revenue,
      is_deemed_positive: item.is_deemed_positive,
      Name: item.name,
      Parent: item.parent || item.ledger_group,
      OpeningBalance: item.opening_balance,
      ClosingBalance: item.closing_balance,
    }));

    return res.status(200).json({
      success: true,
      message: "Ledgers retrieved successfully",
      page: pageNum,
      limit: limitNum,
      totalRecords: totalCount,
      totalPages,
      total_count: totalCount,
      total_pages: totalPages,
      count: formattedData.length,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalRecords: totalCount,
        totalPages,
      },
      data: formattedData,
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
   GROUPS
   Route: GET /api/database/master/groups
========================================================= */
export const getMasterGroups = async (req, res, next) => {
  try {
    const rawCompanyId = extractCompanyId(req);
    if (!rawCompanyId) {
      throw ApiError.badRequest("Company ID is required");
    }

    const resolvedCompanyId = await resolveCompanyId(rawCompanyId);
    if (!resolvedCompanyId) {
      throw ApiError.notFound(`Company not found with identifier: ${rawCompanyId}`);
    }

    const isAll = req.path.endsWith("/all");
    const {
      page = 1,
      limit = isAll ? 1000 : 50,
      search = "",
      name = "",
      parent = "",
    } = req.query;

    const pageNum = isAll ? 1 : Math.max(1, Number(page) || 1);
    const limitNum = isAll ? 5000 : Math.min(1000, Math.max(1, Number(limit) || 50));
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

    const [groups, totalCount] = await Promise.all([
      Group.find(filter)
        .sort({ name: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Group.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCount / limitNum) || 1;

    const formattedData = groups.map((g) => ({
      id: g._id,
      _id: g._id,
      name: g.name,
      parent: g.parent || "Primary",
      is_revenue: g.is_revenue,
      is_deemed_positive: g.is_deemed_positive,
      Name: g.name,
      Parent: g.parent || "Primary",
    }));

    return res.status(200).json({
      success: true,
      message: "Groups retrieved successfully",
      page: pageNum,
      limit: limitNum,
      totalRecords: totalCount,
      totalPages,
      total_count: totalCount,
      total_pages: totalPages,
      count: formattedData.length,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalRecords: totalCount,
        totalPages,
      },
      data: formattedData,
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
   UNITS
   Route: GET /api/database/master/units
========================================================= */
export const getMasterUnits = async (req, res, next) => {
  try {
    const rawCompanyId = extractCompanyId(req);
    if (!rawCompanyId) {
      throw ApiError.badRequest("Company ID is required");
    }

    const resolvedCompanyId = await resolveCompanyId(rawCompanyId);
    if (!resolvedCompanyId) {
      throw ApiError.notFound(`Company not found with identifier: ${rawCompanyId}`);
    }

    const isAll = req.path.endsWith("/all");
    const { page = 1, limit = isAll ? 1000 : 50, search = "", name = "" } = req.query;

    const pageNum = isAll ? 1 : Math.max(1, Number(page) || 1);
    const limitNum = isAll ? 5000 : Math.min(1000, Math.max(1, Number(limit) || 50));
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

    const [units, totalCount] = await Promise.all([
      Unit.find(filter)
        .sort({ name: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Unit.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCount / limitNum) || 1;

    const formattedData = units.map((u) => ({
      id: u._id,
      _id: u._id,
      name: u.name,
      original_name: u.original_name,
      decimal_places: u.decimal_places,
      Name: u.name,
    }));

    return res.status(200).json({
      success: true,
      message: "Units retrieved successfully",
      page: pageNum,
      limit: limitNum,
      totalRecords: totalCount,
      totalPages,
      total_count: totalCount,
      total_pages: totalPages,
      count: formattedData.length,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalRecords: totalCount,
        totalPages,
      },
      data: formattedData,
    });
  } catch (error) {
    next(error);
  }
};
