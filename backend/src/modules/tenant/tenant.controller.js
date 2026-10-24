import mongoose from "mongoose";
import Tenant from "./tenant.schema.js";
import TenantRole from "./tenantRoles.schema.js";
import UserTenantMembership from "../users/user.tenantMembership.schema.js";
import User from "../users/user.schema.js";
import Menu from "../pages/menu.schema.js";
import ActionMaster from "../pages/actionMaster.schema.js";
import RolePermission from "../pages/permissions.schema.js";
import { tenantDefaultRoleNames } from "../common/roles.objects.js";
import { ApiError } from "../../utils/api-error.js";
import { ok } from "../../utils/response.js";

/**
 * @desc Create a new standalone tenant with default roles & permissions
 * @route POST /api/v1/tenant
 */
export const createTenant = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const {
      name,
      email,
      phone,
      pan,
      cin,
      tan,
      gstin,
      gst_registration_type,
      address,
      city,
      state,
      country,
      userId,
    } = req.body;

    if (!name) {
      throw ApiError.badRequest("Tenant name is required");
    }

    if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
      throw ApiError.badRequest(
        "Invalid userId. Must be a valid 24-character hexadecimal ObjectId string.",
      );
    }

    let result;

    await session.withTransaction(async () => {
      // 1. Create Tenant
      const [newTenant] = await Tenant.create(
        [
          {
            name,
            email,
            phone,
            pan,
            cin,
            tan,
            gstin,
            gst_registration_type,
            address,
            city,
            state,
            country,
          },
        ],
        { session },
      );

      // 2. Initialize default Tenant Roles
      const tenantRoleDocs = tenantDefaultRoleNames.map((roleName) => ({
        name: roleName,
        tenant_id: newTenant._id,
      }));
      const savedTenantRoles = await TenantRole.insertMany(tenantRoleDocs, {
        session,
      });

      const tenantAdminRole = savedTenantRoles.find(
        (r) => r.name.toLowerCase() === "admin",
      );

      // 3. Setup default Role Permissions for Admin role
      const allActionMasters = await ActionMaster.find({}).session(session);
      const allActionIds = allActionMasters.map((a) => a._id);

      const allParentMenus = await Menu.find({ isParent: true })
        .populate("child_menu")
        .session(session);

      const adminPermissionModules = allParentMenus.map((parent) => ({
        module_name: parent.label,
        permissions: allActionIds,
        pages: parent.child_menu.map((child) => ({
          page: child._id,
          permissions: allActionIds,
        })),
      }));

      const tenantRolePerms = savedTenantRoles.map((role) => {
        const isAdmin = role.name.toLowerCase() === "admin";
        return {
          tenant_id: newTenant._id,
          tenant_role: role._id,
          permission_modules: isAdmin ? adminPermissionModules : [],
        };
      });

      await RolePermission.insertMany(tenantRolePerms, { session });

      // 4. If userId provided, assign user as Tenant Admin
      let membership = null;
      if (userId) {
        const user = await User.findById(userId).session(session);
        if (user && tenantAdminRole) {
          const [newMembership] = await UserTenantMembership.create(
            [
              {
                user_id: user._id,
                tenant_id: newTenant._id,
                role: tenantAdminRole._id,
              },
            ],
            { session },
          );

          user.tenant_memberships.push(newMembership._id);
          user.tenants.push(newTenant._id);
          await user.save({ session });
          membership = newMembership;
        }
      }

      result = {
        tenant: newTenant,
        roles: savedTenantRoles,
        membership,
      };
    });

    session.endSession();

    return ok(res, result, "Tenant created successfully", 201);
  } catch (error) {
    session.endSession();
    next(error);
  }
};

/**
 * @desc Get all tenants
 * @route GET /api/v1/tenant
 */
export const getAllTenants = async (req, res, next) => {
  try {
    const tenants = await Tenant.find({ is_deleted: false });
    return ok(res, { count: tenants.length, data: tenants }, "Tenants retrieved successfully");
  } catch (error) {
    next(error);
  }
};

/**
 * @desc Get tenant by ID
 * @route GET /api/v1/tenant/:id
 */
export const getTenantById = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw ApiError.badRequest("Invalid tenant ID format");
    }

    const tenant = await Tenant.findOne({
      _id: req.params.id,
      is_deleted: false,
    });

    if (!tenant) {
      throw ApiError.notFound("Tenant not found");
    }

    return ok(res, tenant, "Tenant retrieved successfully");
  } catch (error) {
    next(error);
  }
};

export const getTenantsByUserId = async (req, res, next) => {
  try {
    const { id: userId } = req.user;

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      throw ApiError.badRequest("Invalid or missing userId format");
    }

    const memberships = await UserTenantMembership.find({
      user_id: new mongoose.Types.ObjectId(userId),
      is_deleted: false,
    }).populate("role");

    const tenantIds = memberships.map((m) => m.tenant_id);

    const activeTenants = await Tenant.find({
      _id: { $in: tenantIds },
      is_deleted: false,
    });

    return ok(res, activeTenants, "Tenants retrieved successfully");
  } catch (error) {
    next(error);
  }
};

/**
 * @desc Get tenant roles by tenant ID
 * @route GET /api/v1/tenant/:id/roles
 */
export const getTenantRoles = async (req, res, next) => {
  try {
    const tenantId = req.params.tenantId;

    if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
      throw ApiError.badRequest("Invalid or missing tenant ID format");
    }

    const roles = await TenantRole.find({
      tenant_id: new mongoose.Types.ObjectId(tenantId),
      is_deleted: false,
    }).select("name tenant_id is_active created_at updated_at");

    return ok(res, roles, "Tenant roles retrieved successfully");
  } catch (error) {
    next(error);
  }
};

export const createTenantRoles = async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const { name } = req.body;
    const creatorId = req.user?.id || req.user?._id || null;

    if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
      throw ApiError.badRequest("Invalid or missing tenant ID format");
    }

    if (!name || typeof name !== "string" || !name.trim()) {
      throw ApiError.badRequest("Role name is required");
    }

    const tenant = await Tenant.findOne({
      _id: tenantId,
      is_deleted: false,
    });

    if (!tenant) {
      throw ApiError.notFound("Tenant not found");
    }

    const existingRole = await TenantRole.findOne({
      tenant_id: tenantId,
      name: { $regex: new RegExp(`^${name.trim()}$`, "i") },
      is_deleted: false,
    });

    if (existingRole) {
      throw ApiError.badRequest("Role with this name already exists for this tenant");
    }

    const newRole = await TenantRole.create({
      name: name.trim(),
      tenant_id: tenantId,
      created_by: creatorId,
      version: { version: 1 },
      version_history: [
        {
          version: 1,
          metadata: { name: name.trim(), tenant_id: tenantId },
          created_by: creatorId,
        },
      ],
    });

    return ok(res, newRole, "Tenant role created successfully", 201);
  } catch (error) {
    next(error);
  }
};
