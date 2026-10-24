import { Router } from "express";
import {
  createCompany,
  getCompanies,
  getCompanyById,
  getCompaniesByTenantAndUser,
  getCompanyByTenantId,
  updateCompany,
  getCompanyRoles,
  createCompanyRoles,
} from "./company.controller.js";
import { authenticate } from "../../middleware/authenticate.js";
import {
  validateCreateCompany,
  validateCompanyParams,
  validateUpdateCompany,
} from "./company.validation.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

const companyRouter = Router();

companyRouter.post(
  "/",
  authenticate,
  validateCreateCompany,
  asyncHandler(createCompany),
);
companyRouter.post(
  "/roles/:companyId",
  authenticate,
  asyncHandler(createCompanyRoles),
);
companyRouter.get(
  "/",
  authenticate,
  validateCompanyParams,
  asyncHandler(getCompanies),
);
companyRouter.get(
  "/tenant/:tenantId",
  authenticate,
  asyncHandler(getCompanyByTenantId),
);
companyRouter.get(
  "/tenant/:tenantId/user/:userId",
  asyncHandler(getCompaniesByTenantAndUser),
);
companyRouter.get(
  "/user/:userId",
  authenticate,
  validateCompanyParams,
  asyncHandler(getCompaniesByTenantAndUser),
);
companyRouter.get(
  "/roles/:companyId",
  authenticate,
  asyncHandler(getCompanyRoles),
);
companyRouter.get(
  "/:id",
  authenticate,
  validateCompanyParams,
  asyncHandler(getCompanyById),
);
companyRouter.put(
  "/:id",
  authenticate,
  validateUpdateCompany,
  asyncHandler(updateCompany),
);

export default companyRouter;
