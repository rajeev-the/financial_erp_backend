import mongoose from "mongoose";
import Company from "../../companies/company.schema.js";
import Voucher from "../voucher/voucher.schema.js";
import InventoryEntry from "../voucher/inventoryentry.schema.js";
import LedgerEntry from "../voucher/ledgerentry.schema.js";
import Ledger from "../ledger/ledger.schema.js";
import ApiError from "../../../utils/api-error.js";

/**
 * Normalizes strings for loose case-insensitive matching
 */
const normalizeText = (text) => (text || "").trim().toLowerCase();

/**
 * Classifies a ledger entry as a GST tax type based on its ledger name and parent group.
 * @param {Object} entry - LedgerEntry with populated ledger_id { name, parent }
 * @returns {string|null} - 'cgst', 'sgst', 'igst', 'cess', or null
 */
const classifyTaxType = (entry) => {
  const ledgerDoc = entry?.ledger_id;
  const name = (ledgerDoc?.name || "").toLowerCase();
  const parent = (ledgerDoc?.parent || "").toLowerCase();
  const combined = `${name} ${parent}`;

  if (/\b(cgst)\b/i.test(combined)) return "cgst";
  if (/\b(sgst|utgst)\b/i.test(combined)) return "sgst";
  if (/\b(igst)\b/i.test(combined)) return "igst";
  if (/\b(cess)\b/i.test(combined)) return "cess";
  return null;
};

/**
 * Calculates GST breakdown from an array of LedgerEntry documents (with populated ledger_id).
 * @param {Array} entries - LedgerEntry docs for a single voucher
 * @returns {{ cgst: number, sgst: number, igst: number, cess: number, total: number }}
 */
const calculateGstBreakdown = (entries = []) => {
  const breakdown = { cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 };
  for (const entry of entries) {
    const taxType = classifyTaxType(entry);
    if (taxType) {
      const amt = Math.abs(Number(entry.amount) || 0);
      breakdown[taxType] = Math.round((breakdown[taxType] + amt) * 100) / 100;
    }
  }
  breakdown.total = Math.round((breakdown.cgst + breakdown.sgst + breakdown.igst + breakdown.cess) * 100) / 100;
  return breakdown;
};

/**
 * Compares sales inventory items against purchase inventory items.
 * Checks for:
 *  1. Item count parity
 *  2. Item name matching
 *  3. Item amount matching
 *  4. Item quantity & rate parity (if provided)
 *
 * @param {Array} salesItems - Array of inventory entries for the sales voucher
 * @param {Array} purchaseItems - Array of inventory entries for the purchase voucher
 * @returns {{ isMatch: boolean, reason: string | null }}
 */
const compareInventoryItems = (salesItems, purchaseItems) => {
  if (salesItems.length === 0 && purchaseItems.length === 0) {
    return { isMatch: true, reason: null };
  }

  if (salesItems.length !== purchaseItems.length) {
    return {
      isMatch: false,
      reason: `Item count mismatch: Sale has ${salesItems.length} item(s), Purchase has ${purchaseItems.length} item(s)`,
    };
  }

  // Work with a shallow copy to prevent multiple sales items matching same purchase item
  const remainingPurchases = [...purchaseItems];

  for (const sItem of salesItems) {
    const sName = normalizeText(sItem.stock_item_name);
    const sAmount = Math.abs(Number(sItem.amount) || 0);
    const sQty = parseFloat(sItem.quantity) || null;
    const sRate = parseFloat(sItem.rate) || null;

    // 1. Match item by name
    const pIndex = remainingPurchases.findIndex(
      (p) => normalizeText(p.stock_item_name) === sName
    );

    if (pIndex === -1) {
      return {
        isMatch: false,
        reason: `Item name mismatch: "${sItem.stock_item_name}" not found in another branch's purchase voucher`,
      };
    }

    const pItem = remainingPurchases[pIndex];
    const pAmount = Math.abs(Number(pItem.amount) || 0);
    const pQty = parseFloat(pItem.quantity) || null;
    const pRate = parseFloat(pItem.rate) || null;

    // 2. Match item amount (with 0.05 tolerance for minor rounding)
    if (Math.abs(sAmount - pAmount) > 0.05) {
      return {
        isMatch: false,
        reason: `Item amount mismatch for "${sItem.stock_item_name}": Sale is ₹${sAmount.toFixed(2)}, Purchase is ₹${pAmount.toFixed(2)}`,
      };
    }

    // 3. Match item quantity if numeric
    if (sQty !== null && pQty !== null && Math.abs(sQty - pQty) > 0.001) {
      return {
        isMatch: false,
        reason: `Item quantity mismatch for "${sItem.stock_item_name}": Sale has ${sItem.quantity}, Purchase has ${pItem.quantity}`,
      };
    }

    // 4. Match item unit rate if numeric
    if (sRate !== null && pRate !== null && Math.abs(sRate - pRate) > 0.05) {
      return {
        isMatch: false,
        reason: `Item rate mismatch for "${sItem.stock_item_name}": Sale rate is ${sItem.rate}, Purchase rate is ${pItem.rate}`,
      };
    }

    // Consume matched purchase item
    remainingPurchases.splice(pIndex, 1);
  }

  return { isMatch: true, reason: null };
};

