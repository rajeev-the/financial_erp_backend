import { Router } from "express";
import { getAllByCompanyId } from "./godown.controller.js";
import { asyncHandler } from "../../../utils/response.js";

const godownRouter = Router();

godownRouter.get("/:companyId", asyncHandler(getAllByCompanyId));

export default godownRouter;
