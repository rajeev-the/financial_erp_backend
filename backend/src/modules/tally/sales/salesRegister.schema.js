import mongoose, { Schema } from "mongoose";
import commonFields from "../../common/commonFields.object.js";
import timeStampObj from "../../common/timestamps.object.js";

const salesRegisterPeriodSchema = new Schema(
  {
    period: {
      type: String,
      required: true,
      trim: true,
    },
    month: {
      type: Number,
      required: true,
    },
    year: {
      type: Number,
      required: true,
    },
    debitAmount: {
      type: Number,
      default: 0,
    },
    creditAmount: {
      type: Number,
      default: 0,
    },
    closingAmount: {
      type: Number,
      default: 0,
    },
  },
  { _id: false },
);

const salesRegisterSchema = new Schema(
  {
    company_id: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    data: {
      type: [salesRegisterPeriodSchema],
      default: [],
    },
    ...commonFields,
  },
  {
    timestamps: timeStampObj,
  },
);

const SalesRegister = mongoose.model("SalesRegister", salesRegisterSchema);
export default SalesRegister;
