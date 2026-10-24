import { Schema } from "mongoose";
const commonFields = {
  
    created_by: {
        type: Schema.Types.ObjectId,
        ref: "User"
    },
    updated_by: {
        type: Schema.Types.ObjectId,
        ref: "User",
    },
    is_active: {
        type: Boolean,
        default: true,
    },
    is_deleted: {
        type: Boolean,
        default: false,
    }
};

export default commonFields;