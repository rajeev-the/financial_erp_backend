import mongoose, { Schema, model } from "mongoose";
import commonFields from "../../common/commonFields.object.js";
import timeStampObj from "../../common/timestamps.object.js";

const costCenterSchema = new Schema(
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
    parent: {
      type: String,
      default: null,
    },
    category: {
      type: String,
      default: null,
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

const CostCenter = model("CostCenter", costCenterSchema);
export default CostCenter;
