import mongoose, { Schema, model } from "mongoose";
import commonFields from "../../common/commonFields.object.js";
import timeStampObj from "../../common/timestamps.object.js";

const stockGroupSchema = new Schema(
  {
    company_id: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    guid: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    parent: {
      type: String,
      default: null,
    },
    is_addable: {
      type: Boolean,
      default: false,
    },
    alter_id: {
      type: Number,
      default: null,
    },
    master_id: {
      type: Number,
      default: null,
    },
    ...commonFields,
  },
  { timestamps: timeStampObj },
);

const StockGroup = model("StockGroup", stockGroupSchema);
export default StockGroup;
