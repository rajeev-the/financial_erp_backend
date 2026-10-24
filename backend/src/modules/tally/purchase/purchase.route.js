import { Router } from "express";
import {
  getPurchaseRegister,
  getAllByCompanyId,
} from "./purchaseRegister.controller.js";
import { getPurchaseCal } from "./purchaseCal.controller.js";
import asyncHandler from "../../../utils/asyncHandler.js";

const purchaseRouter = Router();

purchaseRouter.get("/register/:companyId", asyncHandler(getPurchaseRegister));
purchaseRouter.get("/:companyId", asyncHandler(getAllByCompanyId));
purchaseRouter.get("/cal/:companyId",asyncHandler(getPurchaseCal))


export default purchaseRouter;