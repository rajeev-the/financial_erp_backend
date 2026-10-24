import mongoose, { Schema, model } from "mongoose";
import versionSchema from "../common/version.schema.js";
import versionHistorySchema from "../common/version.history.schema.js";
import commonFields from "../common/commonFields.object.js";
import timeStampObj from "../common/timestamps.object.js";
const companyRoleSchema = new Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    company_id: {
        type: Schema.Types.ObjectId,
        ref: "Company",
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
}, { timestamps: timeStampObj });

const CompanyRole = model("CompanyRole", companyRoleSchema);
export default CompanyRole;