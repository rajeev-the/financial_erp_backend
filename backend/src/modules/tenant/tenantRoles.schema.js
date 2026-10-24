import mongoose, { Schema, model } from "mongoose";
import versionSchema from "../common/version.schema.js";
import versionHistorySchema from "../common/version.history.schema.js";
import commonFields from "../common/commonFields.object.js";
import timeStampObj from "../common/timestamps.object.js";
const tenantRoleSchema = new Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    tenant_id: {
        type: Schema.Types.ObjectId,
        ref: "Tenant",
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

const TenantRole = model("TenantRole", tenantRoleSchema);
export default TenantRole;