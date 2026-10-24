import mongoose from "mongoose";
import Company from "../../companies/company.schema.js";
import Ledger from "../../tally/ledger/ledger.schema.js";
import UnifiedVoucher from "../voucher/voucher.unified.schema.js";
import Sequence from "../sequence/sequence.schema.js";
import LedgerPosting from "../ledger/ledgerPosting.schema.js";
import AuditLog from "../audit/auditlog.schema.js";
import OutboundSyncQueue from "../sync/outboundSyncQueue.schema.js";
import { buildSalesVoucher } from "./salesVoucherBuilder.js";
import { buildReceiptOrPaymentVoucher } from "./receiptPaymentBuilder.js";

/**
 * Calculates Indian Financial Year string from YYYY-MM-DD
 * e.g. "2026-10-24" -> "2026-27"
 */
export function getFinancialYear(dateStr) {
  const [yearStr, monthStr] = dateStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  if (month >= 4) {
    const nextYearShort = String((year + 1) % 100).padStart(2, "0");
    return `${year}-${nextYearShort}`;
  } else {
    const curYearShort = String(year % 100).padStart(2, "0");
    return `${year - 1}-${curYearShort}`;
  }
}

/**
 * Resolves or creates standard accounting ledgers needed for Sales & GST posting.
 */
export async function resolveSystemLedgers(companyId, session) {
  const ledgers = await Ledger.find({
    company_id: companyId,
    is_deleted: { $ne: true },
  })
    .session(session)
    .lean();

  let salesLedger = ledgers.find(
    (l) =>
      (l.parent && l.parent.toLowerCase().includes("sales")) ||
      (l.name && l.name.toLowerCase().includes("sales account"))
  );

  let cgstLedger = ledgers.find(
    (l) => l.name && /\b(cgst|output\s*cgst)\b/i.test(l.name)
  );

  let sgstLedger = ledgers.find(
    (l) => l.name && /\b(sgst|output\s*sgst|utgst)\b/i.test(l.name)
  );

  let igstLedger = ledgers.find(
    (l) => l.name && /\b(igst|output\s*igst)\b/i.test(l.name)
  );

  let roundOffLedger = ledgers.find(
    (l) => l.name && /round\s*off/i.test(l.name)
  );

  // Auto-create missing ledgers within session if not present
  const toCreate = [];

  if (!salesLedger) {
    toCreate.push({
      company_id: companyId,
      name: "Sales Account",
      parent: "Sales Accounts",
      opening_balance: 0,
    });
  }
  if (!cgstLedger) {
    toCreate.push({
      company_id: companyId,
      name: "Output CGST",
      parent: "Duties & Taxes",
      gst_duty_head: "CGST",
      opening_balance: 0,
    });
  }
  if (!sgstLedger) {
    toCreate.push({
      company_id: companyId,
      name: "Output SGST",
      parent: "Duties & Taxes",
      gst_duty_head: "SGST",
      opening_balance: 0,
    });
  }
  if (!igstLedger) {
    toCreate.push({
      company_id: companyId,
      name: "Output IGST",
      parent: "Duties & Taxes",
      gst_duty_head: "IGST",
      opening_balance: 0,
    });
  }
  if (!roundOffLedger) {
    toCreate.push({
      company_id: companyId,
      name: "Round Off",
      parent: "Indirect Expenses",
      opening_balance: 0,
    });
  }

  if (toCreate.length > 0) {
    const created = await Ledger.create(toCreate, { session });
    for (const l of created) {
      if (l.name === "Sales Account") salesLedger = l;
      if (l.name === "Output CGST") cgstLedger = l;
      if (l.name === "Output SGST") sgstLedger = l;
      if (l.name === "Output IGST") igstLedger = l;
      if (l.name === "Round Off") roundOffLedger = l;
    }
  }

  return { salesLedger, cgstLedger, sgstLedger, igstLedger, roundOffLedger };
}

/**
 * Atomic Intent Posting Engine for Sales Invoices.
 * Runs in a strict MongoDB Transaction Session.
 */
