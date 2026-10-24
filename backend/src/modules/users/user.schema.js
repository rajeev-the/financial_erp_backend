import mongoose, { Schema, model, version } from "mongoose";
import commonFields from "../common/commonFields.object.js";
import timeStampObj from "../common/timestamps.object.js";
import versionSchema from "../common/version.schema.js";
import versionHistorySchema from "../common/version.history.schema.js";

const gstinschema = new Schema({
  gst_number: {
    type: String,
    trim: true,
    regex: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/
  },
  gst_login_id: {
    type: String,
    trim: true
  },
  gstin_login_password: {
    type: String,
    trim: true
  }
});


const userSchema = new Schema(
  {
    first_name: {
      type: String,
      trim: true,
      regex: /^[a-zA-Z]+$/,
    },
    last_name: {
      type: String,
      trim: true,
      regex: /^[a-zA-Z]+$/,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      lowercase: true,
      regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    tenants:{
      type:[{
        type:Schema.Types.ObjectId,
        ref:"Tenant"
      }],
      default:[],
    },
    companies:{
      type:[{
        type:Schema.Types.ObjectId,
        ref:"Company"
      }],
      default:[],
    },
    tenant_memberships: {
      type: [
        {
          type: Schema.Types.ObjectId,
          ref: "UserTenantMembership",
        }
      ],
      default: [],
    },
    company_memberships: {
      type: [
        {
          type: Schema.Types.ObjectId,
          ref: "UserCompanyMembership",
        }
      ],
      default: [],
    },
    pan:{
      type: String,
      regex: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/,
      trim: true
    },
    gstin:{
      type: gstinschema,
      default: null,
    },
    ...commonFields,
    version: {
      type: versionSchema,
      default: null
    },
    version_history: {
      type: [versionHistorySchema],
      default: []
    }
  },
  { timestamps: timeStampObj }
);

const User = model("User", userSchema);
export default User;