import mongoose, { Schema, model } from "mongoose";
import timeStampObj from "../common/timestamps.object.js";
import commonFields from "../common/commonFields.object.js";

const menuSchema = new Schema(
  {
    label: {
      type: String,
      required: true,
      trim: true,
    },
    icon: {
      type: String,
      trim: true,
    },
    path: {
      type: String,
      trim: true,
    },
    position: {
      type: String,
    },
    child_menu: {
      type: [Schema.Types.ObjectId],
      ref: "Menu",
      default: [],
    },
    isParent: {
      type: Boolean,
      default: true,
    },
    sequence: {
      type: Number,
      default: 0,
    },
    ...commonFields,
  },
  { timestamps: timeStampObj },
);

const Menu = model("Menu", menuSchema);
export default Menu;
