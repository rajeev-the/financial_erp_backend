import { Router } from "express";
import {
  getVoucherByLedgerName,
  getVoucherById,
  getVoucherByVoucherType,
  calculateSalesThroughVoucher,
  getSalesSummaryThroughVoucher,
  getVoucherslist
} from "./voucher.controller.js";
import { asyncHandler } from "../../../utils/asyncHandler.js";

const voucher_router = Router();

voucher_router.get(
  "/type/:companyId",
  asyncHandler(getVoucherByVoucherType),
);
voucher_router.get(
  "/ledger/:ledger_name",
  asyncHandler(getVoucherByLedgerName),
);

voucher_router.get("/sales-summary/:companyId", asyncHandler(getSalesSummaryThroughVoucher));
voucher_router.get("/sales/:companyId", asyncHandler(calculateSalesThroughVoucher));
voucher_router.route("/getvoucher").get(asyncHandler(getVoucherslist)).post(asyncHandler(getVoucherslist));
voucher_router.get("/:companyId/:id", asyncHandler(getVoucherById));


export default voucher_router;
