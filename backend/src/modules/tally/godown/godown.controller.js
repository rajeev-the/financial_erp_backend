import mongoose from "mongoose";
import Godown from "./godown.schema.js";
import Company from "../../companies/company.schema.js";
import { ApiError } from "../../../utils/api-error.js";
import { ok } from "../../../utils/response.js";
import { escapeRegex } from "../../../utils/escape-regex.js";

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
      parent = "",
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

    if (parent && parent.trim()) {
      filter.parent = {
        $regex: new RegExp(escapeRegex(parent.trim()), "i"),
      };
    }

    const [godowns, totalCount] = await Promise.all([
      Godown.find(filter)
        .sort({ name: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Godown.countDocuments(filter),
    ]);

    return ok(
      res,
      {
        total_count: totalCount,
        count: godowns.length,
        page: pageNum,
        limit: limitNum,
        total_pages: Math.ceil(totalCount / limitNum) || 1,
        data: godowns,
      },
      "Godowns retrieved successfully",
    );
  } catch (error) {
    next(error);
  }
};

export default {
  getAllByCompanyId,
};
