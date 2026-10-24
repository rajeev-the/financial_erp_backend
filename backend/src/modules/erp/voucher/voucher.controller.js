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
 * GET /api/v1/erp/vouchers/:id
 * Fetches full voucher document by ID (zero joins needed!).
 */
export async function getVoucherByIdController(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw ApiError.badRequest("Invalid voucher ID");
    }

    const voucher = await UnifiedVoucher.findById(id).lean();
    if (!voucher) {
      throw ApiError.notFound("Voucher not found");
    }

    return ok(res, "Voucher fetched successfully", voucher);
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
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      throw ApiError.badRequest("Cancellation reason is mandatory");
    }

    const voucher = await UnifiedVoucher.findById(id);
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

