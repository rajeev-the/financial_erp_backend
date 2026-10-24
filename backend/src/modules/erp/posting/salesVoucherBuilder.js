import { ALLOWED_GST_RATES } from "../voucher/voucher.unified.schema.js";

/**
 * Utility: Extract 2-digit Indian State Code from GSTIN or fallback
 */
export function extractStateCode(gstin, fallback = "27") {
  if (gstin && typeof gstin === "string" && gstin.trim().length >= 2) {
    const code = gstin.trim().slice(0, 2);
    if (/^\d{2}$/.test(code)) return code;
  }
  return fallback;
}

/**
 * Builds a validated, mathematically balanced Sales Voucher document payload.
 *
 * @param {Object} params
 * @param {Object} params.company - Company document (must contain _id, gstin or state_code)
 * @param {Object} params.party - Customer Ledger document
 * @param {Array} params.items - Client line items [{ itemId, name, hsn, qty, unit, rate, discountPct, taxRate }]
 * @param {String} params.date - "YYYY-MM-DD"
 * @param {String} [params.dueDate] - "YYYY-MM-DD"
 * @param {String} [params.placeOfSupply] - 2-digit state code
 * @param {String} [params.supplyType] - "B2B" | "B2C" | "EXPORT" | "SEZ"
 * @param {String} [params.narration]
 * @param {Object} params.systemLedgers - { salesLedger, cgstLedger, sgstLedger, igstLedger, roundOffLedger }
 * @returns {Object} Ready-to-validate sales voucher payload
 */
