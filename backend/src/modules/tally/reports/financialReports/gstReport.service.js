import mongoose from "mongoose";
import Company from "../../../companies/company.schema.js";
import { calculateReceivablesGstAndTdsService } from "../../receivables/receivablesGstTds.service.js";
import { calculatePayablesGstAndTdsService } from "../../payables/payablesGstTds.service.js";
import { ApiError } from "../../../../utils/api-error.js";

const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

export async function getGstReportService({ companyId, fromDate, toDate }) {
  if (!companyId) {
    throw ApiError.badRequest("Company ID is required");
  }

  let targetCompanyId = null;
  if (mongoose.Types.ObjectId.isValid(companyId)) {
    targetCompanyId = new mongoose.Types.ObjectId(companyId);
  } else {
    const compDoc = await Company.findOne({
      $or: [{ tally_company_guid: companyId }, { name: companyId }],
      is_deleted: { $ne: true },
    }).select("_id");
    if (compDoc) targetCompanyId = compDoc._id;
  }

  if (!targetCompanyId) {
    throw ApiError.notFound("Company not found");
  }

  // Fetch Output GST (Sales) and Input GST / ITC (Purchases) concurrently
  const [outputGstRes, inputGstRes] = await Promise.allSettled([
    calculateReceivablesGstAndTdsService({
      companyId: targetCompanyId,
      from_date: fromDate,
      to_date: toDate,
    }),
    calculatePayablesGstAndTdsService({
      companyId: targetCompanyId,
      from_date: fromDate,
      to_date: toDate,
    }),
  ]);

  const outputData = outputGstRes.status === "fulfilled" ? outputGstRes.value : null;
  const inputData = inputGstRes.status === "fulfilled" ? inputGstRes.value : null;

  const outputSummary = outputData?.summary?.gst || {
    total_gst: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    other_gst: 0,
  };

  const inputSummary = inputData?.summary?.gst || {
    total_gst: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    other_gst: 0,
  };

  const totalOutputTax = round2(outputSummary.total_gst);
  const totalItc = round2(inputSummary.total_gst);
  const netLiability = round2(Math.max(0, totalOutputTax - totalItc));
  const itcBalance = round2(Math.max(0, totalItc - totalOutputTax));

  const totalTaxPool = totalOutputTax > 0 ? totalOutputTax : 1;
  const cgst = round2(outputSummary.cgst);
  const sgst = round2(outputSummary.sgst);
  const igst = round2(outputSummary.igst);
  const cess = round2(outputSummary.other_gst);

  const liabilityBreakup = [
    {
      label: "CGST",
      amount: cgst,
      value: round2((cgst / totalTaxPool) * 100),
    },
    {
      label: "SGST",
      amount: sgst,
      value: round2((sgst / totalTaxPool) * 100),
    },
    {
      label: "IGST",
      amount: igst,
      value: round2((igst / totalTaxPool) * 100),
    },
    {
      label: "CESS",
      amount: cess,
      value: round2((cess / totalTaxPool) * 100),
    },
  ];

  const itcEfficiency = totalItc > 0
    ? round2((Math.min(totalOutputTax, totalItc) / totalItc) * 100)
    : 100.0;

  const itcRows = [
    {
      label: "ITC Available (GSTR-2B)",
      value: totalItc,
      type: "positive",
    },
    {
      label: "ITC Claimed (GSTR-3B)",
      value: round2(Math.min(totalOutputTax, totalItc)),
      type: "positive",
    },
    {
      label: "ITC Reversal",
      value: 0.0,
      type: "negative",
    },
    {
      label: "Net ITC Utilized",
      value: round2(Math.min(totalOutputTax, totalItc)),
      type: "total",
    },
    {
      label: "ITC Balance Carried Forward",
      value: itcBalance,
      type: "positive",
    },
  ];

  const returns = [
    {
      name: "GSTR-1",
      title: "Outward Supplies (Sales)",
      description: "Summary of sales invoices & output GST",
      period: "Current FY",
      dueDate: "11th of succeeding month",
      status: totalOutputTax > 0 ? "Ready to File" : "Nil Return",
      amount: totalOutputTax,
      howItWorks: "GSTR-1 captures all sales transactions and output GST charged to customers. It establishes your total outward tax liability for the tax period.",
    },
    {
      name: "GSTR-2B",
      title: "Auto-Drafted ITC Statement",
      description: "Static Input Tax Credit available from purchases",
      period: "Current FY",
      dueDate: "Auto-generated (14th)",
      status: totalItc > 0 ? "Available" : "No ITC",
      amount: totalItc,
      howItWorks: "GSTR-2B is generated on the 14th of each month reflecting eligible Input Tax Credit based on sales returns filed by your registered suppliers.",
    },
    {
      name: "GSTR-3B",
      title: "Monthly Summary & Tax Payment",
      description: "Self-declaration to pay net GST liability",
      period: "Current FY",
      dueDate: "20th of succeeding month",
      status: netLiability > 0 ? "Payment Due" : "Nil Liability",
      amount: netLiability,
      howItWorks: "GSTR-3B offsets your Output Tax liability against eligible ITC. Any remaining balance after ITC utilization must be paid in cash before the 20th.",
    },
    {
      name: "GSTR-9",
      title: "Annual GST Return",
      description: "Consolidated annual reconciliation return",
      period: "Financial Year",
      dueDate: "31st Dec following FY",
      status: "Upcoming",
      amount: totalOutputTax,
      howItWorks: "GSTR-9 reconciles all monthly returns filed during the financial year against your audited annual accounts and books of ledger entries.",
    },
  ];

  return {
    company_id: targetCompanyId,
    period: {
      from_date: fromDate || null,
      to_date: toDate || null,
    },
    total_output_tax: totalOutputTax,
    total_itc: totalItc,
    net_tax_payable: netLiability,
    itc_balance: itcBalance,
    itc_efficiency: itcEfficiency,
    liability_breakup: liabilityBreakup,
    itc_rows: itcRows,
    returns,
    einvoice: {
      total_invoices: outputData?.total_parties || 0,
      active_count: outputData?.total_parties || 0,
      cancelled_count: 0,
    },
  };
}

export default {
  getGstReportService,
};
