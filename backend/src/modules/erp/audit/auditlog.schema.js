import { Schema, model } from "mongoose";

const auditLogSchema = new Schema(
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
      index: true,
    },
    action: {
      type: String,
      enum: ["CREATE", "CANCEL", "EDIT_DRAFT", "POST"],
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    before: {
      type: Schema.Types.Mixed,
      default: null,
    },
    after: {
      type: Schema.Types.Mixed,
      default: null,
    },
    reason: {
      type: String,
      trim: true,
      default: null,
    },
    at: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: false,
    collection: "auditlogs",
  }
);

// Block updates and deletes at Mongoose middleware level for immutability
auditLogSchema.pre(["updateOne", "updateMany", "findOneAndUpdate", "replaceOne"], function (next) {
  next(new Error("Audit logs are strictly append-only and cannot be updated."));
});

auditLogSchema.pre(["deleteOne", "deleteMany", "findOneAndDelete"], function (next) {
  next(new Error("Audit logs are strictly append-only and cannot be deleted."));
});

const AuditLog = model("AuditLog", auditLogSchema);
export default AuditLog;
