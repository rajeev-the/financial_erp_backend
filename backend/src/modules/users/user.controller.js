import User from "./user.schema.js";
import Tenant from "../tenant/tenant.schema.js";
import UserCompanyMembership from "./user.companyMembership.schema.js";
import UserTenantMembership from "./user.tenantMembership.schema.js";
import CompanyRole from "../companies/comanyRoles.schema.js";
import TenantRole from "../tenant/tenantRoles.schema.js";
import Company from "../companies/company.schema.js";
import {
  companyDefaultRoleNames,
  tenantDefaultRoleNames,
} from "../common/roles.objects.js";
import Menu from "../pages/menu.schema.js";
import ActionMaster from "../pages/actionMaster.schema.js";
import RolePermission from "../pages/permissions.schema.js";
import mongoose from "mongoose";
import { ok, fail } from "../../utils/response.js";
import { ApiError } from "../../utils/api-error.js";
import regexValidation from "../common/regexValidation.js";
import { sendUserInvitationEmail } from "../../utils/mailer.js";

const userSignUp = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const {
      first_name,
      last_name,
      user_email,
      tenant_name,
      tenant_email,
      tenant_phone,
      gstin,
      pan,
      address,
      state,
      country,
    } = req.body;

    // Basic validation
    if (!user_email) {
      throw ApiError.badRequest("Missing required user fields");
    }
    if (!tenant_name) {
      throw ApiError.badRequest("Missing required tenant fields");
    }

    const email_regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email_regex.test(user_email)) {
      throw ApiError.badRequest("Invalid user email");
    }

    let result;

    await session.withTransaction(async () => {
      const existing_user = await User.findOne({ email: user_email }).session(
        session,
      );
      if (existing_user) {
        throw ApiError.badRequest("User already exists");
      }

      const [new_tenant] = await Tenant.create(
        [
          {
            name: tenant_name,
            email: tenant_email,
            phone: tenant_phone,
            gstin,
            pan,
          },
        ],
        { session },
      );

      const [new_company] = await Company.create(
        [
          {
            tenant_id: new_tenant._id,
            name: tenant_name,
            email: tenant_email,
            address: address || "N/A",
            state: state || "N/A",
            country: country || "India",
          },
        ],
        { session },
      );

      // Create tenant roles
      const tenant_role_docs = tenantDefaultRoleNames.map((role_name) => ({
        name: role_name,
        tenant_id: new_tenant._id,
      }));
      const saved_tenant_roles = await TenantRole.insertMany(tenant_role_docs, {
        session,
      });
      const tenant_admin_role = saved_tenant_roles.find(
        (r) => r.name.toLowerCase() === "admin",
      );
      const tenant_admin_role_id = tenant_admin_role
        ? tenant_admin_role._id
        : null;

      // Create company roles
      const company_role_docs = companyDefaultRoleNames.map((role_name) => ({
        name: role_name,
        company_id: new_company._id,
      }));
      const saved_company_roles = await CompanyRole.insertMany(
        company_role_docs,
        { session },
      );
      const company_admin_role = saved_company_roles.find(
        (r) => r.name.toLowerCase() === "admin",
      );
      const company_admin_role_id = company_admin_role
        ? company_admin_role._id
        : null;

      const all_action_masters = await ActionMaster.find({}).session(session);
      const all_action_ids = all_action_masters.map((a) => a._id);

      const all_parent_menus = await Menu.find({ isParent: true })
        .populate("child_menu")
        .session(session);

      // Create permissions for tenant Admin
      if (tenant_admin_role_id) {
        const tenant_modules = all_parent_menus.map((parent) => ({
          module_name: parent.label,
          permissions: all_action_ids,
          pages: (parent.child_menu || []).map((child) => ({
            page: child._id,
            permissions: all_action_ids,
          })),
        }));

        await RolePermission.create(
          [
            {
              role: tenant_admin_role_id,
              permission_modules: tenant_modules,
            },
          ],
          { session },
        );
      }

      // Create permissions for company Admin
      if (company_admin_role_id) {
        const company_modules = all_parent_menus.map((parent) => ({
          module_name: parent.label,
          permissions: all_action_ids,
          pages: (parent.child_menu || []).map((child) => ({
            page: child._id,
            permissions: all_action_ids,
          })),
        }));

        await RolePermission.create(
          [
            {
              role: company_admin_role_id,
              permission_modules: company_modules,
            },
          ],
          { session },
        );
      }

      // Create user
      const [new_user] = await User.create(
        [
          {
            first_name: first_name || "N/A",
            last_name: last_name || "N/A",
            email: user_email,
            pan: pan || "N/A",
            gstin: gstin || null,
            tenant_memberships: [],
            company_memberships: [],
            tenants: [],
            companies: [],
          },
        ],
        { session },
      );

      // Create memberships
      const [new_user_tenant_membership] = await UserTenantMembership.create(
        [
          {
            user_id: new_user._id,
            tenant_id: new_tenant._id,
            role: tenant_admin_role_id,
          },
        ],
        { session },
      );

      const [new_user_company_membership] = await UserCompanyMembership.create(
        [
          {
            user_id: new_user._id,
            company_id: new_company._id,
            role: company_admin_role_id,
          },
        ],
        { session },
      );

      new_user.tenant_memberships.push(new_user_tenant_membership._id);
      new_user.company_memberships.push(new_user_company_membership._id);
      new_user.tenants.push(new_tenant._id);
      new_user.companies.push(new_company._id);
      await new_user.save({ session });

      result = {
        user_id: new_user._id,
        tenant_id: new_tenant._id,
        company_id: new_company._id,
      };
    });

    return ok(res, result, "User created successfully", 201);
  } catch (error) {
    next(error);
  } finally {
    session.endSession();
  }
};

const getUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw ApiError.badRequest("Invalid user ID");
    }
    const result = await User.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(id) } },
      // tenants
      {
        $lookup: {
          from: "usertenantmemberships",
          localField: "tenant_memberships",
          foreignField: "_id",
          as: "tenants",
          pipeline: [
            {
              $lookup: {
                from: "tenants",
                localField: "tenant_id",
                foreignField: "_id",
                as: "tenant_id",
                pipeline: [{ $project: { name: 1, email: 1 } }],
              },
            },
            {
              $unwind: { path: "$tenant_id", preserveNullAndEmptyArrays: true },
            },
            {
              $lookup: {
                from: "tenantroles",
                localField: "role",
                foreignField: "_id",
                as: "role",
                pipeline: [{ $project: { name: 1, _id: 0 } }],
              },
            },
            { $unwind: { path: "$role", preserveNullAndEmptyArrays: true } },
            {
              $addFields: {
                tenant: "$tenant_id",
                role: "$role.name",
              },
            },
            { $project: { tenant: 1, role: 1, _id: 0 } },
          ],
        },
      },

      // companies
      {
        $lookup: {
          from: "usercompanymemberships",
          localField: "company_memberships",
          foreignField: "_id",
          as: "companies",
          pipeline: [
            {
              $lookup: {
                from: "companies",
                localField: "company_id",
                foreignField: "_id",
                as: "company_id",
                pipeline: [{ $project: { name: 1, email: 1 } }],
              },
            },
            {
              $unwind: {
                path: "$company_id",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $lookup: {
                from: "companyroles",
                localField: "role",
                foreignField: "_id",
                as: "role",
                pipeline: [{ $project: { name: 1, _id: 0 } }],
              },
            },
            { $unwind: { path: "$role", preserveNullAndEmptyArrays: true } },
            {
              $addFields: {
                company: "$company_id",
                role: "$role.name",
              },
            },
            { $project: { company: 1, role: 1, _id: 0 } },
          ],
        },
      },

      {
        $project: {
          is_deleted: 0,
          is_active: 0,
          version: 0,
          version_history: 0,
          created_at: 0,
          updated_at: 0,
          createdAt: 0,
          updatedAt: 0,
          __v: 0,
        },
      },
    ]);

    const user = result[0];

    if (!user) {
      throw ApiError.notFound("User not found");
    }

    return ok(res, user, "User retrieved successfully");
  } catch (error) {
    next(error);
  }
};

