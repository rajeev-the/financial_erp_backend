import mongoose from "mongoose";
import CostCenter from "./costcenter.schema.js";
import Company from "../../companies/company.schema.js";
import { ApiError } from "../../../utils/api-error.js";
import { ok } from "../../../utils/response.js";
import { escapeRegex } from "../../../utils/escape-regex.js";
import fieldExclusions from "../../common/fieldExclusions.js";
export const getAllByCompanyId = async (req, res, next) => {
  try {
    const rawCompanyId =req.params.companyId;

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
      name = "",
      category = "",
    } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(50, Math.max(1, Number(limit) || 50));
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

    if (category && category.trim()) {
      filter.category = {
        $regex: new RegExp(escapeRegex(category.trim()), "i"),
      };
    }

    const [costCenters, totalCount] = await Promise.all([
      CostCenter.find(filter)
      .select(fieldExclusions.costcenter)
        .sort({ name: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      CostCenter.countDocuments(filter),
    ]);

    return ok(
      res,
      {
        total_count: totalCount,
        count: costCenters.length,
        page: pageNum,
        limit: limitNum,
        total_pages: Math.ceil(totalCount / limitNum) || 1,
        costcenters: costCenters,
        data: costCenters,
      },
      "Cost centers retrieved successfully",
    );
  } catch (error) {
    next(error);
  }
};

export default {
  getAllByCompanyId,
};
