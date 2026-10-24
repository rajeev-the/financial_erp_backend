import { Router } from "express";
import { getLedgerList, getAllByCompanyId, getDebtorsDropdown } from "./ledger.controller.js";
import { asyncHandler } from "../../../utils/response.js";

const ledgerRouter = Router();

ledgerRouter.get("/debtors-options/:companyId", asyncHandler(getDebtorsDropdown));
ledgerRouter.get("/options/:companyId", asyncHandler(getDebtorsDropdown));
ledgerRouter.get("/list/:companyId", asyncHandler(getLedgerList));
ledgerRouter.get("/:companyId", asyncHandler(getAllByCompanyId));

export default ledgerRouter;
