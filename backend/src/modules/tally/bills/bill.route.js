import { Router } from "express";
import {
  generateUploadUrl,
  confirmUpload,
  getBillViewUrl,
  getBillStatusBatch,
  deleteBill,
} from "./bill.controller.js";
import { asyncHandler } from "../../../utils/response.js";

const billRouter = Router();

// Generate presigned PUT URL for uploading
billRouter.post("/upload-url", asyncHandler(generateUploadUrl));

// Confirm that file was uploaded and save mapping in DB
billRouter.post("/confirm-upload", asyncHandler(confirmUpload));

// Get presigned GET URL for viewing / downloading
billRouter.get("/:companyId/view/:voucherNumber", asyncHandler(getBillViewUrl));

// Batch check attachment status for vouchers on tables
billRouter.post("/:companyId/batch-status", asyncHandler(getBillStatusBatch));

// Delete / detach bill
billRouter.delete("/:companyId/:voucherNumber", asyncHandler(deleteBill));

export default billRouter;
