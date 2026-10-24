import mongoose from "mongoose";
import SalesRegister from "../../sales/salesRegister.schema.js";
import PurchaseRegister from "../../purchase/purchaseRegister.schema.js";
import { ApiError } from "../../../../utils/api-error.js";

export const getRegisterTotalsService = async ({
  companyId,
  year,
  fromYear,
  toYear,
  fromMonth,
  toMonth,
  month,
}) => {
  const compIdFilter =
    companyId && mongoose.Types.ObjectId.isValid(companyId)
      ? new mongoose.Types.ObjectId(companyId)
      : null;

  if (!compIdFilter) {
    throw ApiError.badRequest("A valid company_id is required");
  }

  // Fetch the single array document for the company
  const salesRegisterDoc = await SalesRegister.findOne({
    company_id: compIdFilter,
  }).lean();
  const purchaseRegisterDoc = await PurchaseRegister.findOne({
    company_id: compIdFilter,
  }).lean();

  const salesData = salesRegisterDoc?.data || [];
  const purchaseData = purchaseRegisterDoc?.data || [];

  // Parse filters
  const filterYear = year ? Number(year) : null;
  const filterFromYear = fromYear ? Number(fromYear) : null;
  const filterToYear = toYear ? Number(toYear) : null;

  const filterExactMonth = month ? Number(month) : null;
  const filterFromMonth = fromMonth ? Number(fromMonth) : null;
  const filterToMonth = toMonth ? Number(toMonth) : null;

  const dataFilter = (p) => {
    let match = true;

    // Year Filtering
    if (filterYear && p.year !== filterYear) match = false;
    if (filterFromYear && p.year < filterFromYear) match = false;
    if (filterToYear && p.year > filterToYear) match = false;

    // Month Filtering
    if (filterExactMonth && p.month !== filterExactMonth) match = false;

    // Complex From/To Month logic depending on if a year range is involved
    if (filterFromMonth || filterToMonth) {
      // If filtering across multiple years, "fromMonth" usually only applies to the "fromYear"
      // and "toMonth" applies to the "toYear". But a simpler universal approach is just filtering
      // dates by converting them to an absolute numerical value (YYYYMM)

      const pYearMonth = p.year * 100 + p.month; // e.g., 202404

      if (filterFromMonth) {
        let startYear = filterFromYear || filterYear || p.year;
        let startYearMonth = startYear * 100 + filterFromMonth;
        if (pYearMonth < startYearMonth) match = false;
      }

      if (filterToMonth) {
        let endYear = filterToYear || filterYear || p.year;
        let endYearMonth = endYear * 100 + filterToMonth;
        if (pYearMonth > endYearMonth) match = false;
      }
    }

    return match;
  };

  let totalSales = 0;
  let totalPurchases = 0;

  // We sum creditAmount for sales
  salesData.filter(dataFilter).forEach((p) => {
    totalSales += p.creditAmount || 0;
  });

  // We sum absolute debitAmount for purchases
  purchaseData.filter(dataFilter).forEach((p) => {
    totalPurchases += Math.abs(p.debitAmount || 0);
  });

  return {
    totalSales: Math.round(totalSales * 100) / 100,
    totalPurchases: Math.round(totalPurchases * 100) / 100,
  };
};