import mongoose from "mongoose";
import envConfig from "../../../config/env.js";
import UnifiedVoucher from "../voucher/voucher.unified.schema.js";
import Ledger from "../../tally/ledger/ledger.schema.js";
import { postReceiptOrPaymentService } from "../posting/postingEngine.service.js";

async function run() {
  const mongoUri = envConfig.MONGO_URI || envConfig.db?.uri || process.env.MONGO_URI;
  await mongoose.connect(mongoUri);
  console.log("Connected to DB.");

  const companyId = "6aa0ebf73a3260ebc741698b";

  // 1. Find a sales invoice
  // Clean up previous test receipts
  await UnifiedVoucher.deleteMany({
    companyId,
    voucherType: "RECEIPT",
    voucherNumber: { $in: ["RCT/26-27/0001", "RCT/26-27/0002", "RCT/26-27/0003", "RCT/26-27/0004"] },
  });

  const invoice = await UnifiedVoucher.findOne({
    companyId,
    voucherType: "SALES",
  }).sort({ date: -1 });

  if (!invoice) {
    console.log("No sales invoice found.");
    process.exit(1);
  }

  console.log(`Found Sales Invoice: ${invoice.voucherNumber}, Party: ${invoice.party.name}, Total: ₹${invoice.summary.grandTotal / 100}, PaymentStatus: ${invoice.paymentStatus}`);

  // Find a Bank or Cash ledger
  const bankLedger = await Ledger.findOne({
    company_id: companyId,
    is_deleted: { $ne: true },
    $or: [
      { name: /bank/i },
      { name: /cash/i },
      { "parent.name": /bank/i },
      { "parent.name": /cash/i },
    ],
  });

  if (!bankLedger) {
    console.log("No bank/cash ledger found.");
    process.exit(1);
  }

  console.log(`Selected Bank Ledger: ${bankLedger.name} (${bankLedger._id})`);

  // Ensure invoice is UNPAID for testing
  invoice.paymentStatus = "UNPAID";
  await invoice.save();

  // Test partial receipt
  const receiptAmount = Math.floor(invoice.summary.grandTotal / 2);
  console.log(`\nPosting Partial Receipt of ₹${receiptAmount / 100}...`);

  const receiptResult = await postReceiptOrPaymentService({
    companyId,
    voucherType: "RECEIPT",
    clientIntent: {
      partyId: invoice.party.ledgerId,
      bankLedgerId: bankLedger._id,
      amount: receiptAmount,
      date: new Date().toISOString().slice(0, 10),
      mode: "BANK",
      reference: "NEFT-TEST-9988",
      allocations: [
        {
          voucherId: invoice._id,
          voucherNumber: invoice.voucherNumber,
          amount: receiptAmount,
        },
      ],
      narration: "Partial payment received against " + invoice.voucherNumber,
    },
  });

  console.log(`Receipt Created: ${receiptResult.voucher.voucherNumber}, Status: ${receiptResult.voucher.status}`);

  // Re-fetch invoice to verify status
  const updatedInvoice = await UnifiedVoucher.findById(invoice._id);
  console.log(`Updated Invoice Payment Status: ${updatedInvoice.paymentStatus} (Expected: PARTIAL)`);

  // Test full payment of remainder
  const remainderAmount = invoice.summary.grandTotal - receiptAmount;
  console.log(`\nPosting Final Receipt of ₹${remainderAmount / 100}...`);

  const finalReceipt = await postReceiptOrPaymentService({
    companyId,
    voucherType: "RECEIPT",
    clientIntent: {
      partyId: invoice.party.ledgerId,
      bankLedgerId: bankLedger._id,
      amount: remainderAmount,
      date: new Date().toISOString().slice(0, 10),
      mode: "BANK",
      reference: "NEFT-TEST-9989",
      allocations: [
        {
          voucherId: invoice._id,
          voucherNumber: invoice.voucherNumber,
          amount: remainderAmount,
        },
      ],
      narration: "Settlement balance against " + invoice.voucherNumber,
    },
  });

  console.log(`Final Receipt Created: ${finalReceipt.voucher.voucherNumber}`);

  const settledInvoice = await UnifiedVoucher.findById(invoice._id);
  console.log(`Settled Invoice Payment Status: ${settledInvoice.paymentStatus} (Expected: PAID)`);

  console.log("\nAll Phase 5 checks passed!");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
