import mongoose, { Schema, model } from "mongoose";
import commonFields from "../../common/commonFields.object.js";
import timeStampObj from "../../common/timestamps.object.js";

const stockItemSchema = new Schema(
  {
    company_id: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    guid: {
      type: String,
      required: true,
      trim: true,
    },
    master_id: {
      type: Number,
      default: null,
    },
    alter_id: {
      type: Number,
      default: null,
    },
    parent: {
      type: String,
      default: null,
    },
    category: {
      type: String,
      default: null,
    },
    gst_applicable: {
      type: String,
      default: null,
    },
    gst_type_of_supply: {
      type: String,
      default: null,
    },
    base_unit: {
      type: String,
      default: null,
    },
    opening_balance: {
      type: String,
      default: null,
    },
    opening_value: {
      type: Number,
      default: 0,
    },
    opening_quantity: {
      type: Number,
      default: null,
    },
    opening_rate: {
      type: String,
      default: null,
    },
    ...commonFields,
  },
  { timestamps: timeStampObj },
);

const StockItem = model("StockItem", stockItemSchema);
export default StockItem;
