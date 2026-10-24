import { ok } from "../../../../utils/response.js";
import {
  getProfitAndLossService,
  getBalanceSheetService,
  getFinancialPositionService,
} from "./financialReports.service.js";
import { getGstReportService } from "./gstReport.service.js";

/**
 * Controller for GET /profit-loss/:companyId
 */
export async function getProfitAndLoss(req, res) {
  const { companyId } = req.params;
  const { from_date, to_date } = req.query;

  const data = await getProfitAndLossService({
    companyId,
    fromDate: from_date,
    toDate: to_date,
  });

  return ok(res, data, "Profit and Loss statement calculated successfully");
}

/**
 * Controller for GET /balance-sheet/:companyId
 */
export async function getBalanceSheet(req, res) {
  const { companyId } = req.params;
  const { from_date, to_date } = req.query;

  const data = await getBalanceSheetService({
    companyId,
    fromDate: from_date,
    toDate: to_date,
  });

  return ok(res, data, "Balance Sheet statement calculated successfully");
}

/**
 * Controller for GET /financial-position/:companyId
 */
export async function getFinancialPosition(req, res) {
  const { companyId } = req.params;
  const { from_date, to_date } = req.query;

  const data = await getFinancialPositionService({
    companyId,
    fromDate: from_date,
    toDate: to_date,
  });

  return ok(res, data, "Financial position and ratios calculated successfully");
}

/**
 * Controller for GET /gst/:companyId
 */
export async function getGstReport(req, res) {
  const { companyId } = req.params;
  const { from_date, to_date } = req.query;

  const data = await getGstReportService({
    companyId,
    fromDate: from_date,
    toDate: to_date,
  });

  return ok(res, data, "GST report and tax liability calculated successfully");
}
