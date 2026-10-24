import mongoose, { Schema, model } from "mongoose";
import timeStampObj from "../common/timestamps.object.js";
import { allowedActions } from "./actions.js";
import commonFields from "../common/commonFields.object.js";

const pagePermissionSchema = new Schema(
  {
    page: {
      type: Schema.Types.ObjectId,
      ref: "Menu",
      required: true,
    },
    permissions: {
      type: [Schema.Types.ObjectId],
      ref: "ActionMaster",
      default: [],
    },
  },
  { _id: false },
);

const rolePermissionModuleSchema = new Schema(
  {
    module_name: {
      type: String,
      required: true,
      trim: true,
    },
    permissions: {
      type: [Schema.Types.ObjectId],
      ref: "ActionMaster",
      default: [],
    },
    pages: {
      type: [pagePermissionSchema],
      default: [],
    },
  },
  { _id: false },
);

const rolePermissionSchema = new Schema(
  {
    company_id: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      default: undefined,
    },
    company_role: {
      type: Schema.Types.ObjectId,
      ref: "CompanyRole",
      default: undefined,
      required: function () {
        return !!this.company_id;
      },
    },
    tenant_id: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      default: undefined,
    },
    tenant_role: {
      type: Schema.Types.ObjectId,
      ref: "TenantRole",
      default: undefined,
      required: function () {
        return !!this.tenant_id;
      },
    },
    permission_modules: {
      type: [rolePermissionModuleSchema],
      default: [],
    },
    ...commonFields,
    version: {
      type: Schema.Types.Mixed,
      default: null,
    },
    version_history: {
      type: [Schema.Types.Mixed],
      default: [],
    },
  },
  { timestamps: timeStampObj },
);

rolePermissionSchema.pre("validate", function () {
  if (this.company_id && !this.company_role) {
    throw new Error("company_role is required when company_id is provided.");
  }
  if (this.company_role && !this.company_id) {
    throw new Error("company_id is required when company_role is provided.");
  }
  if (this.tenant_id && !this.tenant_role) {
    throw new Error("tenant_role is required when tenant_id is provided.");
  }
  if (this.tenant_role && !this.tenant_id) {
    throw new Error("tenant_id is required when tenant_role is provided.");
  }
});

const RolePermission = model("RolePermission", rolePermissionSchema);
export default RolePermission;
