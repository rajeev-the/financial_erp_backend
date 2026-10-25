import mongoose from "mongoose";
import envConfig from "../../../config/env.js";
import UnifiedVoucher from "../voucher/voucher.unified.schema.js";
import LedgerPosting from "../ledger/ledgerPosting.schema.js";

async function runIndexMigration() {
  const uri = envConfig.MONGO_URI;
  console.log(`Connecting to MongoDB...`);
  await mongoose.connect(uri);
  console.log(`Connected to database: ${mongoose.connection.name}`);

  const db = mongoose.connection.db;
  const voucherColl = db.collection("vouchers_unified");
  const postingColl = db.collection("ledger_postings");

  console.log("\n--- Current vouchers_unified indexes ---");
  const existingVoucherIndexes = await voucherColl.indexes();
  for (const idx of existingVoucherIndexes) {
    console.log(`- ${idx.name}: ${JSON.stringify(idx.key)} (unique: ${idx.unique || false}, partial: ${JSON.stringify(idx.partialFilterExpression || null)})`);
  }

  // Check if old non-partial index exists
  const oldVoucherUnique = existingVoucherIndexes.find(
    (idx) => idx.name === "companyId_1_voucherType_1_financialYear_1_voucherNumber_1" && !idx.partialFilterExpression
  );
  if (oldVoucherUnique) {
    console.log(`\nDropping old strict unique index: ${oldVoucherUnique.name}...`);
    await voucherColl.dropIndex(oldVoucherUnique.name);
    console.log(`Dropped successfully.`);
  }

  const oldTallyGuidIdx = existingVoucherIndexes.find(
    (idx) => idx.name === "companyId_1_sync.tallyGuid_1" && !idx.partialFilterExpression
  );
  if (oldTallyGuidIdx) {
    console.log(`Dropping old tallyGuid index: ${oldTallyGuidIdx.name}...`);
    await voucherColl.dropIndex(oldTallyGuidIdx.name);
    console.log(`Dropped successfully.`);
  }

  console.log("\nSyncing indexes for UnifiedVoucher...");
  await UnifiedVoucher.syncIndexes();

  console.log("Syncing indexes for LedgerPosting...");
  await LedgerPosting.syncIndexes();

  console.log("\n--- Updated vouchers_unified indexes ---");
  const updatedVoucherIndexes = await voucherColl.indexes();
  for (const idx of updatedVoucherIndexes) {
    console.log(`- ${idx.name}: ${JSON.stringify(idx.key)} (unique: ${idx.unique || false}, partial: ${JSON.stringify(idx.partialFilterExpression || null)})`);
  }

  console.log("\n--- Updated ledger_postings indexes ---");
  const updatedPostingIndexes = await postingColl.indexes();
  for (const idx of updatedPostingIndexes) {
    console.log(`- ${idx.name}: ${JSON.stringify(idx.key)} (unique: ${idx.unique || false}, partial: ${JSON.stringify(idx.partialFilterExpression || null)})`);
  }

  console.log("\nPhase 1 Schema & Index Migration Completed Successfully!");
  await mongoose.disconnect();
}

runIndexMigration().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
