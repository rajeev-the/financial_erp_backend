import mongoose, { Schema, model } from "mongoose";
import commonFields from "../../common/commonFields.object.js";
import timeStampObj from "../../common/timestamps.object.js";

const unitSchema = new Schema(
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
    },
    original_name: {
      type: String,
      default: null,
    },
    is_simple_unit: {
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
    conversion: {
      type: Number,
      default: 0,
    },
    decimal_places: {
      type: Number,
      default: 0,
    },
    ...commonFields,
  },
  { timestamps: timeStampObj },
);

const Unit = model("Unit", unitSchema);
export default Unit;
