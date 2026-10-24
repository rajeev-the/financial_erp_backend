import mongoose from "mongoose";
import Receivable from "./receivable.schema.js";
import CompanyBills from "../bills/bills.schema.js";
import Company from "../../companies/company.schema.js";
import { escapeRegex } from "../../../utils/escape-regex.js";
import { ApiError } from "../../../utils/api-error.js";
import { ok } from "../../../utils/response.js";
import {
  calculateReceivablesService,
  calculateReceivablesByPartyService,
  classifyEntry,
  getDebtorBaselineBalances,
} from "./receivables.services.js";
import { resolveAccountingData } from "../accounting/accounting.resolver.js";
import Voucher from "../voucher/voucher.schema.js";

const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

export const getReceivablesByPartyNameGroup = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const {
      from_date,
      to_date,
      fromDate,
      toDate,
      party_name = "",
      search = "",
      q = "",
    } = req.query;
    const partySearch = party_name || search || q;

    const compId = companyId || req.query.company_id || req.query.companyId;

    if (!compId) {
      throw ApiError.badRequest("Company ID is required");
    }

    let targetCompanyId = null;
    if (mongoose.Types.ObjectId.isValid(compId)) {
      targetCompanyId = new mongoose.Types.ObjectId(compId);
    } else {
      const compDoc = await Company.findOne({
        $or: [{ tally_company_guid: compId }, { name: compId }],
        is_deleted: { $ne: true },
      }).select("_id");
      if (compDoc) {
        targetCompanyId = compDoc._id;
      }
    }

    if (!targetCompanyId) {
      throw ApiError.notFound("Company not found or invalid Company ID");
    }

    const startDate = from_date || fromDate;
    const endDate = to_date || toDate;

    // Check if new Receivable collection has records for this company
    const recCount = await Receivable.countDocuments({
      company_id: targetCompanyId,
      is_deleted: { $ne: true },
    });

    if (recCount > 0) {
      const matchStage = {
        company_id: targetCompanyId,
        is_deleted: { $ne: true },
      };

      if (partySearch && partySearch.trim()) {
        matchStage.party_name = {
          $regex: new RegExp(escapeRegex(partySearch.trim()), "i"),
        };
      }

      if (startDate || endDate) {
        const dateFilter = {};
        if (startDate) {
          dateFilter.$gte = new Date(startDate);
        }
        if (endDate) {
          const end = new Date(endDate);
          if (!String(endDate).includes("T")) {
            end.setHours(23, 59, 59, 999);
          }
          dateFilter.$lte = end;
        }
        matchStage.bill_date = dateFilter;
      }

      const groupedReceivables = await Receivable.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: "$party_name",
            party_name: { $first: "$party_name" },
            total_closing_amount: { $sum: "$closing_amount" },
            total_number_of_bills: { $sum: 1 },
            bills: {
              $push: {
                id: "$_id",
                bill_ref: "$bill_ref",
                bill_date: "$bill_date",
                bill_due: "$bill_due",
                closing_amount: "$closing_amount",
                overdue_days: "$overdue_days",
              },
            },
          },
        },
        {
          $sort: { total_closing_amount: -1, party_name: 1 },
        },
      ]);

      const result = groupedReceivables.map((r) => ({
        party_name: r.party_name || r._id,
        total_closing_amount: Number(Math.abs(r.total_closing_amount ?? 0).toFixed(2)),
        total_number_of_bills: r.total_number_of_bills || 0,
        bills: (r.bills || []).map((b) => {
          let oDays = b.overdue_days ?? 0;
          if (!oDays || oDays <= 0) {
            const targetDate = b.bill_due || b.bill_date;
            if (targetDate) {
              const diffTime = Date.now() - new Date(targetDate).getTime();
              const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
              if (diffDays > 0) oDays = diffDays;
            }
          }
          return {
            id: b.id,
            bill_ref: b.bill_ref,
            bill_date: b.bill_date
              ? new Date(b.bill_date).toISOString().split("T")[0]
              : "N/A",
            bill_due: b.bill_due
              ? new Date(b.bill_due).toISOString().split("T")[0]
              : "N/A",
            closing_amount: Number(Math.abs(b.closing_amount ?? 0).toFixed(2)),
            overdue_days: oDays,
          };
        }),
      }));

      return ok(
        res,
        result,
        "Receivables grouped by party retrieved successfully",
      );
    }

    // Fallback to legacy CompanyBills
    const legacyFilter = {
      company_id: targetCompanyId,
      is_deleted: { $ne: true },
      $or: [
        { final_balance: { $gt: 0 } },
        { closing_balance: { $gt: 0 } },
        { parent: { $regex: /debtors/i } },
      ],
    };

    if (partySearch && partySearch.trim()) {
      legacyFilter.name = {
        $regex: new RegExp(escapeRegex(partySearch.trim()), "i"),
      };
    }

    if (startDate || endDate) {
      const dateFilter = {};
      if (startDate) {
        dateFilter.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        if (!String(endDate).includes("T")) {
          end.setHours(23, 59, 59, 999);
        }
        dateFilter.$lte = end;
      }
      legacyFilter.bill_date = dateFilter;
    }

    const legacyGrouped = await CompanyBills.aggregate([
      { $match: legacyFilter },
      {
        $group: {
          _id: "$name",
          party_name: { $first: "$name" },
          total_closing_amount: {
            $sum: {
              $ifNull: ["$final_balance", { $ifNull: ["$closing_balance", 0] }],
            },
          },
          total_number_of_bills: { $sum: 1 },
          bills: {
            $push: {
              id: "$_id",
              bill_id: "$bill_id",
              bill_date: "$bill_date",
              closing_balance: {
                $ifNull: ["$final_balance", { $ifNull: ["$closing_balance", 0] }],
              },
            },
          },
        },
      },
      {
        $sort: { total_closing_amount: -1, _id: 1 },
      },
    ]);

    const result = legacyGrouped.map((b) => ({
      party_name: b.party_name || b._id,
      total_closing_amount: Number((b.total_closing_amount ?? 0).toFixed(2)),
      total_number_of_bills: b.total_number_of_bills || 0,
      bills: (b.bills || []).map((bill) => ({
        id: bill.id,
        bill_id: bill.bill_id,
        bill_date: bill.bill_date
          ? new Date(bill.bill_date).toISOString().split("T")[0]
          : "N/A",
        closing_amount: Number((bill.closing_balance ?? 0).toFixed(2)),
      })),
    }));

    return ok(
      res,
      result,
      "Receivables grouped by party retrieved successfully",
    );
  } catch (error) {
    next(error);
  }
};

