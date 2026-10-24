import { Router } from "express";
import {
  getPayables,
  getPayablesByPartyNameGroup,
  getPayableCalculation,
} from "./payables.controller.js";
import { getPayablesGstAndTds } from "./payablesGstTds.controller.js";
import { asyncHandler } from "../../../utils/asyncHandler.js";

const payablesRouter = Router();

// Calculation route: Sundry Creditors -> Sub-groups -> Ledgers -> Credit & Debit -> Net Outstanding
payablesRouter.get(
  "/cal/:companyId",
  asyncHandler(getPayableCalculation),
);

// Bifurcation routes: Payables with GST and TDS breakdown
payablesRouter.get(
  "/cal/gst-tds/:companyId",
  asyncHandler(getPayablesGstAndTds),
);
payablesRouter.get(
  "/payablesgstandtds/:companyId",
  asyncHandler(getPayablesGstAndTds),
);

payablesRouter.get(
  "/party-group/:companyId",
  asyncHandler(getPayableCalculation),
);
payablesRouter.get(
  "/party-group-name/:companyId",
  asyncHandler(getPayableCalculation),
);
payablesRouter.get("/:companyId", asyncHandler(getPayables));

export default payablesRouter;
