import { Router } from "express";
import { getAllByCompanyId } from "./group.controller.js";
import { asyncHandler } from "../../../utils/response.js";

const groupRouter = Router();

groupRouter.get("/:companyId", asyncHandler(getAllByCompanyId));
export default groupRouter;
