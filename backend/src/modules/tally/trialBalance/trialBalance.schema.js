import mongoose, { Schema } from "mongoose";
import commonFields from "../../common/commonFields.object.js";
import timeStampObj from "../../common/timestamps.object.js";

const trialBalanceLineSchema = new Schema(
  {
    accountName: {
      type: String,
      required: true,
      trim: true,
    },
    closingDebitAmount: {
      type: Number,
      default: 0,
    },
    closingCreditAmount: {
      type: Number,
      default: 0,
    },
  },
  { _id: false },
);

const trialBalanceSchema = new Schema(
  {
    company_id: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    groupName: {
      type: String,
      required: true,
      trim: true,
    },
    closingDebitAmount: {
      type: Number,
      default: 0,
    },
    closingCreditAmount: {
      type: Number,
      default: 0,
    },
    accounts: {
      type: [trialBalanceLineSchema],
      default: [],
    },
    period_from: {
      type: Date,
    },
    period_to: {
      type: Date,
    },
    timeline: {
      type: String,
      enum: ["all", "year"],
      default: "all",
    },
    ...commonFields,
  },
  {
    timestamps: timeStampObj,
  },
);
const TrialBalance = mongoose.model("TrialBalance", trialBalanceSchema);
export default TrialBalance;
