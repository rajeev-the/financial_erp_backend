import { Router } from "express";
import { asyncHandler } from "../../../utils/response.js";
import { getBankBalance } from "./bankcal.controller.js";

const bankRouter = Router();

// Endpoints to get bank balance (aggregate and per-bank breakdown)

bankRouter.get("/cal/:companyId", asyncHandler(getBankBalance));


export default bankRouter;
