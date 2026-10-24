import mongoose from "mongoose";
import Voucher from "../voucher/voucher.schema.js";
import VoucherType from "../voucher/voucherType.schema.js";
import Ledger from "../ledger/ledger.schema.js";
import Company from "../../companies/company.schema.js";
import {calculateExpenseService} from "../Expense/expense.js"
import {
  MONTH_NAMES,
  FY_MONTH_ORDER,
  parseSafeDate,
  getFinancialYearFromDate,
} from "./summary.service.js";
import { calculateAccountingService } from "../accounting/accounting.controller.js";
import { computeVoucherAmountExpression } from "../voucher/voucher.controller.js";
import { getGeographicalRevenueService } from "./geographical.service.js";
import { ApiError } from "../../../utils/api-error.js";
import { ok } from "../../../utils/response.js";

export const getFinancialYear = async (req, res, next) => {
  try {
    const rawCompanyId =
      req.params.companyId ;


    if (!rawCompanyId) {
      throw ApiError.badRequest(
        "Company ID is required (pass as param or ?company_id=...)",
      );
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
      throw ApiError.notFound(
        `Company not found with identifier: ${rawCompanyId}`,
      );
    }

    const filter = {
      company_id: resolvedCompanyId,
      is_deleted: { $ne: true },
    };

    // Discover all financial years from Vouchers (or default to current FY if no vouchers)
    const [minVoucher, maxVoucher, totalVouchers] = await Promise.all([
      Voucher.findOne(filter).sort({ date: 1 }).select("date").lean(),
      Voucher.findOne(filter).sort({ date: -1 }).select("date").lean(),
      Voucher.countDocuments(filter),
    ]);

    const now = new Date();
    const currentFY = getFinancialYearFromDate(now);
    let minFY = currentFY;
    let maxFY = currentFY;

    if (minVoucher && maxVoucher) {
      const minDate = parseSafeDate(minVoucher.date) || now;
      const maxDate = parseSafeDate(maxVoucher.date) || now;
      minFY = getFinancialYearFromDate(minDate);
      maxFY = getFinancialYearFromDate(maxDate);
    }

    const financialYears = [];
    for (
      let fyStart = maxFY.start_year;
      fyStart >= minFY.start_year;
      fyStart--
    ) {
      const fyEnd = fyStart + 1;
      const fyKey = `${fyStart}-${fyEnd}`;
      const startDate = `${fyStart}-04-01`;
      const endDate = `${fyEnd}-03-31`;

      financialYears.push({
        financial_year: fyKey,
        label: `FY ${fyStart}-${String(fyEnd).slice(-2)}`,
        start_year: fyStart,
        end_year: fyEnd,
        start_date: startDate,
        end_date: endDate,
        is_current: fyStart === currentFY.start_year,
      });
    }

    return ok(
      res,
      {
        company_id: resolvedCompanyId,
        total_vouchers: totalVouchers,
        count: financialYears.length,
        financial_years: financialYears,
        start_date: minFY.start_year,
        end_date: maxFY.end_year,
      },
      "Company financial years retrieved successfully",
    );
  } catch (error) {
    next(error);
  }
};


