import mongoose from "mongoose";
import Ledger from "./ledger.schema.js";
import LedgerBalanceDetails from "./ledgerBalanceDetails.schema.js";
import Company from "../../companies/company.schema.js";
import { ApiError } from "../../../utils/api-error.js";
import { ok } from "../../../utils/response.js";
import { escapeRegex } from "../../../utils/escape-regex.js";
import { parseTallyDate } from "../sync/format.helper.js";
import fieldExclusions from "../../common/fieldExclusions.js";
import Group from "../group/group.schema.js";
const getLedgerList = async (req, res, next) => {
  try {
    const { companyId } = req.params;

    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      throw ApiError.badRequest("A valid company ID is required");
    }
    const ledgerList = await Ledger.find({
      company_id: new mongoose.Types.ObjectId(companyId),
      is_deleted: { $ne: true },
    }).select(
      "name parent opening_balance classification guid closing_balance",
    );

    if (ledgerList.length === 0) {
      return ok(res, [], "No ledgers found");
    }

    return ok(res, ledgerList, "Ledger list retrieved successfully");
  } catch (error) {
    next(error);
  }
};

const getAllByCompanyId = async (req, res, next) => {
  try {
    const rawCompanyId = req.params.companyId;

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
      limit = 100,
      search = "",
      name = "",
      parent = "",
      classification = "",
      from_date,
      to_date,
      fromDate,
      toDate,
      from,
      to,
    } = req.query;

    const rawFrom = from_date || fromDate || from;
    const rawTo = to_date || toDate || to;
    const parsedFrom = rawFrom ? parseTallyDate(rawFrom) : null;
    const parsedTo = rawTo ? parseTallyDate(rawTo) : null;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 50));
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

    if (classification && classification.trim()) {
      filter.classification = {
        $regex: new RegExp(escapeRegex(classification.trim()), "i"),
      };
    }

    const [rawLedgers, totalCount] = await Promise.all([
      Ledger.find(filter)
        .select(fieldExclusions.ledger)
        .sort({ name: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Ledger.countDocuments(filter),
    ]);

    // Fetch balance details from the separate collection
    const ledgerIds = rawLedgers.map((l) => l._id);
    const allBalanceDetails = await LedgerBalanceDetails.find({
      ledger_id: { $in: ledgerIds },
    }).lean();

    // Group balance details by ledger_id
    const balanceByLedger = {};
    for (const bd of allBalanceDetails) {
      const key = String(bd.ledger_id);
      if (!balanceByLedger[key]) balanceByLedger[key] = [];
      balanceByLedger[key].push(bd);
    }

    const ledgers = rawLedgers.map((ledger) => {
      let balanceDetails = balanceByLedger[String(ledger._id)] || [];

      if (parsedFrom || parsedTo) {
        balanceDetails = balanceDetails.filter((b) => {
          if (!b) return false;
          const bFrom = b.from_date ? new Date(b.from_date) : null;
          const bTo = b.to_date ? new Date(b.to_date) : null;

          if (parsedFrom && bTo && bTo < parsedFrom) return false;
          if (parsedTo && bFrom && bFrom > parsedTo) return false;
          return true;
        });
      }

      const activeBalance =
        balanceDetails.length > 0
          ? balanceDetails[balanceDetails.length - 1]
          : null;

      return {
        ...ledger,
        balance_details: balanceDetails
      };
    });

    return ok(
      res,
      {
        total_count: totalCount,
        count: ledgers.length,
        page: pageNum,
        limit: limitNum,
        total_pages: Math.ceil(totalCount / limitNum) || 1,
        data: ledgers,
      },
      "Ledgers retrieved successfully",
    );
  } catch (error) {
    next(error);
  }
};

const getDebtorsDropdown = async (req, res, next) => {
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

    // 1. Find all group names under "Sundry Debtors"
    const rootGroups = await Group.find({
      company_id: resolvedCompanyId,
      is_deleted: { $ne: true },
      name: { $regex: /^sundry\s+debtors$/i },
    }).lean();

    const debtorGroupNames = new Set(rootGroups.map((g) => g.name));

    if (rootGroups.length > 0) {
      const childGroups = await Group.aggregate([
        {
          $match: {
            company_id: resolvedCompanyId,
            is_deleted: { $ne: true },
            $expr: {
              $in: [
                { $toLower: { $trim: { input: "$name" } } },
                rootGroups.map((g) => g.name.trim().toLowerCase()),
              ],
            },
          },
        },
        {
          $graphLookup: {
            from: "groups",
            startWith: { $trim: { input: "$name" } },
            connectFromField: "name",
            connectToField: "parent",
            as: "children",
            restrictSearchWithMatch: {
              company_id: resolvedCompanyId,
              is_deleted: { $ne: true },
            },
          },
        },
      ]);

      for (const cg of childGroups) {
        for (const child of cg.children || []) {
          debtorGroupNames.add(child.name);
        }
      }
    }

    debtorGroupNames.add("Sundry Debtors");

    const ledgers = await Ledger.find({
      company_id: resolvedCompanyId,
      is_deleted: { $ne: true },
      $or: [
        { parent: { $in: Array.from(debtorGroupNames) } },
        { parent: { $regex: /debtor/i } },
        { classification: { $regex: /debtor/i } },
      ],
    })
      .select("_id name parent state state_name country country_name country_of_residence mailing_details rule_id")
      .sort({ name: 1 })
      .lean();

    const normalizeCountry = (raw) => {
      if (!raw) return "India";
      const s = String(raw).trim();
      const lower = s.toLowerCase();
      if (lower === "usa" || lower.includes("united states")) return "United States of America";
      if (lower === "uae" || lower.includes("united arab")) return "United Arab Emirates";
      if (lower === "uk" || lower.includes("united kingdom")) return "United Kingdom";
      if (lower === "germany") return "Germany";
      if (lower === "india" || lower === "bharat") return "India";
      return s
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
    };

    const options = ledgers.map((l) => {
      const rawCountry = l.country_of_residence || l.country || l.country_name;
      const rawState = l.state || l.state_name || l.mailing_details?.[0]?.state || null;
      const country = rawCountry ? normalizeCountry(rawCountry) : (rawState ? "India" : "India");
      return {
        id: String(l._id),
        name: l.name,
        parent: l.parent,
        state: rawState,
        country: country,
        rule_id: l.rule_id || null,
      };
    });

    return ok(res, options, "Debtors options retrieved successfully");
  } catch (error) {
    next(error);
  }
};

export { getLedgerList, getAllByCompanyId, getDebtorsDropdown };