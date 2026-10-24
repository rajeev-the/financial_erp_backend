import mongoose,{Schema,model} from "mongoose";
import commonFields from "../common/commonFields.object.js";
import timeStampObj from "../common/timestamps.object.js";
import versionSchema from "../common/version.schema.js";
import versionHistorySchema from "../common/version.history.schema.js";
const userTenantMembershipSchema = new Schema({
    tenant_id:{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Tenant",
        required: true
    },
    user_id:{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    role:{
      type: mongoose.Schema.Types.ObjectId,
      ref: "TenantRole",
      required: true
    },
    ...commonFields,
    version: {
        type: versionSchema,
        default: null
    },
    version_history:{
        type: [versionHistorySchema],
        default: []
    }
},{timestamps:timeStampObj});

const UserTenantMembership = model("UserTenantMembership", userTenantMembershipSchema);
export default UserTenantMembership;