const createUser = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const {
      first_name,
      last_name,
      email,
      company_role_id,
      tenant_role_id,
      tenant_id,
      company_id,
    } = req.body;

    if (!email || !company_id || !tenant_id) {
      throw ApiError.badRequest(
        "Missing required fields: email, company_id, tenant_id",
      );
    }

    if (!mongoose.Types.ObjectId.isValid(company_id)) {
      throw ApiError.badRequest("Invalid company_id");
    }
    if (!mongoose.Types.ObjectId.isValid(tenant_id)) {
      throw ApiError.badRequest("Invalid tenant_id");
    }
    if (company_role_id && !mongoose.Types.ObjectId.isValid(company_role_id)) {
      throw ApiError.badRequest("Invalid company_role_id");
    }
    if (tenant_role_id && !mongoose.Types.ObjectId.isValid(tenant_role_id)) {
      throw ApiError.badRequest("Invalid tenant_role_id");
    }

    if (!regexValidation.EMAIL.test(email)) {
      throw ApiError.badRequest("Invalid email format");
    }

    let result;
    let invitation_email_data = null;

    await session.withTransaction(async () => {
      // 1. Verify Tenant exists
      const tenant = await Tenant.findOne({
        _id: tenant_id,
        is_deleted: false,
      }).session(session);
      if (!tenant) {
        throw ApiError.notFound("Tenant not found");
      }

      // 2. Verify Company exists and belongs to the Tenant
      const company = await Company.findOne({
        _id: company_id,
        tenant_id: tenant_id,
        is_deleted: false,
      }).session(session);
      if (!company) {
        throw ApiError.notFound(
          "Company not found or does not belong to the specified tenant",
        );
      }

      const existing_user = await User.findOne({ email }).session(session);

      const has_company =
        existing_user?.companies.some(
          (id) => id.toString() === company_id.toString(),
        ) ?? false;
      const has_tenant =
        existing_user?.tenants.some(
          (id) => id.toString() === tenant_id.toString(),
        ) ?? false;

      // User already exists in both tenant and company -> nothing to do
      if (existing_user && has_company && has_tenant) {
        throw new ApiError(
          409,
          "User already exists with the provided company and tenant",
        );
      }

      const needs_tenant_membership = !has_tenant;
      const needs_company_membership = !has_company;

      // Validate required role fields based on what memberships are needed
      if (needs_tenant_membership && !tenant_role_id) {
        throw ApiError.badRequest("Missing required field: tenant_role_id");
      }
      if (needs_company_membership && !company_role_id) {
        throw ApiError.badRequest("Missing required field: company_role_id");
      }

      // Validate roles (only fetch what's needed)
      let tenant_role = null;
      if (needs_tenant_membership) {
        tenant_role = await TenantRole.findOne({
          _id: tenant_role_id,
          tenant_id: tenant_id,
          is_deleted: false,
        }).session(session);
        if (!tenant_role) {
          throw ApiError.notFound(
            "Tenant role not found or does not belong to the specified tenant",
          );
        }
      }

      let company_role = null;
      if (needs_company_membership) {
        company_role = await CompanyRole.findOne({
          _id: company_role_id,
          company_id: company_id,
          is_deleted: false,
        }).session(session);
        if (!company_role) {
          throw ApiError.notFound(
            "Company role not found or does not belong to the specified company",
          );
        }
      }

      // Get or create the user
      let user = existing_user;
      if (!user) {
        [user] = await User.create([{ first_name, last_name, email }], {
          session,
        });
      }

      // Add tenant membership if needed
      if (needs_tenant_membership) {
        const [new_tenant_membership] = await UserTenantMembership.create(
          [
            {
              user_id: user._id,
              tenant_id: new mongoose.Types.ObjectId(tenant_id),
              role: new mongoose.Types.ObjectId(tenant_role_id),
            },
          ],
          { session },
        );
        user.tenants.push(new mongoose.Types.ObjectId(tenant_id));
        user.tenant_memberships.push(new_tenant_membership._id);
      }

      // Add company membership if needed
      if (needs_company_membership) {
        const [new_company_membership] = await UserCompanyMembership.create(
          [
            {
              user_id: user._id,
              company_id: new mongoose.Types.ObjectId(company_id),
              role: new mongoose.Types.ObjectId(company_role_id),
            },
          ],
          { session },
        );
        user.companies.push(new mongoose.Types.ObjectId(company_id));
        user.company_memberships.push(new_company_membership._id);
      }

      await user.save({ session });

      result = {
        user_id: user._id,
        company_id: company_id,
        tenant_id: tenant_id,
      };

      invitation_email_data = {
        email,
        user_name: user.first_name
          ? `${user.first_name} ${user.last_name || ""}`.trim()
          : first_name
            ? `${first_name} ${last_name || ""}`.trim()
            : "",
        company_name: company.name,
        tenant_name: tenant.name,
        role_name: company_role?.name || "",
      };
    });

    const response = ok(res, result, "User created successfully", 200);

    // Trigger invitation email in the background after responding to the client
    if (invitation_email_data) {
      sendUserInvitationEmail(invitation_email_data).catch((err) => {
        console.error("Failed to send invitation email:", err);
      });
    }

    return response;
  } catch (error) {
    next(error);
  } finally {
    session.endSession();
  }
};

const getUsersByCompanyId = async (req, res, next) => {
  try {
    const company_id = req.params.companyId;

    if (!company_id || !mongoose.Types.ObjectId.isValid(company_id)) {
      throw ApiError.badRequest("Invalid or missing companyId");
    }

    const company = await Company.findOne({
      _id: company_id,
      is_deleted: false,
    });

    if (!company) {
      throw ApiError.notFound("Company not found");
    }

    const memberships = await UserCompanyMembership.find({
      company_id: new mongoose.Types.ObjectId(company_id),
      is_deleted: false,
    })
      .populate({
        path: "user_id",
        match: { is_deleted: false },
        select:
          "first_name last_name email pan gstin is_active created_at updated_at",
      })
      .populate({
        path: "role",
        select: "name is_active",
      })
      .sort({ created_at: -1 })
      .lean();

    const formatted_users = memberships
      .filter((m) => m.user_id)
      .map((m) => ({
        _id: m.user_id._id,
        first_name: m.user_id.first_name,
        last_name: m.user_id.last_name,
        email: m.user_id.email,
        pan: m.user_id.pan,
        gstin: m.user_id.gstin,
        role: m.role ? m.role?.name : null,
        is_active: m.is_active && m.user_id.is_active,
        created_at: m.created_at,
        updated_at: m.updated_at,
      }));

    return ok(res, formatted_users, "Users retrieved successfully", 200);
  } catch (error) {
    next(error);
  }
};

export { userSignUp, getUser, createUser, getUsersByCompanyId };
