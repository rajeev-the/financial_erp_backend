/**
 * Builds a validated, mathematically balanced Receipt or Payment Voucher document payload.
 *
 * @param {Object} params
 * @param {String} params.voucherType - "RECEIPT" or "PAYMENT"
 * @param {Object} params.company - Company document
 * @param {Object} params.party - Customer or Vendor Ledger document
 * @param {Object} params.bankLedger - Cash or Bank Ledger document
 * @param {Number} params.amount - Total amount in paise (integer)
 * @param {String} params.date - "YYYY-MM-DD"
 * @param {String} [params.mode="BANK"] - "CASH" | "BANK" | "UPI" | "CHEQUE" | "CARD" | "OTHER"
 * @param {String} [params.reference] - Cheque / UTR number
 * @param {Array} [params.allocations=[]] - [{ voucherId, voucherNumber, amount }]
 * @param {String} [params.narration]
 * @returns {Object} Ready-to-validate voucher payload
 */
export function buildReceiptOrPaymentVoucher({
  voucherType,
  company,
  party,
  bankLedger,
  amount,
  date,
  mode = "BANK",
  reference = null,
  allocations = [],
  narration = null,
}) {
  if (!["RECEIPT", "PAYMENT"].includes(voucherType)) {
    throw new Error(`voucherType must be RECEIPT or PAYMENT, got: ${voucherType}`);
  }
  if (!company || !company._id) throw new Error("company is required");
  if (!party || !party._id) throw new Error("party ledger is required");
  if (!bankLedger || !bankLedger._id) throw new Error("bankLedger is required");

  const totalPaise = Number(amount);
  if (!Number.isInteger(totalPaise) || totalPaise <= 0) {
    throw new Error("amount must be a positive integer in paise");
  }

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Valid date (YYYY-MM-DD) is required");
  }

  // Validate allocations sum does not exceed total amount
  let allocatedSum = 0;
  const processedAllocations = [];

  for (let i = 0; i < allocations.length; i++) {
    const alloc = allocations[i];
    const allocPaise = Number(alloc.amount);
    if (!Number.isInteger(allocPaise) || allocPaise <= 0) {
      throw new Error(`Allocation ${i + 1}: amount must be a positive integer in paise`);
    }
    allocatedSum += allocPaise;
    processedAllocations.push({
      voucherId: alloc.voucherId,
      voucherNumber: alloc.voucherNumber || "INV",
      amount: allocPaise,
    });
  }

  if (allocatedSum > totalPaise) {
    throw new Error(
      `Allocated sum (${allocatedSum} paise) cannot exceed voucher amount (${totalPaise} paise)`
    );
  }

  // Double-Entry Accounting Rows:
  // RECEIPT (Customer pays company):
  // - Debit Bank/Cash (Asset increases)
  // - Credit Customer (Receivable decreases)
  // PAYMENT (Company pays vendor):
  // - Debit Vendor (Payable decreases)
  // - Credit Bank/Cash (Asset decreases)
  const entries = [];

  if (voucherType === "RECEIPT") {
    entries.push({
      ledgerId: bankLedger._id,
      name: bankLedger.name,
      debit: totalPaise,
      credit: 0,
    });
    entries.push({
      ledgerId: party._id,
      name: party.name,
      debit: 0,
      credit: totalPaise,
    });
  } else {
    entries.push({
      ledgerId: party._id,
      name: party.name,
      debit: totalPaise,
      credit: 0,
    });
    entries.push({
      ledgerId: bankLedger._id,
      name: bankLedger.name,
      debit: 0,
      credit: totalPaise,
    });
  }

  return {
    companyId: company._id,
    voucherType,
    date,
    dueDate: null,
    status: "POSTED",
    paymentStatus: "PAID",
    narration: narration || null,

    // Point-in-time Party Snapshot
    party: {
      ledgerId: party._id,
      name: party.name,
      gstin: party.gstin || null,
      stateCode: party.state_code || "27",
      address: party.address || party.mailing_address || null,
      phone: party.phone || party.mobile || null,
    },

    // Payment block
    payment: {
      mode: mode.toUpperCase(),
      bankLedgerId: bankLedger._id,
      reference: reference ? reference.trim() : null,
    },

    // Bill allocations (if any bills are settled)
    allocations: processedAllocations.length > 0 ? processedAllocations : undefined,

    // Double-entry entries
    entries,

    // Summary
    summary: {
      subtotal: totalPaise,
      taxTotal: 0,
      roundOff: 0,
      grandTotal: totalPaise,
    },

    sync: {
      source: "APP_DIRECT",
    },
  };
}
