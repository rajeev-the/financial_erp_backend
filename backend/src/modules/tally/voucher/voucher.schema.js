import { Schema, model } from "mongoose";
import commonFields from "../../common/commonFields.object.js";
import timeStampObj from "../../common/timestamps.object.js";

const voucherSchema = new Schema(
  {
    company_id: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    vchtype: {
      type: String,
      required: true,
    },
    voucher_type_id: {
      type: Schema.Types.ObjectId,
      ref: "VoucherType",
      default: null,
    },
    date: {
      type: Date,
      required: true,
    },
    voucher_number: {
      type: String,
      trim: true,
    },
    guid: {
      type: String,
      required: true,
    },
    master_id: {
      type: Number,
      default: null,
    },
    alter_id: {
      type: Number,
      default: null,
    },
    amount: {
      type: Number,
      default: 0,
    },
    currency: {
      type: String,
      default: "INR",
    },
    category: {
      type: String,
    },
    narration: {
      type: String,
      trim: true,
    },
    party_gstin: {
      type: String,
      trim: true,
      default: null,
    },
    party_ledger_id: {
      type: Schema.Types.ObjectId,
      ref: "Ledger",
      default: null,
    },
    is_optional: {
      type: Boolean,
      default: false,
    },
    is_cancelled: {
      type: Boolean,
      default: false,
    },
    reference_date: {
      type: Date,
    },
    reference_number: {
      type: String,
    },
    place_of_supply: {
      type: String,
    },
    exchange_rate: {
      type: Number,
      default: 1,
    },
    is_reserved: {
      type: Boolean,
      default: false,
    },
    is_approved: {
      type: Boolean,
      default: false,
    },
    is_posted: {
      type: Boolean,
      default: false,
    },
    is_invoiced: {
      type: Boolean,
      default: false,
    },
    last_sync_at: {
      type: Date,
      default: null,
    },
    ...commonFields,
  },
  {
    timestamps: timeStampObj,
  },
);

voucherSchema.index({ company_id: 1, voucher_type_id: 1 });
voucherSchema.index({ company_id: 1, party_ledger_id: 1 });
voucherSchema.index({ company_id: 1, guid: 1 });

const Voucher = model("Voucher", voucherSchema);
export default Voucher;
