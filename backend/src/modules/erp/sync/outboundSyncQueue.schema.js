import { Schema, model } from "mongoose";

const outboundSyncQueueSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    voucherId: {
      type: Schema.Types.ObjectId,
      ref: "UnifiedVoucher",
      required: true,
    },
    operation: {
      type: String,
      enum: ["CREATE", "CANCEL"],
      default: "CREATE",
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "SYNCED", "FAILED"],
      default: "PENDING",
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
    },
    nextAttemptAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lockedUntil: {
      type: Date,
      default: null,
    },
    lastError: {
      type: String,
      trim: true,
      default: null,
    },
    tallyResponse: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: "outbound_sync_queue",
  }
);

outboundSyncQueueSchema.index({ status: 1, nextAttemptAt: 1 });
outboundSyncQueueSchema.index({ voucherId: 1, operation: 1 }, { unique: true });

const OutboundSyncQueue = model("OutboundSyncQueue", outboundSyncQueueSchema);
export default OutboundSyncQueue;