export const getReceivables = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const {
      from_date,
      to_date,
      fromDate,
      toDate,
      page = 1,
      limit = 50,
      party_name = "",
    } = req.query;
    const compId = companyId || req.query.company_id || req.query.companyId;

    const baseFilter = { is_deleted: false };
    if (compId && mongoose.Types.ObjectId.isValid(compId)) {
      baseFilter.company_id = new mongoose.Types.ObjectId(compId);
    } else if (compId) {
      const compDoc = await Company.findOne({
        $or: [{ tally_company_guid: compId }, { name: compId }],
        is_deleted: { $ne: true },
      }).select("_id");
      if (compDoc) {
        baseFilter.company_id = compDoc._id;
      }
    }

    const startDate = from_date || fromDate;
    const endDate = to_date || toDate;

    // Check if new Receivable collection has records
    const recCount = await Receivable.countDocuments(baseFilter);

    if (recCount > 0) {
      const recFilter = { ...baseFilter };
      if (party_name && party_name.trim()) {
        recFilter.party_name = {
          $regex: new RegExp(escapeRegex(party_name.trim()), "i"),
        };
      }
      if (startDate || endDate) {
        const dateFilter = {};
        if (startDate) {
          dateFilter.$gte = new Date(startDate);
        }
        if (endDate) {
          const end = new Date(endDate);
          if (!String(endDate).includes("T")) {
            end.setHours(23, 59, 59, 999);
          }
          dateFilter.$lte = end;
        }
        recFilter.bill_date = dateFilter;
      }

      const totalCount = await Receivable.countDocuments(recFilter);
      const receivables = await Receivable.find(recFilter)
        .skip((Number(page) - 1) * Number(limit))
        .limit(Number(limit))
        .sort({ bill_date: -1, createdAt: -1 });

      const recAgg = await Receivable.aggregate([
        { $match: recFilter },
        { $group: { _id: null, total: { $sum: { $abs: "$closing_amount" } } } },
      ]);
      const totalAmount = round2(recAgg[0]?.total ?? 0);

      const formatted = receivables.map((r) => {
        const bal = Math.abs(r.closing_amount ?? 0);
        const bDate = r.bill_date;
        const bDue = r.bill_due;
        const pName = r.party_name;
        const bRef = r.bill_ref;
        let oDays = r.overdue_days ?? 0;
        if (!oDays || oDays <= 0) {
          const targetDate = bDue || bDate;
          if (targetDate) {
            const diffTime = Date.now() - new Date(targetDate).getTime();
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays > 0) oDays = diffDays;
          }
        }

        return {
          id: r._id,
          party_name: pName,
          bill_ref: bRef,
          closing_amount: bal,
          total_balance: bal,
          amount: bal,
          bill_due: bDue ? new Date(bDue).toISOString().split("T")[0] : "N/A",
          overdue_days: oDays,
          latest_bill_date: bDate
            ? new Date(bDate).toISOString().split("T")[0]
            : "N/A",
          bill_date: bDate
            ? new Date(bDate).toISOString().split("T")[0]
            : "N/A",
          total_bills: 1,
        };
      });

      return ok(
        res,
        {
          total_receivables_amount: totalAmount,
          total_amount: totalAmount,
          total_parties: formatted.length,
          total_count: totalCount,
          page: Number(page),
          limit: Number(limit),
          total_pages: Math.ceil(totalCount / Number(limit)) || 1,
          data: formatted,
        },
        "Receivables retrieved successfully",
      );
    }

    // Fallback to legacy CompanyBills
    const filter = {
      ...baseFilter,
      $or: [
        { final_balance: { $gt: 0 } },
        { closing_balance: { $gt: 0 } },
        { parent: { $regex: /debtors/i } },
      ],
    };

    if (party_name && party_name.trim()) {
      filter.name = {
        $regex: new RegExp(escapeRegex(party_name.trim()), "i"),
      };
    }

    if (startDate || endDate) {
      const dateFilter = {};
      if (startDate) {
        dateFilter.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        if (!String(endDate).includes("T")) {
          end.setHours(23, 59, 59, 999);
        }
        dateFilter.$lte = end;
      }
      filter.bill_date = dateFilter;
    }

    const totalCount = await CompanyBills.countDocuments(filter);
    const bills = await CompanyBills.find(filter)
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .sort({ bill_date: -1 });

    const totalAmount = bills.reduce((acc, b) => {
      const bal = b.final_balance ?? b.closing_balance ?? 0;
      return acc + Math.abs(bal);
    }, 0);

    const formatted = bills.map((b) => {
      const bal = Math.abs(b.final_balance ?? b.closing_balance ?? 0);
      return {
        id: b._id,
        party_name: b.name,
        group_name: b.parent,
        total_balance: bal,
        amount: bal,
        latest_bill_date: b.bill_date
          ? new Date(b.bill_date).toISOString().split("T")[0]
          : "N/A",
        total_bills: 1,
      };
    });

    return ok(
      res,
      {
        total_receivables_amount: totalAmount,
        total_amount: totalAmount,
        total_parties: formatted.length,
        total_count: totalCount,
        page: Number(page),
        limit: Number(limit),
        total_pages: Math.ceil(totalCount / Number(limit)) || 1,
        data: formatted,
      },
      "Receivables retrieved successfully",
    );
  } catch (error) {
    next(error);
  }
};

