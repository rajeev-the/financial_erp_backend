import { Router } from "express";
import saveToDbController from "./sync.controller.js";
import { asyncHandler } from "../../../utils/asyncHandler.js";

const router = Router();

router.post("/save-to-db", asyncHandler(saveToDbController));

export default router;
