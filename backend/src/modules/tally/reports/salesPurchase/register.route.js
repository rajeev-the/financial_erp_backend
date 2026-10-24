import { Router } from "express";
import { getRegisterTotals } from "./register.controller.js";
import { asyncHandler } from "../../../../utils/asyncHandler.js";

const registerRouter = Router();

registerRouter.get(
  "/register-totals/:companyId",
  asyncHandler(getRegisterTotals),
);

export default registerRouter;