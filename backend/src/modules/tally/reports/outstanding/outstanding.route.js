import { Router } from "express";
import { getPartyBillsDetails } from "./outstanding.controller.js";
import { asyncHandler } from "../../../../utils/asyncHandler.js";

const outstandingRouter = Router();

outstandingRouter.get("/bills/:companyId", asyncHandler(getPartyBillsDetails));

export default outstandingRouter;
