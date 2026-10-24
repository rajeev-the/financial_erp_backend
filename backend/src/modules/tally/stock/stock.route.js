import { Router } from "express";
import {
  getAllByCompanyId,
  getAllStockGroupsByCompanyId,
  getTopSellingStockItems,
} from "./stock.controller.js";
import { asyncHandler } from "../../../utils/response.js";

const stockRouter = Router();

stockRouter.get("/top-selling/:companyId", asyncHandler(getTopSellingStockItems));
stockRouter.get("/top-selling", asyncHandler(getTopSellingStockItems));
stockRouter.get("/groups/:companyId", asyncHandler(getAllStockGroupsByCompanyId));
stockRouter.get("/groups", asyncHandler(getAllStockGroupsByCompanyId));
stockRouter.get("/:companyId", asyncHandler(getAllByCompanyId));
stockRouter.get("/", asyncHandler(getAllByCompanyId));

export default stockRouter;
