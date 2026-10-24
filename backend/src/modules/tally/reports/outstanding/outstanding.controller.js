import mongoose from "mongoose";
import Receivable from "../../receivables/receivable.schema.js";
import Payable from "../../payables/payable.schema.js";
import CompanyBills from "../../bills/bills.schema.js";
import Company from "../../../companies/company.schema.js";
import { escapeRegex } from "../../../../utils/escape-regex.js";
import { ApiError } from "../../../../utils/api-error.js";
import { ok } from "../../../../utils/response.js";

export const getPartyBillsDetails = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { party_name = "", page = 1, limit = 50 } = req.query;
    const compId = companyId || req.query.company_id || req.query.companyId;

    const filter = { is_deleted: false };
    if (compId && mongoose.Types.ObjectId.isValid(compId)) {
      filter.company_id = new mongoose.Types.ObjectId(compId);
    }

    if (party_name && party_name.trim()) {
      const recPartyFilter = {
        ...filter,
        party_name: {
          $regex: new RegExp(escapeRegex(party_name.trim()), "i"),
        },
      };
      const recCount = await Receivable.countDocuments(recPartyFilter);
      if (recCount > 0) {
        const totalCount = recCount;
        const bills = await Receivable.find(recPartyFilter)
          .skip((Number(page) - 1) * Number(limit))
          .limit(Number(limit))
          .sort({ bill_date: -1, createdAt: -1 });

        const totalAmt = bills.reduce(
          (acc, b) => acc + (b.closing_amount || 0),
          0,
        );

        const formatted = bills.map((b) => {
          const bDate = b.bill_date;
          const bDue = b.bill_due;
          const pName = b.party_name;
          const bRef = b.bill_ref;
          const bal = String(b.closing_amount ?? 0);

          return {
            id: b._id,
            company_id: b.company_id,
            party_name: pName,
            bill_name: bRef || pName,
            bill_ref: bRef,
            bill_date: bDate
              ? new Date(bDate).toISOString()
              : new Date().toISOString(),
            bill_due: bDue ? new Date(bDue).toISOString() : null,
            cleared_on: null,
            opening_balance: bal,
            closing_balance: bal,
            closing_amount: bal,
            final_balance: bal,
            pending_amount: bal,
            amount: bal,
            overdue_days: b.overdue_days ?? 0,
          };
        });

        return ok(
          res,
          {
            company_id: compId || null,
            party_name,
            total_bills: formatted.length,
            total_count: totalCount,
            total_amount: String(totalAmt),
            page: Number(page),
            limit: Number(limit),
            total_pages: Math.ceil(totalCount / Number(limit)) || 1,
            bills: formatted,
          },
          "Party bills retrieved successfully",
        );
      }

      const payPartyFilter = {
        ...filter,
        party_name: {
          $regex: new RegExp(escapeRegex(party_name.trim()), "i"),
        },
      };
      const payCount = await Payable.countDocuments(payPartyFilter);
      if (payCount > 0) {
        const totalCount = payCount;
        const bills = await Payable.find(payPartyFilter)
          .skip((Number(page) - 1) * Number(limit))
          .limit(Number(limit))
          .sort({ bill_date: -1, createdAt: -1 });

        const totalAmt = bills.reduce(
          (acc, b) => acc + (b.closing_amount || 0),
          0,
        );

        const formatted = bills.map((b) => {
          const bDate = b.bill_date;
          const bDue = b.bill_due;
          const pName = b.party_name;
          const bRef = b.bill_ref;
          const bal = String(b.closing_amount ?? 0);

          return {
            id: b._id,
            company_id: b.company_id,
            party_name: pName,
            bill_name: bRef || pName,
            bill_ref: bRef,
            bill_date: bDate
              ? new Date(bDate).toISOString()
              : new Date().toISOString(),
            bill_due: bDue ? new Date(bDue).toISOString() : null,
            cleared_on: null,
            opening_balance: bal,
            closing_balance: bal,
            closing_amount: bal,
            final_balance: bal,
            pending_amount: bal,
            amount: bal,
            overdue_days: b.overdue_days ?? 0,
          };
        });

        return ok(
          res,
          {
            company_id: compId || null,
            party_name,
            total_bills: formatted.length,
            total_count: totalCount,
            total_amount: String(totalAmt),
            page: Number(page),
            limit: Number(limit),
            total_pages: Math.ceil(totalCount / Number(limit)) || 1,
            bills: formatted,
          },
          "Party bills retrieved successfully",
        );
      }
    }

    if (party_name && party_name.trim()) {
      filter.name = {
        $regex: new RegExp(escapeRegex(party_name.trim()), "i"),
      };
    }

    const totalCount = await CompanyBills.countDocuments(filter);
    const bills = await CompanyBills.find(filter)
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .sort({ bill_date: -1 });

    const totalAmt = bills.reduce(
      (acc, b) => acc + (b.final_balance || b.closing_balance || 0),
      0,
    );
    const formatted = bills.map((b) => ({
      id: b._id,
      company_id: b.company_id,
      party_name: b.name,
      bill_name: b.bill_id || b.name,
      bill_date: b.bill_date
        ? new Date(b.bill_date).toISOString()
        : new Date().toISOString(),
      cleared_on: b.cleared_on ? new Date(b.cleared_on).toISOString() : null,
      opening_balance: String(b.opening_balance || 0),
      closing_balance: String(b.closing_balance || 0),
      final_balance: String(b.final_balance || 0),
      pending_amount: String(b.final_balance || b.closing_balance || 0),
      amount: String(b.final_balance || b.closing_balance || 0),
    }));

    return ok(
      res,
      {
        company_id: compId || null,
        party_name,
        total_bills: formatted.length,
        total_count: totalCount,
        total_amount: String(totalAmt),
        page: Number(page),
        limit: Number(limit),
        total_pages: Math.ceil(totalCount / Number(limit)) || 1,
        bills: formatted,
      },
      "Party bills retrieved successfully",
    );
  } catch (error) {
    next(error);
  }
};