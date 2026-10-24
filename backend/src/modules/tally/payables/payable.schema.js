import mongoose, { Schema, model } from "mongoose";
import commonFields from "../../common/commonFields.object.js";
import timeStampObj from "../../common/timestamps.object.js";

const payableSchema = new Schema(
  {
    company_id: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    bill_date: {
      type: Date,
    },
    bill_ref: {
      type: String,
      trim: true,
    },
    party_name: {
      type: String,
      trim: true,
      required: true,
    },
    closing_amount: {
      type: Number,
      default: 0,
    },
    bill_due: {
      type: Date,
    },
    overdue_days: {
      type: Number,
      default: 0,
    },
    ...commonFields,
  },
  {
    timestamps: timeStampObj,
  },
);

payableSchema.index({ company_id: 1, party_name: 1, bill_ref: 1 });

const Payable = model("Payable", payableSchema);
export default Payable;
