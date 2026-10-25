import mongoose from "mongoose";
import UnifiedVoucher from "./voucher.unified.schema.js";
import AuditLog from "../audit/auditlog.schema.js";
import OutboundSyncQueue from "../sync/outboundSyncQueue.schema.js";
import {
  postSalesInvoiceService,
  postReceiptOrPaymentService,
} from "../posting/postingEngine.service.js";
import { ApiError } from "../../../utils/api-error.js";
import { ok } from "../../../utils/response.js";

/**
 * POST /api/v1/erp/vouchers/sales
 * Creates a validated, balanced sales invoice from client intent.
 */
export async function createSalesInvoiceController(req, res, next) {
  try {
    const { companyId, ...clientIntent } = req.body;
    const targetCompanyId = companyId || req.headers["x-company-id"] || req.query.companyId;

    if (!targetCompanyId) {
      throw ApiError.badRequest("companyId is required in body, header, or query");
    }

    const userId = req.user ? req.user._id : null;

    const result = await postSalesInvoiceService({
      companyId: targetCompanyId,
      clientIntent,
      userId,
    });

    res.status(result.isDuplicate ? 200 : 201).json({
      success: true,
      message: result.isDuplicate
        ? "Invoice already exists (idempotency key match)"
        : "Sales invoice created and posted successfully",
      isDuplicate: result.isDuplicate,
      data: result.voucher,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/erp/vouchers
 * List vouchers with optional filtering by company, type, status, date range.
 */
export async function getVouchersListController(req, res, next) {
  try {
    const {
      companyId,
      voucherType,
      status,
      paymentStatus,
      fromDate,
      toDate,
      search,
      page = 1,
      limit = 50,
    } = req.query;

    const targetCompanyId = companyId || req.headers["x-company-id"];
    if (!targetCompanyId) {
      throw ApiError.badRequest("companyId is required");
    }

    const filter = {
      companyId: new mongoose.Types.ObjectId(targetCompanyId),
    };

    if (voucherType) filter.voucherType = voucherType.toUpperCase();
    if (status) filter.status = status.toUpperCase();
    if (paymentStatus) filter.paymentStatus = paymentStatus.toUpperCase();

    if (fromDate || toDate) {
      filter.date = {};
      if (fromDate) filter.date.$gte = fromDate;
      if (toDate) filter.date.$lte = toDate;
    }

    if (search) {
      filter.$or = [
        { voucherNumber: new RegExp(search.trim(), "i") },
        { "party.name": new RegExp(search.trim(), "i") },
        { "party.gstin": new RegExp(search.trim(), "i") },
      ];
    }

    const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const take = Math.min(200, Math.max(1, parseInt(limit, 10)));

    const [vouchers, totalCount] = await Promise.all([
      UnifiedVoucher.find(filter)
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(take)
        .lean(),
      UnifiedVoucher.countDocuments(filter),
    ]);

    return ok(res, "Vouchers retrieved successfully", {
      total: totalCount,
      page: parseInt(page, 10),
      limit: take,
      vouchers,
    });
  } catch (err) {
    next(err);
  }
}

/**
/**
 * GET /api/v1/erp/vouchers/:id or /api/v1/erp/vouchers/:companyId/:id
 * Fetches full unified voucher document and formats it for Flutter mobile and API clients.
 */
export async function getVoucherByIdController(req, res, next) {
  try {
    const voucherId = req.params.id || req.params.voucherId;
    const companyId = req.params.companyId || req.query.company_id || req.query.companyId;

    if (!voucherId) {
      throw ApiError.badRequest("Voucher ID is required");
    }

    const queryConditions = [
      { "sync.tallyGuid": voucherId },
      { voucherNumber: voucherId },
    ];
    if (mongoose.Types.ObjectId.isValid(voucherId)) {
      queryConditions.unshift({ _id: new mongoose.Types.ObjectId(voucherId) });
    }

    const filter = { $or: queryConditions };
    if (companyId && mongoose.Types.ObjectId.isValid(companyId)) {
      filter.companyId = new mongoose.Types.ObjectId(companyId);
    }

    let voucher = await UnifiedVoucher.findOne(filter).lean();
    if (!voucher && filter.companyId) {
      voucher = await UnifiedVoucher.findOne({ $or: queryConditions }).lean();
    }

    if (!voucher) {
      throw ApiError.notFound("Voucher not found");
    }

    // Calculate tax breakdown
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    let totalCess = 0;

    if (Array.isArray(voucher.items) && voucher.items.length > 0) {
      for (const it of voucher.items) {
        totalCgst += it.cgst || 0;
        totalSgst += it.sgst || 0;
        totalIgst += it.igst || 0;
        totalCess += it.cess || 0;
      }
    }

    if (totalCgst === 0 && totalSgst === 0 && totalIgst === 0 && Array.isArray(voucher.entries)) {
      for (const ent of voucher.entries) {
        const name = (ent.name || "").toUpperCase();
        const amt = (ent.debit || 0) + (ent.credit || 0);
        if (name.includes("CGST")) totalCgst += amt;
        else if (name.includes("SGST")) totalSgst += amt;
        else if (name.includes("IGST")) totalIgst += amt;
        else if (name.includes("CESS")) totalCess += amt;
      }
    }

    const taxBreakdown = {
      cgst: Math.round(totalCgst) / 100,
      sgst: Math.round(totalSgst) / 100,
      igst: Math.round(totalIgst) / 100,
      cess: Math.round(totalCess) / 100,
      tds: 0,
      tcs: 0,
      other: 0,
      total: Math.round(voucher.summary?.taxTotal || (totalCgst + totalSgst + totalIgst + totalCess)) / 100,
    };

    const grossAmount = Math.round(voucher.summary?.grandTotal || 0) / 100;
    const netAmount = Math.round(voucher.summary?.subtotal || 0) / 100;
    const taxAmount = Math.round(voucher.summary?.taxTotal || 0) / 100;

    const billsAllocation = (voucher.allocations || []).map((a) => ({
      bill_type: "Ref",
      name: a.voucherNumber || voucher.voucherNumber,
      amount: (a.amount || 0) / 100,
    }));

    const ledgerentries = (voucher.entries || []).map((e) => {
      const isDr = (e.debit || 0) > 0;
      const signedAmt = isDr ? (e.debit / 100) : -(e.credit / 100);
      const absAmt = (isDr ? e.debit : e.credit) / 100;
      const isParty = String(e.ledgerId) === String(voucher.party?.ledgerId) ||
        (voucher.party?.name && e.name?.toLowerCase().trim() === voucher.party?.name?.toLowerCase().trim());

      return {
        ledger_name: e.name || "General Ledger",
        ledgerName: e.name || "General Ledger",
        ledger_id: e.ledgerId,
        amount: signedAmt,
        abs_amount: absAmt,
        absAmount: absAmt,
        is_deemed_positive: isDr,
        isDeemedPositive: isDr,
        is_party_ledger: isParty,
        isPartyLedger: isParty,
        bills_allocation: isParty ? billsAllocation : [],
      };
    });

    const inventoryentries = (voucher.items || []).map((item, idx) => ({
      line_number: idx + 1,
      stock_item_name: item.name || "Item",
      stockItemName: item.name || "Item",
      quantity: `${item.qty || 0} ${item.unit || "PCS"}`.trim(),
      rate: String(((item.rate || 0) / 100).toFixed(2)),
      amount: (item.total || item.taxableValue || 0) / 100,
      discount_amount: (item.discount || 0) / 100,
      discount_percentage: item.discountPct || 0,
      gst_rate: item.taxRate || 0,
      cgst_amount: (item.cgst || 0) / 100,
      sgst_amount: (item.sgst || 0) / 100,
      igst_amount: (item.igst || 0) / 100,
      cess_amount: (item.cess || 0) / 100,
      accounting_amount: (item.taxableValue || item.total || 0) / 100,
      accounting_isdeemedpositive: true,
      accountingIsDeemedPositive: true,
    }));

    const formattedVoucher = {
      ...voucher,
      id: voucher._id.toString(),
      _id: voucher._id.toString(),
      guid: voucher.sync?.tallyGuid || voucher._id.toString(),
      currency: voucher.currency || "INR",
      date: voucher.date,
      voucher_number: voucher.voucherNumber,
      voucherNumber: voucher.voucherNumber,
      voucher_type: voucher.voucherType,
      voucherType: voucher.voucherType,
      voucher_type_parent: voucher.voucherType,
      voucherTypeParent: voucher.voucherType,
      party_ledger_name: voucher.party?.name || "",
      partyLedgerName: voucher.party?.name || "",
      party_gstin: voucher.party?.gstin || "",
      partyGstin: voucher.party?.gstin || "",
      place_of_supply: voucher.gst?.placeOfSupply || "",
      placeOfSupply: voucher.gst?.placeOfSupply || "",
      narration: voucher.narration || "",
      is_cancelled: voucher.status === "CANCELLED",
      isCancelled: voucher.status === "CANCELLED",
      is_invoiced: true,
      isInvoiced: true,
      is_optional: false,
      isOptional: false,
      amount: grossAmount,
      gross_amount: grossAmount,
      grossAmount: grossAmount,
      net_amount: netAmount,
      netAmount: netAmount,
      tax_amount: taxAmount,
      taxAmount: taxAmount,
      tax_breakdown: taxBreakdown,
      taxBreakdown: taxBreakdown,
      ledgerentries,
      ledgerEntries: ledgerentries,
      ledger_entries: ledgerentries,
      inventoryentries,
      inventoryEntries: inventoryentries,
      inventory_entries: inventoryentries,
    };

    return ok(res, "Voucher fetched successfully", formattedVoucher);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/erp/vouchers/:id/cancel
 * Cancels a posted voucher with required cancellation reason.
 */
export async function cancelVoucherController(req, res, next) {
  try {
    const voucherId = req.params.id || req.params.voucherId;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      throw ApiError.badRequest("Cancellation reason is mandatory");
    }

    const voucher = await UnifiedVoucher.findById(voucherId);
    if (!voucher) {
      throw ApiError.notFound("Voucher not found");
    }

    if (voucher.status === "CANCELLED") {
      throw ApiError.badRequest("Voucher is already cancelled");
    }

    const beforeSnapshot = voucher.toObject();

    voucher.status = "CANCELLED";
    voucher.audit.cancelledAt = new Date();
    voucher.audit.cancelledBy = req.user ? req.user._id : null;
    voucher.audit.cancelReason = reason.trim();
    voucher.audit.version = (voucher.audit.version || 1) + 1;

    await voucher.save();

    // Log in immutable audit collection
    await AuditLog.create({
      companyId: voucher.companyId,
      voucherId: voucher._id,
      action: "CANCEL",
      userId: req.user ? req.user._id : null,
      before: beforeSnapshot,
      after: voucher.toObject(),
      reason: reason.trim(),
      at: new Date(),
    });

    // Enqueue cancel for Tally bridge if syncable
    if (voucher.sync && voucher.sync.source === "APP_DIRECT") {
      await OutboundSyncQueue.create({
        companyId: voucher.companyId,
        voucherId: voucher._id,
        operation: "CANCEL",
        status: "PENDING",
      });
    }

    return ok(res, "Voucher cancelled successfully", voucher);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/erp/vouchers/receipt
 * Records customer payment collection and settles invoices via allocations.
 */
export async function createReceiptVoucherController(req, res, next) {
  try {
    const { companyId, ...clientIntent } = req.body;
    const targetCompanyId = companyId || req.headers["x-company-id"] || req.query.companyId;

    if (!targetCompanyId) {
      throw ApiError.badRequest("companyId is required in body, header, or query");
    }

    const userId = req.user ? req.user._id : null;

    const result = await postReceiptOrPaymentService({
      companyId: targetCompanyId,
      voucherType: "RECEIPT",
      clientIntent,
      userId,
    });

    res.status(result.isDuplicate ? 200 : 201).json({
      success: true,
      message: result.isDuplicate
        ? "Receipt voucher already exists (idempotency match)"
        : "Receipt voucher created and posted successfully",
      isDuplicate: result.isDuplicate,
      data: result.voucher,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/erp/vouchers/payment
 * Records vendor payment and settles bills via allocations.
 */
export async function createPaymentVoucherController(req, res, next) {
  try {
    const { companyId, ...clientIntent } = req.body;
    const targetCompanyId = companyId || req.headers["x-company-id"] || req.query.companyId;

    if (!targetCompanyId) {
      throw ApiError.badRequest("companyId is required in body, header, or query");
    }

    const userId = req.user ? req.user._id : null;

    const result = await postReceiptOrPaymentService({
      companyId: targetCompanyId,
      voucherType: "PAYMENT",
      clientIntent,
      userId,
    });

    res.status(result.isDuplicate ? 200 : 201).json({
      success: true,
      message: result.isDuplicate
        ? "Payment voucher already exists (idempotency match)"
        : "Payment voucher created and posted successfully",
      isDuplicate: result.isDuplicate,
      data: result.voucher,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/erp/vouchers/unpaid
 * Fetches unpaid/partially paid vouchers for a party to populate payment settlement pickers.
 */
export async function getUnpaidVouchersController(req, res, next) {
  try {
    const { companyId, partyId, voucherType } = req.query;
    const targetCompanyId = companyId || req.headers["x-company-id"];

    if (!targetCompanyId || !partyId) {
      throw ApiError.badRequest("companyId and partyId are required");
    }

    const filter = {
      companyId: new mongoose.Types.ObjectId(targetCompanyId),
      "party.ledgerId": new mongoose.Types.ObjectId(partyId),
      status: "POSTED",
      paymentStatus: { $in: ["UNPAID", "PARTIAL"] },
    };

    if (voucherType) {
      filter.voucherType = voucherType.toUpperCase();
    }

    const unpaidVouchers = await UnifiedVoucher.find(filter)
      .sort({ date: 1 })
      .select("_id voucherNumber date dueDate summary paymentStatus")
      .lean();

    return ok(res, "Unpaid vouchers fetched successfully", unpaidVouchers);
  } catch (err) {
    next(err);
  }
}

