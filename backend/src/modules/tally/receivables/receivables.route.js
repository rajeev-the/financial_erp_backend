import { Router } from "express";
import {
  getReceivables,
  getReceivablesByPartyNameGroup,
  getReceivableCalculation,
  getReceivablesfromParty,
  getReceivablesMonthlyTrend,
} from "./receivables.controller.js";
import { getReceivablesGstAndTds } from "./receivablesGstTds.controller.js";
import { asyncHandler } from "../../../utils/asyncHandler.js";

const receivablesRouter = Router();

// Monthly timeline trend: received vs billed vs pending
receivablesRouter.get("/trend/:companyId", asyncHandler(getReceivablesMonthlyTrend));

// Calculation route: Sundry Debtors -> Sub-groups -> Ledgers -> Debit & Credit -> Net Outstanding
receivablesRouter.get(
  "/cal/:companyId",
  asyncHandler(getReceivableCalculation),
);

receivablesRouter.get("/cal/party-group/:companyId", asyncHandler(getReceivablesfromParty));

// Bifurcation routes: Receivables with GST and TDS breakdown
receivablesRouter.get(
  "/cal/gst-tds/:companyId",
  asyncHandler(getReceivablesGstAndTds),
);
receivablesRouter.get(
  "/receivablesgstandtds/:companyId",
  asyncHandler(getReceivablesGstAndTds),
);




receivablesRouter.get(
  "/party-group/:companyId",
  asyncHandler(getReceivablesfromParty),
);
receivablesRouter.get(
  "/party-group-name/:companyId",
  asyncHandler(getReceivablesfromParty),
);
receivablesRouter.get("/:companyId", asyncHandler(getReceivables));



export default receivablesRouter;
