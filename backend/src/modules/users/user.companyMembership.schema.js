import mongoose, { Schema, model } from "mongoose";
import timeStampObj from "../common/timestamps.object.js";
import commonFields from "../common/commonFields.object.js";
import versionSchema from "../common/version.schema.js";
import versionHistorySchema from "../common/version.history.schema.js";

const userCompanyMembershipSchema = new Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    company_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Company",
        required: true
    },
    role: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "CompanyRole",
        required: true
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
},{timestamps:timeStampObj});

const UserCompanyMembership = model("UserCompanyMembership", userCompanyMembershipSchema);
export default UserCompanyMembership;