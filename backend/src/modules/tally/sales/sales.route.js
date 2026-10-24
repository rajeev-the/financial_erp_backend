import { Router } from "express";
import { asyncHandler } from "../../../utils/response.js";
import { getSalesRegister } from "./salesRegister.controller.js";
import { getsales } from "../revenue/SalesCal.controller.js";

const salesRouter = Router();

salesRouter.get("/register/:companyId", asyncHandler(getSalesRegister));
salesRouter.get("/rev/cal/:companyId", asyncHandler(getsales));

export default salesRouter;
