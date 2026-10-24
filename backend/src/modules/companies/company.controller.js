import mongoose from "mongoose";
import Company from "./company.schema.js";
import CompanyRole from "./comanyRoles.schema.js";
import Tenant from "../tenant/tenant.schema.js";
import UserCompanyMembership from "../users/user.companyMembership.schema.js";
import User from "../users/user.schema.js";
import Menu from "../pages/menu.schema.js";
import ActionMaster from "../pages/actionMaster.schema.js";
import RolePermission from "../pages/permissions.schema.js";
import { companyDefaultRoleNames } from "../common/roles.objects.js";
import { ApiError } from "../../utils/api-error.js";
import { ok } from "../../utils/response.js";
import fieldExclusions from "../common/fieldExclusions.js";
import {parseTallyDate} from "../tally/sync/format.helper.js";
// @route POST /api/v1/company
// @desc Create company
// @access Private
export const createCompany = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const {
      tenant_id,
      name,
      email,
      phone,
      tally_company_name,
      tally_company_guid,
      financial_year_from,
      financial_year_to,
      books_begin_from,
      last_voucher_date,
      gst_number,
      gst_registration_type,
      pan_number,
      address,
      state,
      country,
      base_currency = "INR",
      statistics = [],
    } = req.body;
    const { id: userId } = req.user;
    let result;
    await session.withTransaction(async () => {
      // 2. Check if parent tenant exists
      const tenant = await Tenant.findOne({
        _id: tenant_id,
      }).session(session);

      if (!tenant) {
        throw ApiError.notFound("Tenant not found or deleted");
      }

      // 3. Create Company
      const [newCompany] = await Company.create(
        [
          {
            tenant_id,
            name: name ? name : tally_company_name,
            email,
            phone,
            tally_company_name,
            tally_company_guid: tally_company_guid,
            financial_year_from,
            financial_year_to,
            books_begin_from,
            last_voucher_date,
            gst_number,
            gst_registration_type,
            pan_number,
            address,
            state,
            country,
            base_currency,
            statistics,
          },
        ],
        { session },
      );
      const companyRoleDocs = companyDefaultRoleNames.map((roleName) => ({
        name: roleName,
        company_id: newCompany._id,
      }));
      const savedCompanyRoles = await CompanyRole.insertMany(companyRoleDocs, {
        session,
      });

      const companyAdminRole = savedCompanyRoles.find(
        (r) => r.name.toLowerCase() === "admin",
      );

      // 5. Setup default Role Permissions for Admin role
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

      const companyRolePerms = savedCompanyRoles.map((role) => {
        const isAdmin = role.name.toLowerCase() === "admin";
        return {
          company_id: newCompany._id,
          company_role: role._id,
          permission_modules: isAdmin ? adminPermissionModules : [],
        };
      });

      await RolePermission.insertMany(companyRolePerms, { session });

      // 6. If userId provided, assign user as Company Admin
      let membership = null;
      if (userId) {
        const user = await User.findById(userId).session(session);
        if (user && companyAdminRole) {
          const [newMembership] = await UserCompanyMembership.create(
            [
              {
                user_id: user._id,
                company_id: newCompany._id,
                role: companyAdminRole._id,
              },
            ],
            { session },
          );

          user.company_memberships.push(newMembership._id);
          user.companies.push(newCompany._id);
          await user.save({ session });
          membership = newMembership;
        }
      }

      result = {
        company: newCompany,
        roles: savedCompanyRoles,
        membership,
      };
    });

    session.endSession();

    return ok(res, result, "Company created successfully", 201);
  } catch (error) {
    session.endSession();
    next(error);
  }
};
// @route GET /api/v1/company
// @desc Get all companies
// @access Private
export const getCompanies = async (req, res, next) => {
  try {
    const { id: user_id } = req.user;
    const tenant_id = req.query.tenant_id || req.params.tenantId;

    // If user_id is provided, query UserCompanyMembership
    if (user_id) {
      const membershipQuery = {
        user_id: user_id,
        is_deleted: false,
      };

      const companyMatch = { is_deleted: false };
      if (tenant_id) {
        companyMatch.tenant_id = tenant_id;
      }

      const memberships = await UserCompanyMembership.find(membershipQuery)
        .populate({
          path: "company_id",
          match: companyMatch,
          populate: { path: "tenant_id", select: "name email" },
        })
        .populate("role");

      const companies = memberships
        .filter((m) => m.company_id !== null)
        .map((m) => ({
          membership_id: m._id,
          role: m.role,
          company: m.company_id,
        }));

      return ok(res, {
        count: companies.length,
        data: companies,
      });
    }

    // Otherwise, filter companies directly by tenant_id if provided
    const filter = { is_deleted: false };
    if (tenant_id) {
      filter.tenant_id = tenant_id;
    }

    const companies = await Company.find(filter).populate(
      "tenant_id",
      "name email",
    );

    return ok(res, {
      count: companies.length,
      data: companies,
    });
  } catch (error) {
    next(error);
  }
};
// @route GET /api/v1/company/:id
// @desc Get company by id
// @access Private
export const getCompanyById = async (req, res, next) => {
  try {
    const company = await Company.findOne({
      _id: req.params.id,
      is_deleted: false,
    }).populate("tenant_id", "name email");

    if (!company) {
      throw ApiError.notFound("Company not found");
    }

    return ok(res, { data: company });
  } catch (error) {
    next(error);
  }
};
// @route GET /api/v1/company/tenant/:tenantId/user/:userId
// @desc Get companies by tenant and user
// @access Private
export const getCompaniesByTenantAndUser = async (req, res, next) => {
  return getCompanies(req, res, next);
};
// @route GET /api/v1/company/tenant/:tenantId
// @desc Get company by tenant id
// @access Private
export const getCompanyByTenantId = async (req, res, next) => {
  try {
    const { tenantId: tenant_id } = req.params;

    const companies = await Company.find({
      tenant_id: tenant_id,
      is_deleted: false,
    }).populate("tenant_id", "name email");

    return ok(res, {
      count: companies.length,
      data: companies,
    });
  } catch (error) {
    next(error);
  }
};
// @route PUT /api/v1/company/:id
// @desc Update company
// @access Private
export const updateCompany = async (req, res, next) => {
  try {
    const { id } = req.params;

    const company = await Company.findOne({ _id: id, is_deleted: false });

    if (!company) {
      throw ApiError.notFound("Company not found");
    }

    const allowedFields = [
      "name",
      "email",
      "phone",
      "tally_company_name",
      "tally_company_guid",
      "financial_year_from",
      "financial_year_to",
      "books_begin_from",
      "last_voucher_date",
      "gst_number",
      "gst_registration_type",
      "pan_number",
      "address",
      "state",
      "country",
      "base_currency",
      "statistics",
      "sync_enabled",
      "is_interval_sync",
      "sync_interval_minutes",
      "sync_time",
      "tally_host",
      "tally_port",
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }
    if(req.body.books_begin_from){
      updates.books_begin_from=parseTallyDate(req.body.books_begin_from)
    }
    if(req.body.financial_year_from){
      updates.financial_year_from=parseTallyDate(req.body.financial_year_from)
    }
    if(req.body.financial_year_to){
      updates.financial_year_to=parseTallyDate(req.body.financial_year_to)
    }
    if(req.body.last_voucher_date){
      updates.last_voucher_date=parseTallyDate(req.body.last_voucher_date)
    }
    if (Object.keys(updates).length === 0) {
      throw ApiError.badRequest("No valid fields provided for update");
    }

    const updatedCompany = await Company.findByIdAndUpdate(
      id,
      { $set: updates },
      { returnDocument: "after", runValidators: true },
    ).populate("tenant_id", "name email");

    return ok(res, { data: updatedCompany }, "Company updated successfully");
  } catch (error) {
    next(error);
  }
};

