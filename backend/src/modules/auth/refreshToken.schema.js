import { Schema, model } from "mongoose";
import timeStampObj from "../common/timestamps.object.js";

const refreshTokenSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    token_hash: {
      type: String,
      required: true,
      unique: true,
    },
    user_agent: {
      type: String,
      default: "",
    },
    ip_address: {
      type: String,
      default: "",
    },
    expires_at: {
      type: Date,
      required: true,
    },
    revoked_at: {
      type: Date,
      default: null,
    },
  },
  { timestamps: timeStampObj },
);

const RefreshToken = model("RefreshToken", refreshTokenSchema);
export default RefreshToken;
