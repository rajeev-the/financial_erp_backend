import { Router } from "express";
import {
  createSalesInvoiceController,
  createReceiptVoucherController,
  createPaymentVoucherController,
  getUnpaidVouchersController,
  getVouchersListController,
  getVoucherByIdController,
  cancelVoucherController,
} from "./voucher.controller.js";

const erpVoucherRouter = Router();

erpVoucherRouter.post("/sales", createSalesInvoiceController);
erpVoucherRouter.post("/receipt", createReceiptVoucherController);
erpVoucherRouter.post("/payment", createPaymentVoucherController);
erpVoucherRouter.get("/unpaid", getUnpaidVouchersController);
erpVoucherRouter.get("/", getVouchersListController);
erpVoucherRouter.get("/:companyId/:id", getVoucherByIdController);
erpVoucherRouter.get("/:id", getVoucherByIdController);
erpVoucherRouter.post("/:companyId/:id/cancel", cancelVoucherController);
erpVoucherRouter.post("/:id/cancel", cancelVoucherController);

export default erpVoucherRouter;
