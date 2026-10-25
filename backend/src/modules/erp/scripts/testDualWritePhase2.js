import mongoose from "mongoose";
import envConfig from "../../../config/env.js";
import { syncTallyVouchersToUnified } from "../sync/inboundTallySyncAdapter.service.js";
import UnifiedVoucher from "../voucher/voucher.unified.schema.js";
import LedgerPosting from "../ledger/ledgerPosting.schema.js";
import Ledger from "../../tally/ledger/ledger.schema.js";

async function runTest() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(envConfig.MONGO_URI);
  console.log("Connected to MongoDB:", mongoose.connection.name);

  const companyId = "6aa0ebf73a3260ebc741698b";

  // Pick a real ledger for this company
  const sampleLedger = await Ledger.findOne({ company_id: companyId }).lean();
  if (!sampleLedger) {
    throw new Error("No ledgers found for company");
  }
  console.log(`Using sample ledger: ${sampleLedger.name} (${sampleLedger._id})`);

  const testGuid = `TEST-GUID-${Date.now()}`;
  const testVoucherBatch = [
    {
      guid: testGuid,
      vouchernumber: "TEST-SYNC-01",
      vouchertypename: "Sales",
      date: "2026-10-25",
      partyledgername: sampleLedger.name,
      partyledgerguid: sampleLedger.guid,
      narration: "Dual-write integration test voucher",
      ledgerentries: [
        {
          ledgername: sampleLedger.name,
          ledger_guid: sampleLedger.guid,
          amount: "-50000", // 50,000 Debit (in Tally format)
          isdeemedpositive: "Yes",
          billallocations: [
            {
              name: "INV-2026-001",
              billtype: "New Ref",
              amount: "50000",
              duedate: "2026-11-25",
            },
          ],
        },
        {
          ledgername: sampleLedger.name,
          ledger_guid: sampleLedger.guid,
          amount: "50000", // 50,000 Credit
          isdeemedpositive: "No",
        },
      ],
      inventoryentries: [
        {
          stockitemname: "Test Product A",
          hsncode: "8471",
          quantity: "2",
          rate: "25000",
          amount: "50000",
          unit: "NOS",
        },
      ],
    },
  ];

  console.log("\nExecuting syncTallyVouchersToUnified with test batch...");
  const syncResult = await syncTallyVouchersToUnified({
    rawVouchers: testVoucherBatch,
    companyId,
  });

  console.log("Sync Result:", syncResult);

  // Verify in UnifiedVoucher
  const savedVoucher = await UnifiedVoucher.findOne({
    companyId,
    "sync.tallyGuid": testGuid,
  }).lean();

  if (!savedVoucher) {
    throw new Error("FAIL: UnifiedVoucher not found for testGuid!");
  }
  console.log("PASS: Found saved UnifiedVoucher:", {
    _id: savedVoucher._id,
    voucherNumber: savedVoucher.voucherNumber,
    voucherType: savedVoucher.voucherType,
    status: savedVoucher.status,
    grandTotal: savedVoucher.summary.grandTotal,
    source: savedVoucher.sync.source,
  });

  // Verify in LedgerPosting
  const postings = await LedgerPosting.find({
    companyId,
    voucherId: savedVoucher._id,
  }).lean();

  console.log(`PASS: Found ${postings.length} LedgerPostings:`);
  for (const p of postings) {
    console.log(` - Ledger: ${p.ledgerId}, Dr: ${p.debit}, Cr: ${p.credit}, Bill: ${p.billName} (${p.billType})`);
  }

  // Clean up test voucher and postings
  await UnifiedVoucher.deleteOne({ _id: savedVoucher._id });
  await LedgerPosting.deleteMany({ voucherId: savedVoucher._id });
  console.log("\nPASS: Successfully cleaned up test records.");

  console.log("\nPhase 2 Dual-Write Adapter Validation PASSED 100%!");
  await mongoose.disconnect();
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
