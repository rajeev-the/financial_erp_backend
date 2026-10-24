import mongoose, { Schema, model } from "mongoose";
import commonFields from "../../common/commonFields.object.js";
import timeStampObj from "../../common/timestamps.object.js";

const companyBillsSchema = new Schema(
  {
    company_id: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    name: {
      type: String,
      trim: true,
    },
    bill_date: {
      type: Date,
      default: null,
    },
    cleared_on: {
      type: Date,
      default: null,
    },
    parent: {
      type: String,
      default: null,
    },
    is_advance: {
      type: Boolean,
      default: false,
    },
    is_tds_refundable: {
      type: Boolean,
      default: false,
    },
    bill_id: {
      type: String,
      trim: true,
    },
    closing_balance: {
      type: Number,
      default: 0,
    },
    opening_balance: {
      type: Number,
      default: 0,
    },
    base_closing_balance: {
      type: Number,
      default: 0,
    },
    final_balance: {
      type: Number,
      default: 0,
    },
    ...commonFields,
  },
  { timestamps: timeStampObj },
);

const CompanyBills = model("CompanyBills", companyBillsSchema);
export default CompanyBills;
