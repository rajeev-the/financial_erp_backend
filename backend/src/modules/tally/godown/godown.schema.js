import mongoose, { Schema, model } from "mongoose";
import commonFields from "../../common/commonFields.object.js";
import timeStampObj from "../../common/timestamps.object.js";

const godownSchema = new Schema(
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
    has_no_space: {
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

const Godown = model("Godown", godownSchema);
export default Godown;
