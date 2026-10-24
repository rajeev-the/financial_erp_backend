import mongoose, { Schema } from "mongoose";
import commonFields from "../../common/commonFields.object.js";
import timeStampObj from "../../common/timestamps.object.js";

const salesAccountSchema = new Schema(
  {
    company_id: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
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
    period_from: {
      type: Date,
    },
    period_to: {
      type: Date,
    },
    ...commonFields,
  },
  {
    timestamps: timeStampObj,
  },
);

const SalesAccount = mongoose.model("SalesAccount", salesAccountSchema);
export default SalesAccount;
