import mongoose, { Schema, model } from "mongoose";
import commonFields from "../common/commonFields.object.js";
import versionSchema from "../common/version.schema.js";
import versionHistorySchema from "../common/version.history.schema.js";
import timeStampObj from "../common/timestamps.object.js";
const statisticsSchema = new Schema(
  {
    name: { type: String, trim: true },
    direct: { type: String, trim: true },
    cancelled: { type: String, trim: true },
  },
  { _id: false },
);

const companySchema = new Schema(
  {
    tenant_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      lowercase: true,
    },
    phone: {
      type: String,
    },
    tally_company_name: {
      type: String,
    },
    tally_company_guid: {
      type: String,
    },
    financial_year_from: {
      type: Date,
    },
    financial_year_to: {
      type: Date,
    },
    books_begin_from: {
      type: Date,
    },
    gst_number: {
      type: String,
      trim: true,
    },
    gst_registration_type: {
      type: String,
      trim: true,
    },
    gst_api_credentials: {},
    pan_number: {
      type: String,
      trim: true,
    },
    address: {
      type: String,
    },
    state: {
      type: String,
    },
    country: {
      type: String,
    },
    base_currency: {
      type: String,
      default: "INR",
      required: true,
    },
    statistics: {
      type: [statisticsSchema],
      default: [],
    },
    last_sync_at: {
      type: Date,
      default: null,
    },
    last_voucher_date: {
      type: Date,
      default: null,
    },
    sync_enabled: {
      type: Boolean,
      default: false,
    },
    is_interval_sync: {
      type: Boolean,
      default: true,
    },
    sync_interval_minutes: {
      type: Number,
      default: 30,
      min: 5,
    },
    sync_time: {
      type: Date,
      default: null,
    },
    tally_host: {
      type: String,
      default: null,
    },
    tally_port: {
      type: Number,
      default: null,
    },
    ...commonFields,
    version: {
      type: versionSchema,
      default: null,
    },
    version_history: {
      type: [versionHistorySchema],
      default: [],
    },
  },
  { timestamps: timeStampObj },
);

const Company = model("Company", companySchema);
export default Company;