export function buildSalesVoucher({
  company,
  party,
  items,
  date,
  dueDate = null,
  placeOfSupply = null,
  supplyType = null,
  narration = null,
  systemLedgers,
}) {
  if (!company || !company._id) throw new Error("company is required");
  if (!party || !party._id) throw new Error("party ledger is required");
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error("items array must contain at least one line item");
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Valid date (YYYY-MM-DD) is required");
  }

  // 1. Determine State Codes & Tax Mode
  const companyState = extractStateCode(company.gstin || company.state_code || "27");
  const partyState = extractStateCode(party.gstin || party.state_code, companyState);
  const pos = placeOfSupply ? String(placeOfSupply).trim() : partyState;

  const isIntraState = pos === companyState;
  const taxMode = isIntraState ? "INTRA" : "INTER";

  // Derive supply type: B2B if GSTIN is present, otherwise B2C
  const resolvedSupplyType =
    supplyType || (party.gstin && party.gstin.trim().length === 15 ? "B2B" : "B2C");

  // 2. Process Items with Line-Level Rounding (Integer Paise)
  let subtotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;
  let cessTotal = 0;

  const processedItems = items.map((it, idx) => {
    const qty = Number(it.qty);
    const rate = Number(it.rate); // in paise
    const taxRate = Number(it.taxRate);

    if (isNaN(qty) || qty <= 0) {
      throw new Error(`Item ${idx + 1} (${it.name}): invalid quantity`);
    }
    if (isNaN(rate) || rate < 0 || !Number.isInteger(rate)) {
      throw new Error(`Item ${idx + 1} (${it.name}): rate must be a non-negative integer in paise`);
    }
    if (!ALLOWED_GST_RATES.includes(taxRate)) {
      throw new Error(
        `Item ${idx + 1} (${it.name}): taxRate ${taxRate}% is not a valid GST slab`
      );
    }

    // Line subtotal
    const lineGross = Math.round(qty * rate);
    const discountPct = Number(it.discountPct) || 0;
    const discount =
      discountPct > 0
        ? Math.round(lineGross * (discountPct / 100))
        : Number(it.discount) || 0;

    const taxableValue = Math.max(0, lineGross - discount);

    // Line Tax computation
    const lineTax = Math.round(taxableValue * (taxRate / 100));
    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    if (isIntraState) {
      cgst = Math.round(lineTax / 2);
      sgst = lineTax - cgst; // guarantees cgst + sgst === lineTax exactly
    } else {
      igst = lineTax;
    }

    const cess = Number(it.cess) || 0;
    const lineTotal = taxableValue + cgst + sgst + igst + cess;

    subtotal += taxableValue;
    cgstTotal += cgst;
    sgstTotal += sgst;
    igstTotal += igst;
    cessTotal += cess;

    return {
      itemId: it.itemId || null,
      name: it.name.trim(),
      hsn: String(it.hsn || "9999").trim(),
      qty,
      unit: (it.unit || "PCS").trim().toUpperCase(),
      rate,
      discountPct,
      discount,
      taxableValue,
      taxRate,
      cgst,
      sgst,
      igst,
      cess,
      total: lineTotal,
      itcEligible: true,
    };
  });

  const taxTotal = cgstTotal + sgstTotal + igstTotal + cessTotal;
  const unroundedGrandTotal = subtotal + taxTotal;

  // Round to nearest Rupee (100 paise)
  const nearestRupee = Math.round(unroundedGrandTotal / 100) * 100;
  const roundOff = nearestRupee - unroundedGrandTotal; // between -50 and +50 paise
  const grandTotal = nearestRupee;

  // 3. Generate Double-Entry Accounting Rows
  const entries = [];

  // DEBIT: Customer Ledger (full invoice grand total)
  entries.push({
    ledgerId: party._id,
    name: party.name,
    debit: grandTotal,
    credit: 0,
  });

  // CREDIT: Sales Account (subtotal)
  entries.push({
    ledgerId: systemLedgers.salesLedger._id,
    name: systemLedgers.salesLedger.name,
    debit: 0,
    credit: subtotal,
  });

  // CREDIT: GST Ledgers
  if (isIntraState) {
    if (cgstTotal > 0) {
      entries.push({
        ledgerId: systemLedgers.cgstLedger._id,
        name: systemLedgers.cgstLedger.name,
        debit: 0,
        credit: cgstTotal,
      });
    }
    if (sgstTotal > 0) {
      entries.push({
        ledgerId: systemLedgers.sgstLedger._id,
        name: systemLedgers.sgstLedger.name,
        debit: 0,
        credit: sgstTotal,
      });
    }
  } else {
    if (igstTotal > 0) {
      entries.push({
        ledgerId: systemLedgers.igstLedger._id,
        name: systemLedgers.igstLedger.name,
        debit: 0,
        credit: igstTotal,
      });
    }
  }

  // Round Off row (if any)
  if (roundOff !== 0 && systemLedgers.roundOffLedger) {
    if (roundOff > 0) {
      // Round off added -> Credit
      entries.push({
        ledgerId: systemLedgers.roundOffLedger._id,
        name: systemLedgers.roundOffLedger.name,
        debit: 0,
        credit: roundOff,
      });
    } else {
      // Round off subtracted -> Debit
      entries.push({
        ledgerId: systemLedgers.roundOffLedger._id,
        name: systemLedgers.roundOffLedger.name,
        debit: Math.abs(roundOff),
        credit: 0,
      });
    }
  }

  // 4. Construct Final Voucher Payload
  return {
    companyId: company._id,
    voucherType: "SALES",
    date,
    dueDate: dueDate || null,
    status: "POSTED",
    paymentStatus: "UNPAID",
    narration: narration || null,

    // Point-in-time Party Snapshot
    party: {
      ledgerId: party._id,
      name: party.name,
      gstin: party.gstin || null,
      stateCode: partyState,
      address: party.address || party.mailing_address || null,
      phone: party.phone || party.mobile || null,
    },

    // GST Compliance
    gst: {
      placeOfSupply: pos,
      supplyType: resolvedSupplyType,
      taxMode,
      reverseCharge: false,
    },

    // Line Items
    items: processedItems,

    // Double-entry entries
    entries,

    // Summary
    summary: {
      subtotal,
      taxTotal,
      roundOff,
      grandTotal,
    },

    sync: {
      source: "APP_DIRECT",
    },
  };
}