export const getFinancialYearRevenueExpenseTrend = async (req, res, next) => {
  try {
    const rawCompanyId =
      req.params.companyId ||
      req.query.companyId ||
      req.query.company_id ||
      req.body?.companyId;

    if (!rawCompanyId) {
      throw ApiError.badRequest(
        "Company ID is required (pass as param or ?company_id=...)",
      );
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
      throw ApiError.notFound(
        `Company not found with identifier: ${rawCompanyId}`,
      );
    }

    const compIdFilter = resolvedCompanyId;
    const filter = {
      company_id: compIdFilter,
      is_deleted: { $ne: true },
    };

    // 1. Discover all financial years from Vouchers (or default to current FY)
    const [minVoucher, maxVoucher, totalVouchers] = await Promise.all([
      Voucher.findOne(filter).sort({ date: 1 }).select("date").lean(),
      Voucher.findOne(filter).sort({ date: -1 }).select("date").lean(),
      Voucher.countDocuments(filter),
    ]);

    const now = new Date();
    const currentFY = getFinancialYearFromDate(now);
    let minFY = currentFY;
    let maxFY = currentFY;

    if (minVoucher && maxVoucher) {
      const minDate = parseSafeDate(minVoucher.date) || now;
      const maxDate = parseSafeDate(maxVoucher.date) || now;
      minFY = getFinancialYearFromDate(minDate);
      maxFY = getFinancialYearFromDate(maxDate);
    }

    const rawTargetYear =
      req.query.targetYear ||
      req.query.year ||
      req.query.fy ||
      req.query.financial_year;
    const targetYear =
      rawTargetYear &&
      !["all", "all years", "all_years"].includes(
        String(rawTargetYear).trim().toLowerCase()
      )
        ? rawTargetYear
        : null;
    // 2. Build financial year items from maxFY down to minFY
    const financialYearsResult = [];

    for (
      let fyStart = maxFY.start_year;
      fyStart >= minFY.start_year;
      fyStart--
    ) {
      const fyEnd = fyStart + 1;
      const fyKey = `${fyStart}-${fyEnd}`;
      const startDate = `${fyStart}-04-01`;
      const endDate = `${fyEnd}-03-31`;

      // If user filtered by a specific year, skip financial years that don't match
      if (targetYear) {
        const q = String(targetYear).trim().toLowerCase();
        let matches = false;

        if (/^\d{4}$/.test(q)) {
          // A 4-digit year like 2026 matches the starting year (FY 2026-2027)
          matches = fyStart === Number(q);
        } else {
          matches =
            fyKey.toLowerCase().includes(q) ||
            `fy ${fyStart}-${String(fyEnd).slice(-2)}`.toLowerCase().includes(q) ||
            fyKey.replace("-", "").includes(q);
        }

        if (!matches) {
          continue;
        }
      }

      // Parallel calls to calculateAccountingService for "sales" (Revenue) and calculateExpenseService for total Expense
      const [salesResult, expenseResult] = await Promise.all([
        calculateAccountingService({
          companyId: resolvedCompanyId,
          requirement: "sales",
          from_date: startDate,
          to_date: endDate,
        }),
        calculateExpenseService({
          companyId: resolvedCompanyId,  
          from_date: startDate,
          to_date: endDate,
        }),
      ]);

      const totalRevenue = Math.round((Number(salesResult.amount) || 0) * 100) / 100;
      const totalExpense = Math.round((Number(expenseResult.amount ?? expenseResult.total_amount) || 0) * 100) / 100;
      const netProfitLoss = Math.round((totalRevenue - totalExpense) * 100) / 100;

      // Base financial year item
      const fyItem = {
        financial_year: fyKey,
        label: `FY ${fyStart}-${String(fyEnd).slice(-2)}`,
        start_year: fyStart,
        end_year: fyEnd,
        start_date: startDate,
        end_date: endDate,
        values: {
          total_revenue: totalRevenue,
          total_expense: totalExpense,
          net_profit_loss: netProfitLoss,
          is_profitable: netProfitLoss >= 0,
        },
      };

      // Compute and include monthly_trend for this financial year
      const voucherDateMap = new Map();
      const monthlyVoucherIds = new Map();

      for (const v of salesResult.vouchers || []) {
        if (v._id && v.date) {
          const vDate = new Date(v.date);
          voucherDateMap.set(String(v._id), vDate);
          if (!isNaN(vDate.getTime())) {
            const key = `${vDate.getFullYear()}-${vDate.getMonth() + 1}`;
            if (!monthlyVoucherIds.has(key)) monthlyVoucherIds.set(key, new Set());
            monthlyVoucherIds.get(key).add(String(v._id));
          }
        }
      }

      for (const v of expenseResult.vouchers || []) {
        if (v._id && v.date) {
          const vDate = new Date(v.date);
          voucherDateMap.set(String(v._id), vDate);
          if (!isNaN(vDate.getTime())) {
            const key = `${vDate.getFullYear()}-${vDate.getMonth() + 1}`;
            if (!monthlyVoucherIds.has(key)) monthlyVoucherIds.set(key, new Set());
            monthlyVoucherIds.get(key).add(String(v._id));
          }
        }
      }

      // Map monthly sales from ledger_entries
      const monthlySalesMap = new Map();
      for (const entry of salesResult.ledger_entries || []) {
        const vDate = voucherDateMap.get(String(entry.voucher_id));
        if (vDate && !isNaN(vDate.getTime())) {
          const key = `${vDate.getFullYear()}-${vDate.getMonth() + 1}`;
          const rawAmount = Math.abs(Number(entry.amount) || 0);
          monthlySalesMap.set(key, (monthlySalesMap.get(key) || 0) + rawAmount);
        }
      }

      // Map monthly expenses from ledger_entries
      const monthlyExpenseMap = new Map();
      for (const entry of expenseResult.ledger_entries || []) {
        const vDate = voucherDateMap.get(String(entry.voucher_id));
        if (vDate && !isNaN(vDate.getTime())) {
          const key = `${vDate.getFullYear()}-${vDate.getMonth() + 1}`;
          const rawAmount = Math.abs(Number(entry.amount) || 0);
          monthlyExpenseMap.set(key, (monthlyExpenseMap.get(key) || 0) + rawAmount);
        }
      }

      let fyVoucherCount = 0;

      const monthlyTrend = FY_MONTH_ORDER.map((m) => {
        const y = m >= 4 ? fyStart : fyEnd;
        const key = `${y}-${m}`;

        const mSales = Math.round(Math.max(0, monthlySalesMap.get(key) || 0) * 100) / 100;
        const mExpense = Math.round(Math.max(0, monthlyExpenseMap.get(key) || 0) * 100) / 100;
        const vCount = monthlyVoucherIds.get(key)?.size || 0;

        fyVoucherCount += vCount;

        return {
          month: m,
          month_name: MONTH_NAMES[m],
          year: y,
          period_label: `${MONTH_NAMES[m]} ${y}`,
          revenue: mSales,
          expense: mExpense,
          net_profit_loss: Math.round((mSales - mExpense) * 100) / 100,
          voucher_count: vCount,
        };
      });

      fyItem.monthly_trend = monthlyTrend;
      fyItem.voucher_count = fyVoucherCount;

      financialYearsResult.push(fyItem);
    }

    const responseData = {
      company_id: compIdFilter,
      total_vouchers: totalVouchers,
      count: financialYearsResult.length,
      financial_years: financialYearsResult,
    };

    if (targetYear && financialYearsResult.length === 1) {
      responseData.financial_year = financialYearsResult[0];
    }

    return ok(
      res,
      responseData,
      targetYear
        ? `Financial year ${targetYear} revenue and expense trend retrieved successfully`
        : "Financial years revenue and expense summary retrieved successfully",
    );
  } catch (error) {
    next(error);
  }
};

