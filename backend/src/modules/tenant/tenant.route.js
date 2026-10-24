import { Router } from "express";
import {
  createTenant,
  getTenantById,
  getTenantsByUserId,
  getAllTenants,
  getTenantRoles,
  createTenantRoles,
} from "./tenant.controller.js";
import { authenticate } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

const tenantRouter = Router();

tenantRouter.post("/", asyncHandler(createTenant));
tenantRouter.get("/user", authenticate, asyncHandler(getTenantsByUserId));
tenantRouter.get("/all", asyncHandler(getAllTenants));
tenantRouter.post(
  "/roles/:tenantId",
  authenticate,
  asyncHandler(createTenantRoles),
);
tenantRouter.get("/roles/:tenantId", authenticate, asyncHandler(getTenantRoles));
tenantRouter.get("/:id", asyncHandler(getTenantById));

export default tenantRouter;