export const getPartyGroupLedgers = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const {party_name } = req.query
    const { page = 1, limit = 50 } = req.query;

    const targetPartyName = party_name ;

    if (!companyId) {
      throw ApiError.badRequest("Company ID is required");
    }

    if (!targetPartyName || !targetPartyName.trim()) {
      throw ApiError.badRequest("Party name is required");
    }

    // 1. Resolve Company ID
    let targetCompanyId = null;
    if (mongoose.Types.ObjectId.isValid(companyId)) {
      targetCompanyId = new mongoose.Types.ObjectId(companyId);
    } else {
      const compDoc = await Company.findOne({
        $or: [{ tally_company_guid: companyId }, { name: companyId }],
        is_deleted: { $ne: true },
      }).select("_id");
      if (compDoc) {
        targetCompanyId = compDoc._id;
      }
    }

    if (!targetCompanyId) {
      throw ApiError.notFound("Company not found or invalid Company ID");
    }

    // 2. Query Receivable for the party
    const matchFilter = {
      company_id: targetCompanyId,
      party_name: {
        $regex: new RegExp(`^${escapeRegex(targetPartyName.trim())}$`, "i"),
      },
      is_deleted: { $ne: true },
    };

    const totalCount = await Receivable.countDocuments(matchFilter);
    const bills = await Receivable.find(matchFilter)
      .sort({ bill_date: -1, createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    // 3. Compute total amount
    const totalAmount = bills.reduce(
      (acc, b) => acc + Math.abs(b.closing_amount ?? 0),
      0,
    );

    // 4. Format bills
    const formattedBills = bills.map((b) => {
      const bal = Math.abs(b.closing_amount ?? 0);
      return {
        id: b._id,
        party_name: b.party_name,
        bill_ref: b.bill_ref,
        closing_amount: bal,
        total_balance: bal,
        amount: bal,
        bill_date: b.bill_date
          ? new Date(b.bill_date).toISOString().split("T")[0]
          : "N/A",
        bill_due: b.bill_due
          ? new Date(b.bill_due).toISOString().split("T")[0]
          : "N/A",
        overdue_days: b.overdue_days ?? 0,
      };
    });

    return ok(
      res,
      {
        party_name: targetPartyName.trim(),
        total_receivables_amount: totalAmount,
        total_bills: totalCount,
        page: Number(page),
        limit: Number(limit),
        total_pages: Math.ceil(totalCount / Number(limit)) || 1,
        bills: formattedBills,
      },
      "Party ledgers retrieved successfully",
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Controller to calculate Receivables balance from "Sundry Debtors" ledger transactions
 * Flow: Sundry Debtors -> Sub-Groups -> Customer Ledgers -> Debit (Sales) & Credit (Receipts) -> Net Outstanding
 */
export const getReceivableCalculation = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { from_date, to_date, party_name, ledger_id } = req.query;

    if (!companyId) {
      throw ApiError.badRequest("Company ID is required");
    }

    const data = await calculateReceivablesService({
      companyId,
      from_date,
      to_date,
      party_name,
      ledger_id,
    });

    return ok(res, data, "Receivables calculated successfully");
  } catch (error) {
    next(error);
  }
};


/**
 * Controller to calculate Receivables grouped by Party
 * Route: GET /cal/party-group/:companyId
 */
export const getReceivablesfromParty = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { from_date, to_date, party_name, status, page, limit } = req.query;

    if (!companyId) {
      throw ApiError.badRequest("Company ID is required");
    }

    const data = await calculateReceivablesByPartyService({
      companyId,
      from_date,
      to_date,
      party_name,
      status,
      page,
      limit,
    });

    return ok(res, data, "Receivables by party calculated successfully");
  } catch (error) {
    next(error);
  }
};

