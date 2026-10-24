import { Router } from "express";
import { asyncHandler } from "../../../utils/response.js";

import { getsales,getrevenue_partywise } from "./SalesCal.controller.js";

const revenceRouter = Router();

revenceRouter.get("/cal/:companyId", asyncHandler(getsales));
revenceRouter.get("/party/:companyId", asyncHandler(getrevenue_partywise));


export default revenceRouter;
