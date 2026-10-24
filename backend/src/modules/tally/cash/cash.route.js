import { Router } from "express";
import { asyncHandler } from "../../../utils/response.js";
import { getCashBalance } from "./cash.controller.js";

const cashRouter = Router();

// Endpoints to get cash balance

cashRouter.get("/cal/:companyId", asyncHandler(getCashBalance));

export default cashRouter;
