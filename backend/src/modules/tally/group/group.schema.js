import mongoose, { Schema, model } from "mongoose";
import commonFields from "../../common/commonFields.object.js";
import timeStampObj from "../../common/timestamps.object.js";
const groupSchema = new Schema(
  {
    company_id: {
      type: mongoose.Schema.Types.ObjectId,
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

    parent: {
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

    is_deemed_positive: {
      type: Boolean,
      default: false,
    },

    is_reserved: {
      type: Boolean,
      default: false,
    },

    last_sync_at: {
      type: Date,
      default: null,
    },

    affects_stock: {
      type: Boolean,
      default: false,
    },
    ...commonFields,
  },
  { timestamps: timeStampObj },
);
const Group = model("Group", groupSchema);
export default Group;