export const getReceivablesMonthlyTrend = async (req, res, next) => {
  try {
    const rawCompanyId =
      req.params.companyId || req.query.company_id || req.query.companyId;

    if (!rawCompanyId) {
      throw ApiError.badRequest("Company ID is required");
    }

    let targetCompanyId = null;
    if (mongoose.Types.ObjectId.isValid(rawCompanyId)) {
      targetCompanyId = new mongoose.Types.ObjectId(rawCompanyId);
    } else {
      const compDoc = await Company.findOne({
        $or: [{ tally_company_guid: rawCompanyId }, { name: rawCompanyId }],
        is_deleted: { $ne: true },
      }).select("_id");
      if (compDoc) targetCompanyId = compDoc._id;
    }

    if (!targetCompanyId) {
      throw ApiError.notFound("Company not found or invalid Company ID");
    }

    // Discover company's voucher date range
    const [minVoucher, maxVoucher] = await Promise.all([
      Voucher.findOne({
        company_id: targetCompanyId,
        is_deleted: { $ne: true },
      })
        .sort({ date: 1 })
        .select("date")
        .lean(),
      Voucher.findOne({
        company_id: targetCompanyId,
        is_deleted: { $ne: true },
      })
        .sort({ date: -1 })
        .select("date")
        .lean(),
    ]);

    const now = new Date();
    const currentFYStart =
      now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;

    const getFYStart = (d) => {
      const dt = d ? new Date(d) : now;
      return dt.getMonth() >= 3 ? dt.getFullYear() : dt.getFullYear() - 1;
    };

    const minStartYear = minVoucher?.date
      ? getFYStart(minVoucher.date)
      : currentFYStart;
    const maxStartYear = maxVoucher?.date
      ? getFYStart(maxVoucher.date)
      : currentFYStart;

    const rawTargetYear = req.query.targetYear || req.query.fy || req.query.year;
    const isAllYears =
      rawTargetYear &&
      (String(rawTargetYear).trim().toLowerCase() === "all" ||
        String(rawTargetYear).trim().toLowerCase() === "all years");

    let isMultiYear = false;
    let startYear = currentFYStart;
    let endYear = currentFYStart + 1;

    if (isAllYears) {
      isMultiYear = true;
      startYear = minStartYear;
      endYear = maxStartYear + 1;
    } else if (rawTargetYear) {
      const match = String(rawTargetYear).match(/\b(20\d\d)\b/);
      if (match) {
        startYear = parseInt(match[1], 10);
        endYear = startYear + 1;
      } else {
        startYear = maxStartYear;
        endYear = startYear + 1;
      }
    } else {
      startYear = maxStartYear;
      endYear = startYear + 1;
    }

    const startDate = new Date(Date.UTC(startYear, 3, 1, 0, 0, 0));
    const endDate = new Date(Date.UTC(endYear, 2, 31, 23, 59, 59, 999));

    const accountingData = await resolveAccountingData({
      companyId: targetCompanyId,
      groupNames: ["Sundry Debtors"],
      fromDate: startDate,
      toDate: endDate,
    });

    const customerLedgerIds = (accountingData.ledgers || []).map((l) => l._id);
    const { balanceMap, baselineDate } = await getDebtorBaselineBalances(
      targetCompanyId,
      customerLedgerIds,
      startDate
    );

    let initialOpening = 0;
    for (const val of balanceMap.values()) {
      if (val > 0) initialOpening += val;
    }

    // Adjust opening balance with prior period vouchers if startDate is after baselineDate
    if (baselineDate && startDate > baselineDate) {
      const priorToDate = new Date(startDate.getTime() - 1);
      const priorData = await resolveAccountingData({
        companyId: targetCompanyId,
        groupNames: ["Sundry Debtors"],
        fromDate: baselineDate,
        toDate: priorToDate,
      });

      for (const entry of priorData.entries || []) {
        const { side, amount } = classifyEntry(entry);
        if (side === "debit") {
          initialOpening += amount;
        } else {
          initialOpening -= amount;
        }
      }
    }
    initialOpening = Math.max(0, Math.round(initialOpening * 100) / 100);

    // Map voucher ID -> voucher Date
    const voucherDateMap = new Map();
    for (const v of accountingData.vouchers || []) {
      if (v._id && v.date) {
        voucherDateMap.set(String(v._id), new Date(v.date));
      }
    }

    // Monthly debit and credit
    const monthlyCredit = new Map();
    const monthlyDebit = new Map();

    for (const entry of accountingData.entries || []) {
      const vDate = voucherDateMap.get(String(entry.voucher_id));
      if (!vDate || isNaN(vDate.getTime())) continue;

      const m = vDate.getMonth() + 1;
      const y = vDate.getFullYear();
      const key = `${y}-${m}`;

      const { side, amount } = classifyEntry(entry);
      if (side === "credit") {
        monthlyCredit.set(key, (monthlyCredit.get(key) || 0) + amount);
      } else {
        monthlyDebit.set(key, (monthlyDebit.get(key) || 0) + amount);
      }
    }

    const FY_MONTH_DEFS = [
      { month: 4, name: "Apr" },
      { month: 5, name: "May" },
      { month: 6, name: "Jun" },
      { month: 7, name: "Jul" },
      { month: 8, name: "Aug" },
      { month: 9, name: "Sep" },
      { month: 10, name: "Oct" },
      { month: 11, name: "Nov" },
      { month: 12, name: "Dec" },
      { month: 1, name: "Jan" },
      { month: 2, name: "Feb" },
      { month: 3, name: "Mar" },
    ];

    let runningPending = initialOpening;
    const trend = [];

    for (let yStart = startYear; yStart < endYear; yStart++) {
      const yEnd = yStart + 1;
      for (const { month, name } of FY_MONTH_DEFS) {
        const calYear = month >= 4 ? yStart : yEnd;
        const key = `${calYear}-${month}`;
        const rec = Math.round((monthlyCredit.get(key) || 0) * 100) / 100;
        const deb = Math.round((monthlyDebit.get(key) || 0) * 100) / 100;
        runningPending = Math.max(0, runningPending + deb - rec);
        const pend = Math.round(runningPending * 100) / 100;

        const label = isMultiYear
          ? `${name} '${String(calYear).slice(-2)}`
          : name;

        trend.push({
          month: label,
          monthName: name,
          monthNumber: month,
          year: calYear,
          financialYear: `${yStart}-${yEnd}`,
          received: rec,
          billed: deb,
          pending: pend,
        });
      }
    }

    return ok(res, trend, "Monthly receivables trend retrieved successfully");
  } catch (error) {
    next(error);
  }
};

export { getReceivablesGstAndTds } from "./receivablesGstTds.controller.js";
