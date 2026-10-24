import mongoose, { Schema, model } from "mongoose";
import timeStampObj from "../common/timestamps.object.js";

const authOtpSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    otp_hash: {
      type: String,
      required: true,
    },
    purpose: {
      type: String,
      default: "LOGIN",
      enum: ["LOGIN", "FORGOT_PASSWORD", "CHANGE_PASSWORD", "REGISTER"],
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    ip_address: {
      type: String,
      default: "",
    },
    consumed_at: {
      type: Date,
      default: null,
    },
    expires_at: {
      type: Date,
      required: true,
    },
  },
  { timestamps: timeStampObj },
);

const AuthOtp = model("AuthOtp", authOtpSchema);
export default AuthOtp;