/**
 * Service to reconcile intercompany sales against sister companies' purchases
 * evaluated strictly against the 4 reconciliation criteria:
 *  1. PERFECT_MATCH: Reference matches, amounts match, and all items match.
 *  2. AMOUNT_MISMATCH: Reference matches, but voucher/gross amount differs.
 *  3. ITEM_MISMATCH: Reference matches and total amount matches, but item name/rate/qty/amount differs.
 *  4. VOUCHER_MISMATCH: Sales voucher has no corresponding purchase voucher in sister company books.
 *
 * @param {Object} params
 * @param {string} params.companyId - The seller company ObjectId
 * @param {string} [params.targetCompany="all"] - "all" or specific counterparty company ID / name
 * @returns {Promise<Object>} Reconciliation report with summary breakdown and classified records
 */
export const getKnockoffSalesService = async ({ companyId, targetCompany = "all" }) => {
  // 1. Resolve seller company and its tenant
  const sellerCompany = await Company.findById(companyId).lean();
  if (!sellerCompany) {
    throw ApiError.notFound(`Company not found with ID: ${companyId}`);
  }

  if (!sellerCompany.tenant_id) {
    throw ApiError.badRequest("Selected company has no tenant assigned");
  }

  // 2. Fetch all active sister companies under the same tenant
  const sisterCompanies = await Company.find({
    tenant_id: sellerCompany.tenant_id,
    _id: { $ne: sellerCompany._id },
    is_deleted: { $ne: true },
  })
    .select("_id name tally_company_name gstin")
    .lean();

  const sisterCompanyIds = sisterCompanies.map((c) => c._id);
  const sisterCompanyMap = new Map(sisterCompanies.map((c) => [c._id.toString(), c]));

  // 3. Fetch all active sales vouchers for the seller company
  const salesVouchers = await Voucher.find({
    company_id: sellerCompany._id,
    vchtype: { $regex: /sales/i },
    is_cancelled: { $ne: true },
    is_deleted: { $ne: true },
  })
    .populate("party_ledger_id", "name parent")
    .sort({ date: 1 })
    .lean();

  // 3b. Filter sales vouchers to ONLY those issued to sister companies under the same tenant
  const intercompanySales = salesVouchers.filter((sale) => {
    const partyName = normalizeText(sale.party_ledger_id?.name || sale.party_name);
    return sisterCompanies.some((sc) => {
      return (
        normalizeText(sc.name) === partyName ||
        normalizeText(sc.tally_company_name) === partyName
      );
    });
  });

  if (intercompanySales.length === 0) {
    return {
      seller_company: {
        id: sellerCompany._id,
        name: sellerCompany.name,
        tally_company_name: sellerCompany.tally_company_name,
        last_sync_at: sellerCompany.last_sync_at,
      },
      filter_applied: targetCompany,
      summary: {
        total_sales: 0,
        perfect_match_count: 0,
        amount_mismatch_count: 0,
        item_mismatch_count: 0,
        voucher_mismatch_count: 0,
        party_mismatch_count: 0,
        total_sales_amount: 0,
        reconciled_amount: 0,
        exposure_amount: 0,
        health_percentage: 100,
        knocked_off_count: 0,
        pending_count: 0,
        total_sales_gst: { cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 },
        total_purchase_gst: { cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 },
      },
      records: [],
    };
  }

  const salesVoucherIds = intercompanySales.map((v) => v._id);

  // 4. Fetch inventory entries for these sales vouchers
  const salesInventory = await InventoryEntry.find({
    voucher_id: { $in: salesVoucherIds },
    is_deleted: { $ne: true },
  }).lean();

  // Map sales inventory by voucher_id
  const salesInventoryMap = new Map();
  for (const item of salesInventory) {
    const key = item.voucher_id.toString();
    if (!salesInventoryMap.has(key)) {
      salesInventoryMap.set(key, []);
    }
    salesInventoryMap.get(key).push(item);
  }

  // 5. Fetch all active purchase vouchers across sister companies under this tenant
  const purchaseVouchers = await Voucher.find({
    company_id: { $in: sisterCompanyIds },
    vchtype: { $regex: /purchase/i },
    is_cancelled: { $ne: true },
    is_deleted: { $ne: true },
  })
    .populate("party_ledger_id", "name parent")
    .lean();

  const purchaseVoucherIds = purchaseVouchers.map((p) => p._id);

  // 6. Fetch inventory entries for purchase vouchers
  const purchaseInventory = await InventoryEntry.find({
    voucher_id: { $in: purchaseVoucherIds },
    is_deleted: { $ne: true },
  }).lean();

  // Map purchase inventory by voucher_id
  const purchaseInventoryMap = new Map();
  for (const item of purchaseInventory) {
    const key = item.voucher_id.toString();
    if (!purchaseInventoryMap.has(key)) {
      purchaseInventoryMap.set(key, []);
    }
    purchaseInventoryMap.get(key).push(item);
  }

  // 6b. Fetch ledger entries for all vouchers (sales + purchase) to compute GST breakdown
  const allVoucherIds = [...salesVoucherIds, ...purchaseVoucherIds];
  const allLedgerEntries = await LedgerEntry.find({
    voucher_id: { $in: allVoucherIds },
    is_deleted: { $ne: true },
  })
    .populate("ledger_id", "name parent")
    .lean();

  // Map ledger entries by voucher_id for O(1) lookup
  const ledgerEntriesMap = new Map();
  for (const le of allLedgerEntries) {
    const key = le.voucher_id.toString();
    if (!ledgerEntriesMap.has(key)) {
      ledgerEntriesMap.set(key, []);
    }
    ledgerEntriesMap.get(key).push(le);
  }

  // 7. Evaluate each sales voucher against the 4 reconciliation criteria
  let report = [];

  for (const sale of intercompanySales) {
    const partyName = sale.party_ledger_id?.name || "Unknown";
    const normalizedParty = normalizeText(partyName);

    // Identify which sister company this customer corresponds to
    const counterpartyCompany = sisterCompanies.find((sc) => {
      const nameMatch = normalizeText(sc.name) === normalizedParty;
      const tallyNameMatch = normalizeText(sc.tally_company_name) === normalizedParty;
      return nameMatch || tallyNameMatch;
    });

    const saleVoucherNo = (sale.voucher_number || "").trim();
    const salesGstBreakdown = calculateGstBreakdown(ledgerEntriesMap.get(sale._id.toString()) || []);

    let saleTaxableTotal = Math.abs(Number(sale.amount) || 0);
    const sItems = salesInventoryMap.get(sale._id.toString()) || [];
    if (saleTaxableTotal === 0 && sItems.length > 0) {
      saleTaxableTotal = sItems.reduce((sum, it) => sum + Math.abs(Number(it.amount) || 0), 0);
    }
    const saleGrossTotal = Math.round((saleTaxableTotal + (salesGstBreakdown.total || 0)) * 100) / 100;

    // Knock-off match: 
    // 1. Primary search: purchase vouchers belonging to the expected counterparty company
    // where reference_number equals sale voucher_number
    let matchedPurchase = null;
    let isPartyMismatch = false;

    if (counterpartyCompany && saleVoucherNo) {
      matchedPurchase = purchaseVouchers.find((pv) => {
        if (pv.company_id.toString() !== counterpartyCompany._id.toString()) {
          return false;
        }
        const refNo = (pv.reference_number || "").trim();
        return refNo && refNo.toLowerCase() === saleVoucherNo.toLowerCase();
      });
    }

    // 2. Secondary search (Intercompany cross-entity lookup):
    // If not found in the intended counterparty company, check across all other sister companies for matching reference
    if (!matchedPurchase && saleVoucherNo) {
      matchedPurchase = purchaseVouchers.find((pv) => {
        const refNo = (pv.reference_number || "").trim();
        return refNo && refNo.toLowerCase() === saleVoucherNo.toLowerCase();
      });
      if (matchedPurchase) {
        isPartyMismatch = true;
      }
    }

    let matchedPurchaseDetails = null;
    let pItems = [];
    let purchaseGstBreakdown = null;
    let purchaseGrossTotal = 0;
    let purchaseTaxableTotal = 0;

    if (matchedPurchase) {
      const buyerCompany = sisterCompanyMap.get(matchedPurchase.company_id.toString());
      pItems = purchaseInventoryMap.get(matchedPurchase._id.toString()) || [];

      purchaseTaxableTotal = Math.abs(Number(matchedPurchase.amount) || 0);
      if (purchaseTaxableTotal === 0 && pItems.length > 0) {
        purchaseTaxableTotal = pItems.reduce((sum, it) => sum + Math.abs(Number(it.amount) || 0), 0);
      }
      purchaseGstBreakdown = calculateGstBreakdown(ledgerEntriesMap.get(matchedPurchase._id.toString()) || []);
      purchaseGrossTotal = Math.round((purchaseTaxableTotal + (purchaseGstBreakdown.total || 0)) * 100) / 100;

      matchedPurchaseDetails = {
        purchase_voucher_id: matchedPurchase._id,
        buyer_company_id: matchedPurchase.company_id,
        buyer_company_name: buyerCompany?.name || "Unknown",
        supplier_party_name: matchedPurchase.party_ledger_id?.name || null,
        voucher_number: matchedPurchase.voucher_number,
        reference_number: matchedPurchase.reference_number,
        reference_date: matchedPurchase.reference_date || matchedPurchase.date,
        total_amount: purchaseGrossTotal,
        taxable_amount: purchaseTaxableTotal,
        items: pItems.map((pi) => ({
          stock_item_name: pi.stock_item_name,
          quantity: pi.quantity,
          rate: pi.rate,
          amount: Math.abs(Number(pi.amount) || 0),
        })),
      };
    }

    // ─── Evaluation of the Reconciliation Criteria ─────────────────────────
    let matchStatus = "VOUCHER_MISMATCH";
    let mismatchReason = null;
    let amountDifference = 0;
    let isKnockedOff = false;

    if (!matchedPurchase) {
      // Criterion 1: VOUCHER_MISMATCH (Sales exists, purchase does not exist)
      matchStatus = "VOUCHER_MISMATCH";
      mismatchReason = `Purchase voucher with reference "${saleVoucherNo}" not found in ${counterpartyCompany ? counterpartyCompany.name : "sister company"}`;
      amountDifference = saleGrossTotal;
      isKnockedOff = false;
    } else if (isPartyMismatch) {
      // Criterion: PARTY_MISMATCH (Reference matched in sister company, but booked by the wrong entity)
      const buyerCompany = sisterCompanyMap.get(matchedPurchase.company_id.toString());
      const buyerName = buyerCompany?.name || "Unknown sister company";
      matchStatus = "PARTY_MISMATCH";
      mismatchReason = `Party mismatch: Sales invoice was issued to "${partyName}", but Purchase voucher was recorded by "${buyerName}" (Voucher: ${matchedPurchase.voucher_number || "N/A"})`;
      amountDifference = Math.round((saleGrossTotal - purchaseGrossTotal) * 100) / 100;
      isKnockedOff = false;
    } else {
      amountDifference = Math.round((saleGrossTotal - purchaseGrossTotal) * 100) / 100;

      // Criterion 2: AMOUNT_MISMATCH (Voucher gross / total amount mismatch)
      if (Math.abs(amountDifference) > 0.05) {
        matchStatus = "AMOUNT_MISMATCH";
        mismatchReason = `Voucher amount mismatch: Sale is ₹${saleGrossTotal.toFixed(2)}, Purchase is ₹${purchaseGrossTotal.toFixed(2)} (Variance: ₹${Math.abs(amountDifference).toFixed(2)})`;
        isKnockedOff = false;
      } else {
        // Criterion 3 & 4: Check Line Items for ITEM_MISMATCH vs PERFECT_MATCH
        const itemCheck = compareInventoryItems(sItems, pItems);
        if (!itemCheck.isMatch) {
          matchStatus = "ITEM_MISMATCH";
          mismatchReason = itemCheck.reason;
          isKnockedOff = false;
        } else {
          // Criterion 4: PERFECT_MATCH
          matchStatus = "PERFECT_MATCH";
          mismatchReason = null;
          isKnockedOff = true;
          amountDifference = 0;
        }
      }
    }

    // ─── Build Report Records (Line Item or Voucher Header) ──────────────────
    if (sItems.length > 0) {
      for (const item of sItems) {
        const itemTaxableAmount = Math.abs(Number(item.amount) || 0);
        const itemGst = saleTaxableTotal > 0
          ? Math.round(((itemTaxableAmount / saleTaxableTotal) * (salesGstBreakdown.total || 0)) * 100) / 100
          : 0;
        const itemGrossAmount = Math.round((itemTaxableAmount + itemGst) * 100) / 100;
        const matchedItem = pItems.find(
          (pi) => normalizeText(pi.stock_item_name) === normalizeText(item.stock_item_name)
        );

        report.push({
          sales_voucher_id: sale._id,
          voucher_number: sale.voucher_number,
          date: sale.date,
          seller_party_name: partyName,
          buyer_supplier_party_name: matchedPurchaseDetails ? matchedPurchaseDetails.supplier_party_name : null,
          counterparty_company_id: counterpartyCompany ? counterpartyCompany._id : null,
          counterparty_company_name: counterpartyCompany ? counterpartyCompany.name : partyName,
          vendor_party_name: matchedPurchaseDetails?.vendor_party_name || sellerCompany.name,
          stock_item_name: item.stock_item_name,
          quantity: item.quantity,
          rate: item.rate,
          sales_amount: itemGrossAmount,
          sales_taxable_amount: itemTaxableAmount,
          sales_voucher_total: saleGrossTotal,
          sales_gst_breakdown: salesGstBreakdown,
          purchase_voucher_total: matchedPurchaseDetails ? purchaseGrossTotal : 0,
          purchase_gst_breakdown: purchaseGstBreakdown,
          amount_difference: amountDifference,
          purchase_status: matchedPurchaseDetails ? "PRESENT" : "NOT_PRESENT",
          is_knocked_off: isKnockedOff,
          match_status: matchStatus,
          mismatch_reason: mismatchReason,
          matched_purchase: matchedPurchaseDetails,
          matched_item: matchedItem
            ? {
                stock_item_name: matchedItem.stock_item_name,
                quantity: matchedItem.quantity,
                rate: matchedItem.rate,
                amount: Math.abs(Number(matchedItem.amount) || 0),
              }
            : null,
        });
      }
    } else {
      // Service or Non-Inventory Sales Voucher
      report.push({
        sales_voucher_id: sale._id,
        voucher_number: sale.voucher_number,
        date: sale.date,
        seller_party_name: partyName,
        buyer_supplier_party_name: matchedPurchaseDetails ? matchedPurchaseDetails.supplier_party_name : null,
        counterparty_company_id: counterpartyCompany ? counterpartyCompany._id : null,
        counterparty_company_name: counterpartyCompany ? counterpartyCompany.name : partyName,
        vendor_party_name: matchedPurchaseDetails?.vendor_party_name || sellerCompany.name,
        stock_item_name: "N/A",
        quantity: "-",
        rate: "-",
        sales_amount: saleGrossTotal,
        sales_taxable_amount: saleTaxableTotal,
        sales_voucher_total: saleGrossTotal,
        sales_gst_breakdown: salesGstBreakdown,
        purchase_voucher_total: matchedPurchaseDetails ? purchaseGrossTotal : 0,
        purchase_gst_breakdown: purchaseGstBreakdown,
        amount_difference: amountDifference,
        purchase_status: matchedPurchaseDetails ? "PRESENT" : "NOT_PRESENT",
        is_knocked_off: isKnockedOff,
        match_status: matchStatus,
        mismatch_reason: mismatchReason,
        matched_purchase: matchedPurchaseDetails,
        matched_item: null,
      });
    }
  }

  // 8. Apply counterparty company filter if specified and not 'all'
  if (targetCompany && targetCompany.trim().toLowerCase() !== "all") {
    const targetFilter = targetCompany.trim().toLowerCase();
    report = report.filter((r) => {
      const idMatch = r.counterparty_company_id?.toString() === targetCompany.trim();
      const nameMatch = normalizeText(r.counterparty_company_name).includes(targetFilter);
      return idMatch || nameMatch;
    });
  }

  // 9. Calculate 4-Criteria Summary Metrics & Volumes
  const perfectMatchCount = report.filter((r) => r.match_status === "PERFECT_MATCH").length;
  const amountMismatchCount = report.filter((r) => r.match_status === "AMOUNT_MISMATCH").length;
  const itemMismatchCount = report.filter((r) => r.match_status === "ITEM_MISMATCH").length;
  const voucherMismatchCount = report.filter((r) => r.match_status === "VOUCHER_MISMATCH").length;
  const partyMismatchCount = report.filter((r) => r.match_status === "PARTY_MISMATCH").length;

  const totalSalesAmount = report.reduce((sum, r) => sum + (r.sales_amount || 0), 0);
  const reconciledAmount = report
    .filter((r) => r.match_status === "PERFECT_MATCH")
    .reduce((sum, r) => sum + (r.sales_amount || 0), 0);
  const exposureAmount = report
    .filter((r) => r.match_status !== "PERFECT_MATCH")
    .reduce((sum, r) => sum + (r.sales_amount || 0), 0);

  return {
    seller_company: {
      id: sellerCompany._id,
      name: sellerCompany.name,
      tally_company_name: sellerCompany.tally_company_name,
      last_sync_at: sellerCompany.last_sync_at,
    },
    filter_applied: targetCompany,
    summary: {
      total_sales: report.length,
      perfect_match_count: perfectMatchCount,
      amount_mismatch_count: amountMismatchCount,
      item_mismatch_count: itemMismatchCount,
      voucher_mismatch_count: voucherMismatchCount,
      party_mismatch_count: partyMismatchCount,
      total_sales_amount: totalSalesAmount,
      reconciled_amount: reconciledAmount,
      exposure_amount: exposureAmount,
      health_percentage: report.length ? Math.round((perfectMatchCount / report.length) * 1000) / 10 : 0,
      knocked_off_count: perfectMatchCount,
      pending_count: report.length - perfectMatchCount,
      total_sales_gst: report.reduce((acc, r) => {
        if (!r.sales_gst_breakdown) return acc;
        return {
          cgst: Math.round((acc.cgst + r.sales_gst_breakdown.cgst) * 100) / 100,
          sgst: Math.round((acc.sgst + r.sales_gst_breakdown.sgst) * 100) / 100,
          igst: Math.round((acc.igst + r.sales_gst_breakdown.igst) * 100) / 100,
          cess: Math.round((acc.cess + r.sales_gst_breakdown.cess) * 100) / 100,
          total: Math.round((acc.total + r.sales_gst_breakdown.total) * 100) / 100,
        };
      }, { cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 }),
      total_purchase_gst: report.reduce((acc, r) => {
        if (!r.purchase_gst_breakdown) return acc;
        return {
          cgst: Math.round((acc.cgst + r.purchase_gst_breakdown.cgst) * 100) / 100,
          sgst: Math.round((acc.sgst + r.purchase_gst_breakdown.sgst) * 100) / 100,
          igst: Math.round((acc.igst + r.purchase_gst_breakdown.igst) * 100) / 100,
          cess: Math.round((acc.cess + r.purchase_gst_breakdown.cess) * 100) / 100,
          total: Math.round((acc.total + r.purchase_gst_breakdown.total) * 100) / 100,
        };
      }, { cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 }),
    },
    records: report,
  };
};

