import { Router } from "express";
import erpVoucherRouter from "./voucher/voucher.route.js";
import outboundSyncRouter from "./sync/outboundSync.route.js";
import erpReportsRouter from "./reports/reports.route.js";

const erpMainRouter = Router();

erpMainRouter.use("/vouchers", erpVoucherRouter);
erpMainRouter.use("/voucher", erpVoucherRouter); // alias
erpMainRouter.use("/sync/outbound", outboundSyncRouter);
erpMainRouter.use("/reports", erpReportsRouter);

export default erpMainRouter;