// @route GET /api/v1/company/:id/roles
// @desc Get company roles by company ID
// @access Private
export const getCompanyRoles = async (req, res, next) => {
  try {
    const companyId = req.params.companyId;
    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      throw ApiError.badRequest("Invalid or missing company ID format");
    }

    const roles = await CompanyRole.find({
      company_id: new mongoose.Types.ObjectId(companyId),
      is_deleted: false,
    }).select("name company_id is_active created_at updated_at");

    return ok(res, roles, "Company roles retrieved successfully");
  } catch (error) {
    next(error);
  }
};

export const createCompanyRoles = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { name } = req.body;
    const creatorId = req.user?.id || req.user?._id || null;

    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      throw ApiError.badRequest("Invalid or missing company ID format");
    }

    if (!name || typeof name !== "string" || !name.trim()) {
      throw ApiError.badRequest("Role name is required");
    }

    const company = await Company.findOne({
      _id: companyId,
      is_deleted: false,
    });

    if (!company) {
      throw ApiError.notFound("Company not found");
    }

    const existingRole = await CompanyRole.findOne({
      company_id: companyId,
      name: { $regex: new RegExp(`^${name.trim()}$`, "i") },
      is_deleted: false,
    });

    if (existingRole) {
      throw ApiError.badRequest(
        "Role with this name already exists for this company",
      );
    }

    const newRole = await CompanyRole.create({
      name: name.trim(),
      company_id: companyId,
      created_by: creatorId,
      version: { version: 1 },
      version_history: [
        {
          version: 1,
          metadata: { name: name.trim(), company_id: companyId },
          created_by: creatorId,
        },
      ],
    });

    return ok(res, newRole, "Company role created successfully", 201);
  } catch (error) {
    next(error);
  }
};


