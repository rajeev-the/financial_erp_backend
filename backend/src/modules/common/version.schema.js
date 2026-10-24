import { Schema } from "mongoose";

const versionSchema = new Schema(
  {
    version: {
      type: Number,
      default: 1,
    },
  },
  { _id: false },
);

export default versionSchema;
