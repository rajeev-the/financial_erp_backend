import mongoose, { Schema } from "mongoose";
import commonFields from "../../common/commonFields.object.js";
import timeStampObj from "../../common/timestamps.object.js";

const purchaseRegisterPeriodSchema = new Schema(
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

const purchaseRegisterSchema = new Schema(
  {
    company_id: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    data: {
      type: [purchaseRegisterPeriodSchema],
      default: [],
    },
    ...commonFields,
  },
  {
    timestamps: timeStampObj,
  },
);

const PurchaseRegister = mongoose.model(
  "PurchaseRegister",
  purchaseRegisterSchema,
);
export default PurchaseRegister;
