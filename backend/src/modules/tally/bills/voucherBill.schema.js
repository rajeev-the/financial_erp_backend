import mongoose, { Schema, model } from "mongoose";
import commonFields from "../../common/commonFields.object.js";
import timeStampObj from "../../common/timestamps.object.js";

const voucherBillSchema = new Schema(
  {
    company_id: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    voucher_number: {
      type: String,
      required: true,
      trim: true,
    },
    voucher_id: {
      type: Schema.Types.ObjectId,
      ref: "Voucher",
      default: null,
    },
    s3_key: {
      type: String,
      required: true,
    },
    s3_bucket: {
      type: String,
      required: true,
    },
    file_name: {
      type: String,
      required: true,
    },
    file_size: {
      type: Number,
      default: 0,
    },
    mime_type: {
      type: String,
      default: "application/pdf",
    },
    extension: {
      type: String,
      default: "pdf",
    },
    uploaded_at: {
      type: Date,
      default: Date.now,
    },
    uploaded_by: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    is_deleted: {
      type: Boolean,
      default: false,
    },
    ...commonFields,
  },
  { timestamps: timeStampObj },
);

voucherBillSchema.index({ company_id: 1, voucher_number: 1 });
voucherBillSchema.index({ company_id: 1, s3_key: 1 });

const VoucherBill = model("VoucherBill", voucherBillSchema);
export default VoucherBill;