/**
 * Service to list all active companies for the knockoff selector
 *
 * @param {Object} [params]
 * @param {string} [params.tenantId] - Optional tenant filter
 * @returns {Promise<Array>} List of companies with sales voucher counts
 */
export const getKnockoffCompaniesService = async ({ tenantId } = {}) => {
  const filter = { is_deleted: { $ne: true } };
  if (tenantId) filter.tenant_id = tenantId;

  const companies = await Company.find(filter)
    .select("_id name tally_company_name tenant_id last_sync_at")
    .sort({ name: 1 })
    .lean();

  const companyIds = companies.map((c) => c._id);

  // Build sister company names to match inter-company party ledgers
  const sisterNames = new Set();
  companies.forEach((c) => {
    if (c.name) sisterNames.add(normalizeText(c.name));
    if (c.tally_company_name) sisterNames.add(normalizeText(c.tally_company_name));
  });

  const nameRegexes = Array.from(sisterNames).map(
    (n) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")
  );

  let intercompanyLedgerIds = [];
  if (nameRegexes.length > 0) {
    const matchingLedgers = await Ledger.find({
      company_id: { $in: companyIds },
      name: { $in: nameRegexes },
      is_deleted: { $ne: true },
    })
      .select("_id")
      .lean();
    intercompanyLedgerIds = matchingLedgers.map((l) => l._id);
  }

  const intercompanyPartyMatch = [
    ...(intercompanyLedgerIds.length > 0
      ? [{ party_ledger_id: { $in: intercompanyLedgerIds } }]
      : []),
    ...(nameRegexes.length > 0
      ? [{ party_name: { $in: nameRegexes } }]
      : []),
  ];

  const intercompanyMatch = {
    company_id: { $in: companyIds },
    is_cancelled: { $ne: true },
    is_deleted: { $ne: true },
    ...(intercompanyPartyMatch.length > 0
      ? { $or: intercompanyPartyMatch }
      : { _id: null }),
  };

  const [salesCounts, purchaseCounts] = await Promise.all([
    Voucher.aggregate([
      {
        $match: {
          ...intercompanyMatch,
          vchtype: { $regex: /sales/i },
        },
      },
      { $group: { _id: "$company_id", count: { $sum: 1 } } },
    ]),
    Voucher.aggregate([
      {
        $match: {
          ...intercompanyMatch,
          vchtype: { $regex: /purchase/i },
        },
      },
      { $group: { _id: "$company_id", count: { $sum: 1 } } },
    ]),
  ]);

  const salesCountMap = new Map(salesCounts.map((sc) => [sc._id.toString(), sc.count]));
  const purchaseCountMap = new Map(purchaseCounts.map((pc) => [pc._id.toString(), pc.count]));

  return companies.map((c) => ({
    id: c._id,
    name: c.name,
    tally_company_name: c.tally_company_name,
    tenant_id: c.tenant_id,
    last_sync_at: c.last_sync_at,
    sales_vouchers_count: salesCountMap.get(c._id.toString()) || 0,
    purchase_vouchers_count: purchaseCountMap.get(c._id.toString()) || 0,
  }));
};

