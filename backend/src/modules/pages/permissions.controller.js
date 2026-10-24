import RolePermission from "./permissions.schema.js";
import mongoose from "mongoose";
import { ApiError } from "../../utils/api-error.js";
import { ok } from "../../utils/response.js";

const addTenantPagePermission = async (req, res, next) => {
  const {
    rolePermissionId,
    moduleName,
    modulePermissions,
    pageId,
    pagePermissions,
  } = req.body;

  if (!rolePermissionId || !moduleName) {
    throw ApiError.badRequest("rolePermissionId and moduleName are required");
  }

  if (!mongoose.Types.ObjectId.isValid(rolePermissionId)) {
    throw ApiError.badRequest("Invalid rolePermissionId");
  }

  if (pageId && !mongoose.Types.ObjectId.isValid(pageId)) {
    throw ApiError.badRequest("Invalid pageId");
  }

  const rolePerm = await RolePermission.findById(rolePermissionId);
  if (!rolePerm) {
    throw ApiError.notFound("Role permission not found");
  }

  // Find if the module already exists
  const moduleIndex = rolePerm.permission_modules.findIndex(
    (mod) => mod.module_name === moduleName,
  );

  if (moduleIndex > -1) {
    // Update module level permissions if provided
    if (modulePermissions !== undefined) {
      rolePerm.permission_modules[moduleIndex].permissions = modulePermissions;
    }

    // Update page level permissions if page is specified
    if (pageId && pagePermissions !== undefined) {
      const pageIndex = rolePerm.permission_modules[
        moduleIndex
      ].pages.findIndex((p) => p.page.toString() === pageId);

      if (pageIndex > -1) {
        rolePerm.permission_modules[moduleIndex].pages[pageIndex].permissions =
          pagePermissions;
      } else {
        rolePerm.permission_modules[moduleIndex].pages.push({
          page: pageId,
          permissions: pagePermissions,
        });
      }
    }
  } else {
    // Create new module structure completely
    rolePerm.permission_modules.push({
      module_name: moduleName,
      permissions: modulePermissions || [],
      pages: pageId
        ? [
            {
              page: pageId,
              permissions: pagePermissions || [],
            },
          ]
        : [],
    });
  }

  await rolePerm.save();

  return ok(res, rolePerm, "Tenant permissions updated successfully");
};

const addCompanyPagePermission = async (req, res, next) => {
  const {
    rolePermissionId,
    moduleName,
    modulePermissions,
    pageId,
    pagePermissions,
  } = req.body;

  if (!rolePermissionId || !moduleName) {
    throw ApiError.badRequest("rolePermissionId and moduleName are required");
  }

  if (!mongoose.Types.ObjectId.isValid(rolePermissionId)) {
    throw ApiError.badRequest("Invalid rolePermissionId");
  }

  if (pageId && !mongoose.Types.ObjectId.isValid(pageId)) {
    throw ApiError.badRequest("Invalid pageId");
  }

  const rolePerm = await RolePermission.findById(rolePermissionId);
  if (!rolePerm) {
    throw ApiError.notFound("Role permission not found");
  }

  // Find if the module already exists
  const moduleIndex = rolePerm.permission_modules.findIndex(
    (mod) => mod.module_name === moduleName,
  );

  if (moduleIndex > -1) {
    // Update module level permissions if provided
    if (modulePermissions !== undefined) {
      rolePerm.permission_modules[moduleIndex].permissions = modulePermissions;
    }

    // Update page level permissions if page is specified
    if (pageId && pagePermissions !== undefined) {
      const pageIndex = rolePerm.permission_modules[
        moduleIndex
      ].pages.findIndex((p) => p.page.toString() === pageId);

      if (pageIndex > -1) {
        rolePerm.permission_modules[moduleIndex].pages[pageIndex].permissions =
          pagePermissions;
      } else {
        rolePerm.permission_modules[moduleIndex].pages.push({
          page: pageId,
          permissions: pagePermissions,
        });
      }
    }
  } else {
    // Create new module structure completely
    rolePerm.permission_modules.push({
      module_name: moduleName,
      permissions: modulePermissions || [],
      pages: pageId
        ? [
            {
              page: pageId,
              permissions: pagePermissions || [],
            },
          ]
        : [],
    });
  }

  await rolePerm.save();

  return ok(res, rolePerm, "Company permissions updated successfully");
};

const addPagePermission = async (req, res, next) => {
  try {
    const { isTenant } = req.body;

    if (isTenant === true || String(isTenant).toLowerCase() === "true") {
      return await addTenantPagePermission(req, res, next);
    } else {
      return await addCompanyPagePermission(req, res, next);
    }
  } catch (error) {
    next(error);
  }
};

export { addPagePermission };
