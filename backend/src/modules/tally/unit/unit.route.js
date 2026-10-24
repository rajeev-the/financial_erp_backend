import { Router } from "express";
import { getAllByCompanyId } from "./unit.controller.js";
import { asyncHandler } from "../../../utils/response.js";

const unitRouter = Router();

unitRouter.get("/:companyId", asyncHandler(getAllByCompanyId));

export default unitRouter;