export const getGeographicalRevenueSummary = async (req, res, next) => {
  try {
    const rawCompanyId =
      req.params.companyId || req.query.company_id || req.query.companyId;

    if (!rawCompanyId) {
      throw ApiError.badRequest("Company ID is required");
    }

    const mode = String(req.query.mode || "sales").toLowerCase().trim();
    const targetYear = req.query.targetYear || req.query.fy || req.query.year;
    const from_date = req.query.from_date || null;
    const to_date = req.query.to_date || null;
    const tenant_id = req.user?.tenant_id || req.query.tenant_id;

    const data = await getGeographicalRevenueService({
      companyId: rawCompanyId,
      targetYear,
      mode,
      from_date,
      to_date,
      tenant_id,
    });

    return ok(res, data, "Geographical revenue retrieved successfully");
  } catch (error) {
    next(error);
  }
};

export const getAccountBookSummary = async (req, res, next) => {
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
      throw ApiError.notFound(`Company not found with identifier: ${rawCompanyId}`);
    }

    const table = String(
      req.query.table || req.query.tableName || "sales_register",
    )
      .toLowerCase()
      .trim();

    const tableToParentMap = {
      sales_register: "Sales",
      purchase_register: "Purchase",
      receipt_register: "Receipt",
      payment_register: "Payment",
      journal_register: "Journal",
      contra_register: "Contra",
      credit_notes: "Credit Note",
      credit_note_register: "Credit Note",
      debit_notes: "Debit Note",
      debit_note_register: "Debit Note",
    };

    const parentName =
      tableToParentMap[table] || req.query.voucher_type_parent || "Sales";

    // 1. Find matched voucher types
    const voucherTypes = await VoucherType.find({
      company_id: resolvedCompanyId,
      is_deleted: false,
      parent: parentName,
    })
      .collation({ locale: "en", strength: 2 })
      .select("name")
      .lean();

    const matchedNames = voucherTypes.map((vt) => vt.name);
    const targetVoucherTypes = [...new Set([...matchedNames, parentName])];

    // 2. Build filter
    const voucherFilter = {
      company_id: resolvedCompanyId,
      is_deleted: false,
      vchtype: { $in: targetVoucherTypes },
    };

    const { from_date, to_date, startDate, endDate, fy, targetYear, year } =
      req.query;
    const fromD = from_date || startDate;
    const toD = to_date || endDate;

    if (fromD || toD) {
      voucherFilter.date = {};
      if (fromD) voucherFilter.date.$gte = new Date(fromD);
      if (toD) {
        const end = new Date(toD);
        end.setHours(23, 59, 59, 999);
        voucherFilter.date.$lte = end;
      }
    } else {
      const rawFy = fy || targetYear || year;
      if (
        rawFy &&
        !["all", "all years", "all_years"].includes(
          String(rawFy).trim().toLowerCase(),
        )
      ) {
        const match = String(rawFy).match(/\b(20\d\d)\b/);
        if (match) {
          const startYear = parseInt(match[1], 10);
          const endYear = startYear + 1;
          voucherFilter.date = {
            $gte: new Date(Date.UTC(startYear, 3, 1, 0, 0, 0)),
            $lte: new Date(Date.UTC(endYear, 2, 31, 23, 59, 59, 999)),
          };
        }
      }
    }

    // 3. Aggregate metrics
    const [aggResult] = await Voucher.aggregate([
      { $match: voucherFilter },
      {
        $lookup: {
          from: "ledgerentries",
          localField: "_id",
          foreignField: "voucher_id",
          as: "ledgerentries",
        },
      },
      {
        $addFields: {
          computedAmount: computeVoucherAmountExpression,
        },
      },
      {
        $group: {
          _id: null,
          totalAmount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$is_cancelled", true] },
                    { $ne: ["$is_cancelled", 1] },
                  ],
                },
                { $abs: { $ifNull: ["$computedAmount", 0] } },
                0,
              ],
            },
          },
          activeCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$is_cancelled", true] },
                    { $ne: ["$is_cancelled", 1] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          cancelledCount: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ["$is_cancelled", true] },
                    { $eq: ["$is_cancelled", 1] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          largestVoucher: {
            $max: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$is_cancelled", true] },
                    { $ne: ["$is_cancelled", 1] },
                  ],
                },
                { $abs: { $ifNull: ["$computedAmount", 0] } },
                0,
              ],
            },
          },
          parties: { $addToSet: "$party_ledger_id" },
          minDate: { $min: "$date" },
          maxDate: { $max: "$date" },
        },
      },
    ]);

    const totalAmount = Math.round((aggResult?.totalAmount || 0) * 100) / 100;
    const activeCount = aggResult?.activeCount || 0;
    const cancelledCount = aggResult?.cancelledCount || 0;
    const largestVoucher =
      Math.round((aggResult?.largestVoucher || 0) * 100) / 100;
    const activePartiesCount = (aggResult?.parties || []).filter(Boolean).length;
    const averageAmount =
      activeCount > 0 ? Math.round((totalAmount / activeCount) * 100) / 100 : 0;
    const minDate = aggResult?.minDate
      ? new Date(aggResult.minDate).toISOString().split("T")[0]
      : "";
    const maxDate = aggResult?.maxDate
      ? new Date(aggResult.maxDate).toISOString().split("T")[0]
      : "";

    const isJournal = table === "journal_register";
    const isSales = table === "sales_register";
    const isPurchase = table === "purchase_register";
    const isReceipt = table === "receipt_register";
    const isPayment = table === "payment_register";

    const cards = isJournal
      ? [
          {
            key: "totalAmount",
            label: "Total",
            value: totalAmount,
            format: "currency",
          },
          {
            key: "voucherCount",
            label: "Journal Entries",
            value: activeCount + cancelledCount,
          },
          {
            key: "uniqueEntityCount",
            label: "Ledgers Impacted",
            value: activePartiesCount,
            helperText: `${activePartiesCount} ledgers impacted`,
          },
          {
            key: "averageAmount",
            label: "Avg Journal Value",
            value: averageAmount,
            format: "currency",
          },
        ]
      : [
          {
            key: "totalAmount",
            label: isSales
              ? "Total Sales"
              : isPurchase
              ? "Total Purchase"
              : isReceipt
              ? "Total Receipts"
              : isPayment
              ? "Total Payments"
              : "Total Value",
            value: totalAmount,
            format: "currency",
          },
          {
            key: "voucherCount",
            label: isSales
              ? "Sales Vouchers"
              : isPurchase
              ? "Purchase Vouchers"
              : isReceipt
              ? "Receipt Vouchers"
              : isPayment
              ? "Payment Vouchers"
              : "Voucher Count",
            value: activeCount + cancelledCount,
          },
          {
            key: "uniqueEntityCount",
            label: isSales
              ? "Active Customers"
              : isPurchase
              ? "Active Vendors"
              : "Active Parties",
            value: activePartiesCount,
            helperText: `${activePartiesCount} ${
              isSales
                ? "active customers"
                : isPurchase
                ? "active vendors"
                : "active parties"
            }`,
          },
          {
            key: "averageAmount",
            label: "Avg Invoice Value",
            value: averageAmount,
            format: "currency",
          },
        ];

    const response = {
      tableName: table,
      activeCount,
      cancelledCount,
      largestVoucher,
      dateRange: {
        from: minDate,
        to: maxDate,
      },
      cards,
    };

    return ok(res, response, "Account book summary retrieved successfully");
  } catch (error) {
    next(error);
  }
};