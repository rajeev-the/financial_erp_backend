import { Router } from "express";
import { asyncHandler, ok } from "../../utils/response.js";
import { getDashboardData, clearDashboardCacheController } from "./dasboard.service.js";

const DashboardRoutes = Router();

// Dashboard home routes
DashboardRoutes.get("/home/:companyId", asyncHandler(getDashboardData));

// Dashboard cache and pre-warm routes
DashboardRoutes.post("/clear-cache", asyncHandler(clearDashboardCacheController));
DashboardRoutes.post("/warm-pending-bills", asyncHandler((req, res) => ok(res, { warmed: true }, "Dashboard pending bills warmed successfully")));

export default DashboardRoutes;