import { Router } from "express";
import { getAllByCompanyId } from "./costcenter.controller.js";
import { asyncHandler } from "../../../utils/response.js";

const costCenterRouter = Router();

costCenterRouter.get("/:companyId", asyncHandler(getAllByCompanyId));
export default costCenterRouter;
