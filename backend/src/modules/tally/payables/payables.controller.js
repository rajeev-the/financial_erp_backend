import mongoose from "mongoose";
import Payable from "./payable.schema.js";
import CompanyBills from "../bills/bills.schema.js";
import Company from "../../companies/company.schema.js";
import { escapeRegex } from "../../../utils/escape-regex.js";
import { ApiError } from "../../../utils/api-error.js";
import { ok } from "../../../utils/response.js";
import { calculatePayablesService } from "./payables.services.js";

const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

export const getPayables = async (req, res, next) => {
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

    // Check if new Payable collection has records
    const payCount = await Payable.countDocuments(baseFilter);

    if (payCount > 0) {
      const payFilter = { ...baseFilter };
      if (party_name && party_name.trim()) {
        payFilter.party_name = {
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
        payFilter.bill_date = dateFilter;
      }

      const totalCount = await Payable.countDocuments(payFilter);
      const payables = await Payable.find(payFilter)
        .skip((Number(page) - 1) * Number(limit))
        .limit(Number(limit))
        .sort({ bill_date: -1, createdAt: -1 });

      const payAgg = await Payable.aggregate([
        { $match: payFilter },
        { $group: { _id: null, total: { $sum: { $abs: "$closing_amount" } } } },
      ]);
      const totalAmount = round2(payAgg[0]?.total ?? 0);

      const formatted = payables.map((p) => {
        const bal = Math.abs(p.closing_amount ?? 0);
        const bDate = p.bill_date;
        const bDue = p.bill_due;
        const pName = p.party_name;
        const bRef = p.bill_ref || p.bill_no || "";
        let oDays = p.overdue_days ?? 0;
        if (!oDays || oDays <= 0) {
          const targetDate = bDue || bDate;
          if (targetDate) {
            const diffTime = Date.now() - new Date(targetDate).getTime();
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays > 0) oDays = diffDays;
          }
        }

        return {
          id: p._id,
          party_name: pName,
          bill_ref: bRef,
          amount: bal,
          closing_amount: bal,
          total_balance: bal,
          due_date: bDue
            ? new Date(bDue).toISOString().split("T")[0]
            : bDate
              ? new Date(bDate).toISOString().split("T")[0]
              : "N/A",
          bill_due: bDue ? new Date(bDue).toISOString().split("T")[0] : "N/A",
          overdue_days: oDays,
          latest_bill_date: bDate
            ? new Date(bDate).toISOString().split("T")[0]
            : "N/A",
          bill_date: bDate
            ? new Date(bDate).toISOString().split("T")[0]
            : "N/A",
          bill_count: 1,
        };
      });

      return ok(
        res,
        {
          total_amount: totalAmount,
          count: formatted.length,
          total_count: totalCount,
          page: Number(page),
          limit: Number(limit),
          total_pages: Math.ceil(totalCount / Number(limit)) || 1,
          parties: formatted,
        },
        "Payables retrieved successfully",
      );
    }

    // Fallback to legacy CompanyBills
    const filter = {
      ...baseFilter,
      $or: [
        { final_balance: { $lt: 0 } },
        { closing_balance: { $lt: 0 } },
        { parent: { $regex: /creditors/i } },
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

    if (bills.length === 0 && compId) {
      try {
        const calcData = await calculatePayablesService({
          companyId: compId,
          from_date: startDate,
          to_date: endDate,
          party_name,
        });
        const vendors = calcData.vendors || [];
        if (vendors.length > 0) {
          const formattedVendors = vendors.map((v) => ({
            id: v.ledger_id || v._id,
            party_name: v.party_name,
            group_name: v.parent_group || "Sundry Creditors",
            amount: v.amount || Math.abs(v.closing_balance || 0),
            closing_amount: v.amount || Math.abs(v.closing_balance || 0),
            total_balance: v.amount || Math.abs(v.closing_balance || 0),
            due_date: v.due_date || "N/A",
            bill_due: v.due_date || "N/A",
            overdue_days: v.overdue_days || 0,
            latest_bill_date: v.latest_bill_date || "N/A",
            bill_date: v.bill_date || "N/A",
            bill_count: v.bill_count || 1,
          }));

          const calcTotalAmount = round2(calcData.total_payable || calcData.total_amount || 0);
          return ok(
            res,
            {
              total_amount: calcTotalAmount,
              count: formattedVendors.length,
              total_count: formattedVendors.length,
              page: Number(page),
              limit: Number(limit),
              total_pages: Math.ceil(formattedVendors.length / Number(limit)) || 1,
              parties: formattedVendors,
            },
            "Payables retrieved successfully",
          );
        }
      } catch (calcErr) {
        // Continue to legacy response if calculation fails
      }
    }

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
        amount: bal,
        due_date: b.bill_date
          ? new Date(b.bill_date).toISOString().split("T")[0]
          : "N/A",
        bill_count: 1,
      };
    });

    return ok(
      res,
      {
        total_amount: totalAmount,
        count: formatted.length,
        total_count: totalCount,
        page: Number(page),
        limit: Number(limit),
        total_pages: Math.ceil(totalCount / Number(limit)) || 1,
        parties: formatted,
      },
      "Payables retrieved successfully",
    );
  } catch (error) {
    next(error);
  }
};

export const getPayablesByPartyNameGroup = async (req, res, next) => {
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

    // Check if new Payable collection has records for this company
    const payCount = await Payable.countDocuments({
      company_id: targetCompanyId,
      is_deleted: { $ne: true },
    });

    if (payCount > 0) {
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

      const groupedPayables = await Payable.aggregate([
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

      const result = groupedPayables.map((p) => ({
        party_name: p.party_name || p._id,
        total_closing_amount: Number(
          Math.abs(p.total_closing_amount ?? 0).toFixed(2),
        ),
        total_number_of_bills: p.total_number_of_bills || 0,
        bills: (p.bills || []).map((b) => {
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
        "Payables grouped by party retrieved successfully",
      );
    }

    // Fallback to legacy CompanyBills
    const legacyFilter = {
      company_id: targetCompanyId,
      is_deleted: { $ne: true },
      $or: [
        { final_balance: { $lt: 0 } },
        { closing_balance: { $lt: 0 } },
        { parent: { $regex: /creditors/i } },
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
              $abs: {
                $ifNull: [
                  "$final_balance",
                  { $ifNull: ["$closing_balance", 0] },
                ],
              },
            },
          },
          total_number_of_bills: { $sum: 1 },
        },
      },
      {
        $sort: { total_closing_amount: -1, _id: 1 },
      },
    ]);

    const result = legacyGrouped.map((b) => ({
      party_name: b.party_name || b._id,
      total_closing_amount: Number(
        Math.abs(b.total_closing_amount ?? 0).toFixed(2),
      ),
      total_number_of_bills: b.total_number_of_bills || 0,
    }));

    return ok(res, result, "Payables grouped by party retrieved successfully");
  } catch (error) {
    next(error);
  }
};

export const getPayableCalculation = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { from_date, to_date, party_name, ledger_id } = req.query;

    if (!companyId) {
      throw ApiError.badRequest("Company ID is required");
    }

    const data = await calculatePayablesService({
      companyId,
      from_date,
      to_date,
      party_name,
      ledger_id,
    });

    return ok(res, data, "Payables calculated successfully");
  } catch (error) {
    next(error);
  }
};

export { getPayablesGstAndTds } from "./payablesGstTds.controller.js";
