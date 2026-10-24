import mongoose from "mongoose";
import { ACCOUNTING_CONFIG } from "./accounting.config.js";
import { resolveAccountingData } from "./accounting.resolver.js";
import {
  calculateTransaction,
  calculateBalance,
  calculateOutstanding,
} from "./accounting.calculator.js";
import { calculateCashBalanceService } from "../cash/cash.service.js";
import { calculateBankBalanceService } from "../bank/bank.service.js";
import { ApiError } from "../../../utils/api-error.js";
import { ok } from "../../../utils/response.js";

/**
 * Service function to calculate accounting data programmatically
 */
export const calculateAccountingService = async ({
  companyId,
  requirement,
  groups_name,
  from_date,
  to_date,
}) => {
  const rawRequirement = requirement?.trim()?.toLowerCase();
  const rawGroups = groups_name;

  let config = null;
  let groupNames = [];

  if (rawRequirement) {
    config = ACCOUNTING_CONFIG[rawRequirement];

    if (!config) {
      throw ApiError.badRequest(
        `Unsupported requirement: ${rawRequirement}. Supported: ${Object.keys(
          ACCOUNTING_CONFIG
        ).join(", ")}`
      );
    }

    groupNames = config.groups;
  } else if (rawGroups) {
    if (Array.isArray(rawGroups)) {
      groupNames = rawGroups;
    } else if (typeof rawGroups === "string") {
      try {
        const parsed = JSON.parse(rawGroups);
        groupNames = Array.isArray(parsed) ? parsed : [rawGroups];
      } catch {
        groupNames = rawGroups
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }

    config = {
      type: "transaction",
      groups: groupNames,
      side: "debit",
      normal_side: "debit",
    };
  } else {
    throw ApiError.badRequest(
      "Either requirement (e.g., 'sales', 'purchase', 'expense') or groups_name is required"
    );
  }

  const targetCompanyId = mongoose.Types.ObjectId.isValid(companyId)
    ? new mongoose.Types.ObjectId(companyId)
    : companyId;

  // ------------------------------------------------
  // Dates
  // ------------------------------------------------
  let fromDate = null;
  let toDate = null;

  if (from_date) {
    fromDate = new Date(from_date);
  }

  if (to_date) {
    toDate = new Date(to_date);
    toDate.setHours(23, 59, 59, 999);
  }

  // ------------------------------------------------
  // Resolve accounting data
  // ------------------------------------------------
  const data = await resolveAccountingData({
    companyId: targetCompanyId,
    groupNames,
    fromDate,
    toDate,
  });

  // ------------------------------------------------
  // Calculate
  // ------------------------------------------------
  if (rawRequirement === "cash") {
    const cashData = await calculateCashBalanceService({
      companyId: targetCompanyId,
      from_date,
      to_date,
    });

    return {
      requirement: "cash",
      type: "balance",
      searched_groups: groupNames,
      ...cashData,
    };
  }

  if (rawRequirement === "bank") {
    const bankData = await calculateBankBalanceService({
      companyId: targetCompanyId,
      from_date,
      to_date,
    });

    return {
      requirement: "bank",
      type: "balance",
      searched_groups: groupNames,
      ...bankData,
    };
  }

  let calculation;

  if (config.type === "transaction") {
    calculation = calculateTransaction({
      entries: data.entries,
      ledgers: data.ledgers,
      side: config.side,
    });
  } else if (config.type === "outstanding") {
    calculation = calculateOutstanding({
      entries: data.entries,
      ledgers: data.ledgers,
      vouchers: data.vouchers,
      normalSide: config.normal_side || "debit",
    });
  } else {
    calculation = calculateBalance({
      entries: data.entries,
      normalSide: config.normal_side || "debit",
    });
  }

  return {
    requirement: rawRequirement || "custom",
    type: config.type,
    searched_groups: groupNames,

    groups_count: data.groups.length,
    groups: data.groups,

    ledgers_count: data.ledgers.length,
    ledgers: data.ledgers,

    vouchers_count: data.vouchers.length,
    vouchers: data.vouchers,

    ledger_entries_count: data.entries.length,
    ledger_entries: data.entries,

    ...calculation,
  };
};

/**
 * Express Controller / Dual Helper Handler
 * Supports:
 * 1. Express route handler: getAccountingData(req, res, next)
 * 2. Direct programmatic invocation: await getAccountingData(companyId, requirement, from_date, to_date)
 */
export const getAccountingData = async (req, res, next) => {
  // Direct programmatic call check (e.g. getAccountingData(companyId, "sales", from_date, to_date))
  if (typeof req === "string" || req instanceof mongoose.Types.ObjectId || !req?.params) {
    const companyId = req;
    const requirement = typeof res === "string" ? res : "sales";
    const from_date = typeof next === "string" ? next : undefined;
    const to_date = arguments[3];

    return calculateAccountingService({
      companyId,
      requirement,
      from_date,
      to_date,
    });
  }

  try {
    const { companyId } = req.params;
    const requirement = req.body?.requirement ?? req.query?.requirement;
    const groups_name = req.body?.groups_name ?? req.query?.groups_name;
    const from_date = req.body?.from_date ?? req.query?.from_date;
    const to_date = req.body?.to_date ?? req.query?.to_date;

    const data = await calculateAccountingService({
      companyId,
      requirement,
      groups_name,
      from_date,
      to_date,
    });

    return ok(res, data, "Accounting data retrieved successfully");
  } catch (error) {
    if (typeof next === "function") {
      next(error);
    } else {
      throw error;
    }
  }
};

export default {
  calculateAccountingService,
  getAccountingData,
};
