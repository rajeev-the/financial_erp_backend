import { Router } from "express";
import { addPagePermission } from "./permissions.controller.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

const permissionsRouter = Router();

permissionsRouter.post("/add-page", asyncHandler(addPagePermission));

export default permissionsRouter;
