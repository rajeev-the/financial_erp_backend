import mongoose, { Schema, model } from "mongoose";
import versionSchema from "../common/version.schema.js";
import versionHistorySchema from "../common/version.history.schema.js";
import commonFields from "../common/commonFields.object.js";
import timeStampObj from "../common/timestamps.object.js";
const TenantSchema = new Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        trim: true
    },
    pan:{
        type: String,
        regex: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/,
        trim: true
    },
    cin:{
        type: String,
    },
    tan:{
        type: String,
    },
    gstin: {
        type: String,
        trim: true
    },
    gst_registration_type: {
        type: String,
        trim: true
    },
    phone: {
        type: String,
        trim: true
    },
    address: {
        type: String,
        trim: true
    },
    city: {
        type: String,
        trim: true
    },
    state: {
        type: String,
        trim: true
    },
    country: {
        type: String,
        trim: true
    },
    ...commonFields,
    version: {
        type:versionSchema,
        default:null
    },
    version_history:{
        type:[versionHistorySchema],
        default:[]
    }
}, { timestamps: timeStampObj });
const Tenant = model("Tenant", TenantSchema);
export default Tenant;