export const getKnockoffPurchasesService = async ({ companyId, targetCompany = "all" }) => {
  // 1. Resolve buyer company and its tenant
  const buyerCompany = await Company.findById(companyId).lean();
  if (!buyerCompany) {
    throw ApiError.notFound(`Company not found with ID: ${companyId}`);
  }

  if (!buyerCompany.tenant_id) {
    throw ApiError.badRequest("Selected company has no tenant assigned");
  }

  // 2. Fetch all active sister companies under the same tenant
  const sisterCompanies = await Company.find({
    tenant_id: buyerCompany.tenant_id,
    _id: { $ne: buyerCompany._id },
    is_deleted: { $ne: true },
  })
    .select("_id name tally_company_name gstin")
    .lean();

  const sisterCompanyIds = sisterCompanies.map((c) => c._id);
  const sisterCompanyMap = new Map(sisterCompanies.map((c) => [c._id.toString(), c]));

  const buyerNameNorm = normalizeText(buyerCompany.name);
  const buyerTallyNameNorm = normalizeText(buyerCompany.tally_company_name);

  // 3. Fetch all sales vouchers created by sister companies where customer matches buyerCompany
  const sisterSalesVouchers = await Voucher.find({
    company_id: { $in: sisterCompanyIds },
    vchtype: { $regex: /sales/i },
    is_cancelled: { $ne: true },
    is_deleted: { $ne: true },
  })
    .populate("party_ledger_id", "name parent")
    .sort({ date: 1 })
    .lean();

  // Filter sales vouchers where customer is buyerCompany
  const inboundSales = sisterSalesVouchers.filter((sale) => {
    const partyName = normalizeText(sale.party_ledger_id?.name);
    return partyName === buyerNameNorm || (buyerTallyNameNorm && partyName === buyerTallyNameNorm);
  });

  if (inboundSales.length === 0) {
    return {
      buyer_company: {
        id: buyerCompany._id,
        name: buyerCompany.name,
        tally_company_name: buyerCompany.tally_company_name,
        last_sync_at: buyerCompany.last_sync_at,
      },
      summary: {
        total_inbound: 0,
        perfect_match_count: 0,
        amount_mismatch_count: 0,
        item_mismatch_count: 0,
        voucher_mismatch_count: 0,
        unrecorded_count: 0,
        party_mismatch_count: 0,
        total_inbound_amount: 0,
        reconciled_amount: 0,
        exposure_amount: 0,
        health_percentage: 100,
        knocked_off_count: 0,
        pending_count: 0,
        total_sales_gst: { cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 },
        total_purchase_gst: { cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 },
      },
      records: [],
    };
  }

  const inboundSalesIds = inboundSales.map((s) => s._id);

  // 4. Fetch line items for inbound sales
  const salesInventory = await InventoryEntry.find({
    voucher_id: { $in: inboundSalesIds },
    is_deleted: { $ne: true },
  }).lean();

  const salesInventoryMap = new Map();
  for (const item of salesInventory) {
    const key = item.voucher_id.toString();
    if (!salesInventoryMap.has(key)) {
      salesInventoryMap.set(key, []);
    }
    salesInventoryMap.get(key).push(item);
  }

  // 5. Fetch buyer's own purchase vouchers
  const myPurchaseVouchers = await Voucher.find({
    company_id: buyerCompany._id,
    vchtype: { $regex: /purchase/i },
    is_cancelled: { $ne: true },
    is_deleted: { $ne: true },
  })
    .populate("party_ledger_id", "name parent")
    .lean();

  const myPurchaseIds = myPurchaseVouchers.map((p) => p._id);

  // 6. Fetch line items for buyer's purchases
  const purchaseInventory = await InventoryEntry.find({
    voucher_id: { $in: myPurchaseIds },
    is_deleted: { $ne: true },
  }).lean();

  const purchaseInventoryMap = new Map();
  for (const item of purchaseInventory) {
    const key = item.voucher_id.toString();
    if (!purchaseInventoryMap.has(key)) {
      purchaseInventoryMap.set(key, []);
    }
    purchaseInventoryMap.get(key).push(item);
  }

  // 6b. Fetch ledger entries for all vouchers (inbound sales + buyer's purchases) to compute GST breakdown
  const allVoucherIds = [...inboundSalesIds, ...myPurchaseIds];
  const allLedgerEntries = await LedgerEntry.find({
    voucher_id: { $in: allVoucherIds },
    is_deleted: { $ne: true },
  })
    .populate("ledger_id", "name parent")
    .lean();

  const ledgerEntriesMap = new Map();
  for (const le of allLedgerEntries) {
    const key = le.voucher_id.toString();
    if (!ledgerEntriesMap.has(key)) {
      ledgerEntriesMap.set(key, []);
    }
    ledgerEntriesMap.get(key).push(le);
  }

  // 7. Evaluate each inbound sale against buyer's purchases
  let report = [];

  for (const sale of inboundSales) {
    const sellerCompany = sisterCompanyMap.get(sale.company_id.toString());
    const sellerName = sellerCompany?.name || "Sister Branch";
    const saleVoucherNo = (sale.voucher_number || "").trim();
    const salesGstBreakdown = calculateGstBreakdown(ledgerEntriesMap.get(sale._id.toString()) || []);

    let saleTaxableTotal = Math.abs(Number(sale.amount) || 0);
    const sItems = salesInventoryMap.get(sale._id.toString()) || [];
    if (saleTaxableTotal === 0 && sItems.length > 0) {
      saleTaxableTotal = sItems.reduce((sum, it) => sum + Math.abs(Number(it.amount) || 0), 0);
    }
    const saleGrossTotal = Math.round((saleTaxableTotal + (salesGstBreakdown.total || 0)) * 100) / 100;

    // Match in buyer's purchase vouchers where reference_number equals sale voucher_number
    let matchedPurchase = null;
    if (saleVoucherNo) {
      matchedPurchase = myPurchaseVouchers.find((pv) => {
        const refNo = (pv.reference_number || "").trim();
        return refNo && refNo.toLowerCase() === saleVoucherNo.toLowerCase();
      });
    }

    let matchedPurchaseDetails = null;
    let pItems = [];
    let purchaseGstBreakdown = null;
    let purchaseGrossTotal = 0;
    let purchaseTaxableTotal = 0;

    if (matchedPurchase) {
      pItems = purchaseInventoryMap.get(matchedPurchase._id.toString()) || [];
      purchaseTaxableTotal = Math.abs(Number(matchedPurchase.amount) || 0);
      if (purchaseTaxableTotal === 0 && pItems.length > 0) {
        purchaseTaxableTotal = pItems.reduce((sum, it) => sum + Math.abs(Number(it.amount) || 0), 0);
      }
      purchaseGstBreakdown = calculateGstBreakdown(ledgerEntriesMap.get(matchedPurchase._id.toString()) || []);
      purchaseGrossTotal = Math.round((purchaseTaxableTotal + (purchaseGstBreakdown.total || 0)) * 100) / 100;

      matchedPurchaseDetails = {
        purchase_voucher_id: matchedPurchase._id,
        buyer_company_id: buyerCompany._id,
        buyer_company_name: buyerCompany.name,
        supplier_party_name: matchedPurchase.party_ledger_id?.name || null,
        voucher_number: matchedPurchase.voucher_number,
        reference_number: matchedPurchase.reference_number,
        reference_date: matchedPurchase.reference_date || matchedPurchase.date,
        total_amount: purchaseGrossTotal,
        taxable_amount: purchaseTaxableTotal,
        items: pItems.map((pi) => ({
          stock_item_name: pi.stock_item_name,
          quantity: pi.quantity,
          rate: pi.rate,
          amount: Math.abs(Number(pi.amount) || 0),
        })),
      };
    }

    // Evaluation
    let matchStatus = "VOUCHER_MISMATCH";
    let mismatchReason = null;
    let amountDifference = 0;
    let isKnockedOff = false;

    if (!matchedPurchase) {
      matchStatus = "VOUCHER_MISMATCH";
      mismatchReason = `Unrecorded purchase: ${sellerName} issued sales invoice "${saleVoucherNo}", but no matching purchase voucher was found in your books`;
      amountDifference = saleGrossTotal;
      isKnockedOff = false;
    } else {
      amountDifference = Math.round((saleGrossTotal - purchaseGrossTotal) * 100) / 100;

      if (Math.abs(amountDifference) > 0.05) {
        matchStatus = "AMOUNT_MISMATCH";
        mismatchReason = `Amount mismatch: Inbound bill is ₹${saleGrossTotal.toFixed(2)}, but your recorded purchase is ₹${purchaseGrossTotal.toFixed(2)} (Variance: ₹${Math.abs(amountDifference).toFixed(2)})`;
        isKnockedOff = false;
      } else {
        const itemCheck = compareInventoryItems(sItems, pItems);
        if (!itemCheck.isMatch) {
          matchStatus = "ITEM_MISMATCH";
          mismatchReason = itemCheck.reason;
          isKnockedOff = false;
        } else {
          matchStatus = "PERFECT_MATCH";
          mismatchReason = null;
          isKnockedOff = true;
          amountDifference = 0;
        }
      }
    }

    const customerPartyName = sale.party_ledger_id?.name || buyerCompany.name;
    const supplierPartyName = matchedPurchaseDetails ? matchedPurchaseDetails.supplier_party_name : sellerName;

    if (sItems.length > 0) {
      for (const item of sItems) {
        const itemTaxableAmount = Math.abs(Number(item.amount) || 0);
        const itemGst = saleTaxableTotal > 0
          ? Math.round(((itemTaxableAmount / saleTaxableTotal) * (salesGstBreakdown.total || 0)) * 100) / 100
          : 0;
        const itemGrossAmount = Math.round((itemTaxableAmount + itemGst) * 100) / 100;
        const matchedItem = pItems.find(
          (pi) => normalizeText(pi.stock_item_name) === normalizeText(item.stock_item_name)
        );

        report.push({
          sales_voucher_id: sale._id,
          voucher_number: sale.voucher_number,
          date: sale.date,
          seller_company_name: sellerName,
          seller_company_id: sale.company_id,
          seller_party_name: customerPartyName,
          customer_party_name: customerPartyName,
          buyer_company_name: buyerCompany.name,
          buyer_supplier_party_name: supplierPartyName,
          counterparty_company_id: sale.company_id,
          counterparty_company_name: sellerName,
          vendor_party_name: supplierPartyName,
          stock_item_name: item.stock_item_name,
          quantity: item.quantity,
          rate: item.rate,
          sales_amount: itemGrossAmount,
          sales_taxable_amount: itemTaxableAmount,
          sales_voucher_total: saleGrossTotal,
          sales_gst_breakdown: salesGstBreakdown,
          purchase_voucher_total: matchedPurchaseDetails ? purchaseGrossTotal : 0,
          purchase_gst_breakdown: purchaseGstBreakdown,
          amount_difference: amountDifference,
          purchase_status: matchedPurchaseDetails ? "PRESENT" : "NOT_PRESENT",
          is_knocked_off: isKnockedOff,
          match_status: matchStatus,
          mismatch_reason: mismatchReason,
          matched_purchase: matchedPurchaseDetails,
          matched_item: matchedItem
            ? {
                stock_item_name: matchedItem.stock_item_name,
                quantity: matchedItem.quantity,
                rate: matchedItem.rate,
                amount: Math.abs(Number(matchedItem.amount) || 0),
              }
            : null,
        });
      }
    } else {
      report.push({
        sales_voucher_id: sale._id,
        voucher_number: sale.voucher_number,
        date: sale.date,
        seller_company_name: sellerName,
        seller_company_id: sale.company_id,
        seller_party_name: customerPartyName,
        customer_party_name: customerPartyName,
        buyer_company_name: buyerCompany.name,
        buyer_supplier_party_name: supplierPartyName,
        counterparty_company_id: sale.company_id,
        counterparty_company_name: sellerName,
        vendor_party_name: supplierPartyName,
        stock_item_name: "N/A",
        quantity: "-",
        rate: "-",
        sales_amount: saleGrossTotal,
        sales_taxable_amount: saleTaxableTotal,
        sales_voucher_total: saleGrossTotal,
        sales_gst_breakdown: salesGstBreakdown,
        purchase_voucher_total: matchedPurchaseDetails ? purchaseGrossTotal : 0,
        purchase_gst_breakdown: purchaseGstBreakdown,
        amount_difference: amountDifference,
        purchase_status: matchedPurchaseDetails ? "PRESENT" : "NOT_PRESENT",
        is_knocked_off: isKnockedOff,
        match_status: matchStatus,
        mismatch_reason: mismatchReason,
        matched_purchase: matchedPurchaseDetails,
        matched_item: null,
      });
    }
  }

  // Filter by seller sister company if specified
  if (targetCompany && targetCompany.trim().toLowerCase() !== "all") {
    const targetFilter = targetCompany.trim().toLowerCase();
    report = report.filter((r) => {
      const idMatch = r.seller_company_id?.toString() === targetCompany.trim();
      const nameMatch = normalizeText(r.seller_company_name).includes(targetFilter);
      return idMatch || nameMatch;
    });
  }

  // Summary Metrics
  const perfectMatchCount = report.filter((r) => r.match_status === "PERFECT_MATCH").length;
  const amountMismatchCount = report.filter((r) => r.match_status === "AMOUNT_MISMATCH").length;
  const itemMismatchCount = report.filter((r) => r.match_status === "ITEM_MISMATCH").length;
  const voucherMismatchCount = report.filter((r) => r.match_status === "VOUCHER_MISMATCH").length;

  const totalInboundAmount = report.reduce((sum, r) => sum + (r.sales_amount || 0), 0);
  const reconciledAmount = report
    .filter((r) => r.match_status === "PERFECT_MATCH")
    .reduce((sum, r) => sum + (r.sales_amount || 0), 0);
  const exposureAmount = report
    .filter((r) => r.match_status !== "PERFECT_MATCH")
    .reduce((sum, r) => sum + (r.sales_amount || 0), 0);

  return {
    buyer_company: {
      id: buyerCompany._id,
      name: buyerCompany.name,
      tally_company_name: buyerCompany.tally_company_name,
      last_sync_at: buyerCompany.last_sync_at,
    },
    filter_applied: targetCompany,
    summary: {
      total_sales: report.length,
      total_inbound: report.length,
      perfect_match_count: perfectMatchCount,
      amount_mismatch_count: amountMismatchCount,
      item_mismatch_count: itemMismatchCount,
      voucher_mismatch_count: voucherMismatchCount,
      unrecorded_count: voucherMismatchCount,
      party_mismatch_count: 0,
      total_sales_amount: totalInboundAmount,
      total_inbound_amount: totalInboundAmount,
      reconciled_amount: reconciledAmount,
      exposure_amount: exposureAmount,
      health_percentage: report.length ? Math.round((perfectMatchCount / report.length) * 1000) / 10 : 0,
      knocked_off_count: perfectMatchCount,
      pending_count: report.length - perfectMatchCount,
      total_sales_gst: report.reduce((acc, r) => {
        if (!r.sales_gst_breakdown) return acc;
        return {
          cgst: Math.round((acc.cgst + r.sales_gst_breakdown.cgst) * 100) / 100,
          sgst: Math.round((acc.sgst + r.sales_gst_breakdown.sgst) * 100) / 100,
          igst: Math.round((acc.igst + r.sales_gst_breakdown.igst) * 100) / 100,
          cess: Math.round((acc.cess + r.sales_gst_breakdown.cess) * 100) / 100,
          total: Math.round((acc.total + r.sales_gst_breakdown.total) * 100) / 100,
        };
      }, { cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 }),
      total_purchase_gst: report.reduce((acc, r) => {
        if (!r.purchase_gst_breakdown) return acc;
        return {
          cgst: Math.round((acc.cgst + r.purchase_gst_breakdown.cgst) * 100) / 100,
          sgst: Math.round((acc.sgst + r.purchase_gst_breakdown.sgst) * 100) / 100,
          igst: Math.round((acc.igst + r.purchase_gst_breakdown.igst) * 100) / 100,
          cess: Math.round((acc.cess + r.purchase_gst_breakdown.cess) * 100) / 100,
          total: Math.round((acc.total + r.purchase_gst_breakdown.total) * 100) / 100,
        };
      }, { cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 }),
    },
    records: report,
  };
};

export default {
  getKnockoffSalesService,
  getKnockoffPurchasesService,
  getKnockoffCompaniesService,
};
