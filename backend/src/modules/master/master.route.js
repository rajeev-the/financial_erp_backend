import { Router } from "express";
import {
  getMasterStockGroups,
  getMasterStockItems,
  getMasterLedgers,
  getMasterGroups,
  getMasterUnits,
} from "./master.controller.js";
import { asyncHandler } from "../../utils/response.js";

const masterRouter = Router();

/* Stock Groups */
masterRouter.get("/stock-groups/all", asyncHandler(getMasterStockGroups));
masterRouter.get("/stock-groups", asyncHandler(getMasterStockGroups));

/* Stock Items */
masterRouter.get("/stock-items/all", asyncHandler(getMasterStockItems));
masterRouter.get("/stock-items", asyncHandler(getMasterStockItems));

/* Ledgers */
masterRouter.get("/ledgers/all", asyncHandler(getMasterLedgers));
masterRouter.get("/ledgers", asyncHandler(getMasterLedgers));

/* Groups */
masterRouter.get("/groups/all", asyncHandler(getMasterGroups));
masterRouter.get("/groups-options", asyncHandler(getMasterGroups));
masterRouter.get("/groups", asyncHandler(getMasterGroups));

/* Units */
masterRouter.get("/units/all", asyncHandler(getMasterUnits));
masterRouter.get("/units", asyncHandler(getMasterUnits));

export default masterRouter;