export async function postSalesInvoiceService({
  companyId,
  clientIntent,
  userId = null,
}) {
  const targetCompanyId = new mongoose.Types.ObjectId(companyId);

  // 1. Idempotency Check (Fast-path read outside transaction)
  if (clientIntent.idempotencyKey) {
    const existing = await UnifiedVoucher.findOne({
      companyId: targetCompanyId,
      idempotencyKey: clientIntent.idempotencyKey.trim(),
    }).lean();

    if (existing) {
      return { voucher: existing, isDuplicate: true };
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 2. Fetch Company & Party
    const company = await Company.findById(targetCompanyId).session(session);
    if (!company) throw new Error("Company not found");

    const party = await Ledger.findOne({
      _id: clientIntent.partyId,
      company_id: targetCompanyId,
      is_deleted: { $ne: true },
    }).session(session);

    if (!party) throw new Error("Customer party ledger not found");

    // 3. Resolve System Ledgers
    const systemLedgers = await resolveSystemLedgers(targetCompanyId, session);

    // 4. Determine Financial Year & Voucher Number
    const dateStr = clientIntent.date || new Date().toISOString().slice(0, 10);
    const financialYear = getFinancialYear(dateStr);

    const { voucherNumber } = await Sequence.getNextNumber({
      companyId: targetCompanyId,
      financialYear,
      voucherType: "SALES",
      series: clientIntent.series || "MAIN",
      session,
    });

    // 5. Build Balanced Document Payload
    const voucherPayload = buildSalesVoucher({
      company,
      party,
      items: clientIntent.items,
      date: dateStr,
      dueDate: clientIntent.dueDate || null,
      placeOfSupply: clientIntent.placeOfSupply || null,
      supplyType: clientIntent.supplyType || null,
      narration: clientIntent.narration || null,
      systemLedgers,
    });

    voucherPayload.voucherNumber = voucherNumber;
    voucherPayload.financialYear = financialYear;
    voucherPayload.idempotencyKey = clientIntent.idempotencyKey
      ? clientIntent.idempotencyKey.trim()
      : null;

    if (userId) {
      voucherPayload.audit = {
        createdBy: userId,
        createdAt: new Date(),
        version: 1,
      };
    }

    // 6. Save Voucher (runs Type Matrix & Debit==Credit pre-save hooks)
    const [savedVoucher] = await UnifiedVoucher.create([voucherPayload], { session });

    // 7. Insert Derived Ledger Postings for Fast Reporting
    const postings = savedVoucher.entries.map((entry) => ({
      companyId: targetCompanyId,
      ledgerId: entry.ledgerId,
      date: savedVoucher.date,
      voucherId: savedVoucher._id,
      voucherType: savedVoucher.voucherType,
      voucherNumber: savedVoucher.voucherNumber,
      debit: entry.debit,
      credit: entry.credit,
      partyName: savedVoucher.party.name,
    }));

    await LedgerPosting.insertMany(postings, { session });

    // 8. Insert Audit Log (Immutable append-only)
    await AuditLog.create(
      [
        {
          companyId: targetCompanyId,
          voucherId: savedVoucher._id,
          action: "CREATE",
          userId: userId || null,
          before: null,
          after: savedVoucher.toObject(),
          at: new Date(),
        },
      ],
      { session }
    );

    // 9. Enqueue Outbound Sync for Tally Desktop Bridge
    await OutboundSyncQueue.create(
      [
        {
          companyId: targetCompanyId,
          voucherId: savedVoucher._id,
          operation: "CREATE",
          status: "PENDING",
        },
      ],
      { session }
    );

    // 10. Commit Atomic Transaction
    await session.commitTransaction();

    return { voucher: savedVoucher, isDuplicate: false };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

/**
 * Atomic Intent Posting Engine for Receipt and Payment Vouchers.
 * Settles invoices via allocations and transactionally derives paymentStatus.
 */
export async function postReceiptOrPaymentService({
  companyId,
  voucherType, // "RECEIPT" | "PAYMENT"
  clientIntent,
  userId = null,
}) {
  const targetCompanyId = new mongoose.Types.ObjectId(companyId);

  // 1. Idempotency Check
  if (clientIntent.idempotencyKey) {
    const existing = await UnifiedVoucher.findOne({
      companyId: targetCompanyId,
      idempotencyKey: clientIntent.idempotencyKey.trim(),
    }).lean();

    if (existing) {
      return { voucher: existing, isDuplicate: true };
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 2. Fetch Company, Party Ledger and Bank/Cash Ledger
    const company = await Company.findById(targetCompanyId).session(session);
    if (!company) throw new Error("Company not found");

    const party = await Ledger.findOne({
      _id: clientIntent.partyId,
      company_id: targetCompanyId,
      is_deleted: { $ne: true },
    }).session(session);
    if (!party) throw new Error("Party ledger not found");

    const bankLedger = await Ledger.findOne({
      _id: clientIntent.bankLedgerId,
      company_id: targetCompanyId,
      is_deleted: { $ne: true },
    }).session(session);
    if (!bankLedger) throw new Error("Bank or cash ledger not found");

    // 3. Determine Financial Year & Voucher Number
    const dateStr = clientIntent.date || new Date().toISOString().slice(0, 10);
    const financialYear = getFinancialYear(dateStr);

    const { voucherNumber } = await Sequence.getNextNumber({
      companyId: targetCompanyId,
      financialYear,
      voucherType,
      series: clientIntent.series || "MAIN",
      session,
    });

    // 4. Build Balanced Voucher Payload
    const voucherPayload = buildReceiptOrPaymentVoucher({
      voucherType,
      company,
      party,
      bankLedger,
      amount: clientIntent.amount, // in paise
      date: dateStr,
      mode: clientIntent.mode || "BANK",
      reference: clientIntent.reference || null,
      allocations: clientIntent.allocations || [],
      narration: clientIntent.narration || null,
    });

    voucherPayload.voucherNumber = voucherNumber;
    voucherPayload.financialYear = financialYear;
    voucherPayload.idempotencyKey = clientIntent.idempotencyKey
      ? clientIntent.idempotencyKey.trim()
      : null;

    if (userId) {
      voucherPayload.audit = {
        createdBy: userId,
        createdAt: new Date(),
        version: 1,
      };
    }

    // 5. Save Receipt/Payment Voucher
    const [savedVoucher] = await UnifiedVoucher.create([voucherPayload], { session });

    // 6. Insert Derived Ledger Postings
    const postings = savedVoucher.entries.map((entry) => ({
      companyId: targetCompanyId,
      ledgerId: entry.ledgerId,
      date: savedVoucher.date,
      voucherId: savedVoucher._id,
      voucherType: savedVoucher.voucherType,
      voucherNumber: savedVoucher.voucherNumber,
      debit: entry.debit,
      credit: entry.credit,
      partyName: savedVoucher.party.name,
    }));
    await LedgerPosting.insertMany(postings, { session });

    // 7. Transactionally update allocated invoices' paymentStatus
    if (clientIntent.allocations && clientIntent.allocations.length > 0) {
      for (const alloc of clientIntent.allocations) {
        if (!alloc.voucherId) continue;

        const targetInvoice = await UnifiedVoucher.findById(alloc.voucherId).session(session);
        if (!targetInvoice) continue;

        // Calculate total allocated to this invoice across all posted receipts/notes
        const allSettlements = await UnifiedVoucher.aggregate([
          {
            $match: {
              companyId: targetCompanyId,
              status: "POSTED",
              "allocations.voucherId": targetInvoice._id,
            },
          },
          { $unwind: "$allocations" },
          {
            $match: {
              "allocations.voucherId": targetInvoice._id,
            },
          },
          {
            $group: {
              _id: null,
              totalSettled: { $sum: "$allocations.amount" },
            },
          },
        ]).session(session);

        const currentSettled = allSettlements[0]?.totalSettled || 0;

        const grandTotal = targetInvoice.summary.grandTotal;

        let nextPaymentStatus = "UNPAID";
        if (currentSettled >= grandTotal) {
          nextPaymentStatus = "PAID";
        } else if (currentSettled > 0) {
          nextPaymentStatus = "PARTIAL";
        }

        targetInvoice.paymentStatus = nextPaymentStatus;
        await targetInvoice.save({ session });
      }
    }

    // 8. Insert Audit Log
    await AuditLog.create(
      [
        {
          companyId: targetCompanyId,
          voucherId: savedVoucher._id,
          action: "CREATE",
          userId: userId || null,
          before: null,
          after: savedVoucher.toObject(),
          at: new Date(),
        },
      ],
      { session }
    );

    // 9. Enqueue Outbound Sync for Tally Desktop Bridge
    await OutboundSyncQueue.create(
      [
        {
          companyId: targetCompanyId,
          voucherId: savedVoucher._id,
          operation: "CREATE",
          status: "PENDING",
        },
      ],
      { session }
    );

    // 10. Commit Atomic Transaction
    await session.commitTransaction();

    return { voucher: savedVoucher, isDuplicate: false };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

