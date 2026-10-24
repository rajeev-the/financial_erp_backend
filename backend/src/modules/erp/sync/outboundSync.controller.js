import mongoose from "mongoose";
import OutboundSyncQueue from "./outboundSyncQueue.schema.js";
import UnifiedVoucher from "../voucher/voucher.unified.schema.js";
import Company from "../../companies/company.schema.js";
import { ApiError } from "../../../utils/api-error.js";
import { ok } from "../../../utils/response.js";

/**
 * GET /api/v1/erp/sync/outbound/pending
 * Fetches and atomically locks a batch of pending vouchers to be synced to Tally Prime.
 */
export async function getPendingOutboundSyncController(req, res, next) {
  try {
    const { companyId, limit = 20 } = req.query;
    const targetCompanyId = companyId || req.headers["x-company-id"];

    if (!targetCompanyId) {
      throw ApiError.badRequest("companyId is required in query or x-company-id header");
    }

    const maxItems = Math.min(50, Math.max(1, parseInt(limit, 10)));
    const now = new Date();
    const lockExpiry = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes lock

    // Find pending or expired locked items
    const pendingItems = await OutboundSyncQueue.find({
      companyId: new mongoose.Types.ObjectId(targetCompanyId),
      status: { $in: ["PENDING", "PROCESSING"] },
      nextAttemptAt: { $lte: now },
      $or: [
        { lockedUntil: null },
        { lockedUntil: { $lte: now } },
      ],
    })
      .sort({ createdAt: 1 })
      .limit(maxItems);

    if (pendingItems.length === 0) {
      return ok(res, "No pending vouchers in outbound sync queue", []);
    }

    const itemIds = pendingItems.map((item) => item._id);

    // Atomically lock this batch
    await OutboundSyncQueue.updateMany(
      { _id: { $in: itemIds } },
      {
        $set: {
          status: "PROCESSING",
          lockedUntil: lockExpiry,
        },
      }
    );

    // Fetch full vouchers and company info
    const populatedItems = await OutboundSyncQueue.find({ _id: { $in: itemIds } })
      .populate({
        path: "voucherId",
        model: "UnifiedVoucher",
      })
      .populate({
        path: "companyId",
        select: "name tally_company_name gstin state_code",
      })
      .lean();

    return ok(res, "Pending vouchers locked for sync", populatedItems);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/erp/sync/outbound/ack
 * Acknowledges successful sync of voucher into Tally Prime.
 */
export async function ackOutboundSyncController(req, res, next) {
  try {
    const { queueId, tallyAlterId, tallyGuid, responseDetails } = req.body;

    if (!queueId || !mongoose.Types.ObjectId.isValid(queueId)) {
      throw ApiError.badRequest("Valid queueId is required");
    }

    const queueItem = await OutboundSyncQueue.findById(queueId);
    if (!queueItem) {
      throw ApiError.notFound("Outbound sync queue item not found");
    }

    queueItem.status = "SYNCED";
    queueItem.lockedUntil = null;
    queueItem.tallyResponse = {
      alterId: tallyAlterId || null,
      guid: tallyGuid || null,
      details: responseDetails || null,
      syncedAt: new Date(),
    };
    await queueItem.save();

    // Update UnifiedVoucher sync block
    if (queueItem.voucherId) {
      await UnifiedVoucher.findByIdAndUpdate(queueItem.voucherId, {
        $set: {
          "sync.tallyGuid": tallyGuid || null,
          "sync.tallyAlterId": tallyAlterId ? Number(tallyAlterId) : null,
          "sync.syncedAt": new Date(),
        },
      });
    }

    return ok(res, "Outbound sync acknowledged successfully", queueItem);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/erp/sync/outbound/fail
 * Records sync failure from Tally Prime and schedules exponential backoff retry.
 */
export async function failOutboundSyncController(req, res, next) {
  try {
    const { queueId, error, rawResponse } = req.body;

    if (!queueId || !mongoose.Types.ObjectId.isValid(queueId)) {
      throw ApiError.badRequest("Valid queueId is required");
    }

    const queueItem = await OutboundSyncQueue.findById(queueId);
    if (!queueItem) {
      throw ApiError.notFound("Outbound sync queue item not found");
    }

    const attempts = queueItem.attempts + 1;
    const isExhausted = attempts >= queueItem.maxAttempts;

    // Exponential backoff: 2^attempts * 15 seconds (15s, 30s, 60s, 120s, 240s)
    const backoffMs = Math.pow(2, attempts) * 15 * 1000;
    const nextAttemptAt = new Date(Date.now() + backoffMs);

    queueItem.attempts = attempts;
    queueItem.status = isExhausted ? "FAILED" : "PENDING";
    queueItem.nextAttemptAt = isExhausted ? null : nextAttemptAt;
    queueItem.lockedUntil = null;
    queueItem.lastError = error ? String(error).slice(0, 1000) : "Unknown sync error";
    if (rawResponse) {
      queueItem.tallyResponse = rawResponse;
    }

    await queueItem.save();

    return ok(res, isExhausted ? "Sync permanently failed (attempts exhausted)" : "Sync scheduled for retry", {
      queueId: queueItem._id,
      status: queueItem.status,
      attempts: queueItem.attempts,
      nextAttemptAt: queueItem.nextAttemptAt,
    });
  } catch (err) {
    next(err);
  }
}
