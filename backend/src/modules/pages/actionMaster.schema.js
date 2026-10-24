import mongoose, { Schema, model } from "mongoose";
import { allowedActions } from "./actions.js";
import timeStampObj from "../common/timestamps.object.js";
import commonFields from "../common/commonFields.object.js";

const actionMasterSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      enum: allowedActions,
    },
    ...commonFields,
  },
  { timestamps: timeStampObj },
);

const ActionMaster = model("ActionMaster", actionMasterSchema);
export default ActionMaster;
