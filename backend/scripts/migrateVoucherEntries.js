import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
import mongoose from 'mongoose';
import LedgerEntry from '../src/modules/tally/voucher/ledgerentry.schema.js';
import InventoryEntry from '../src/modules/tally/voucher/inventoryentry.schema.js';

const BATCH_SIZE = 500;

/**
 * Loads all ledgers from DB and builds lookup maps by company + lowercase name
 */
async function loadLedgerLookup() {
  console.log('[Migration] Loading ledger lookup map...');
  const ledgers = await mongoose.connection.db.collection('ledgers').find(
    {},
    { projection: { _id: 1, name: 1, company_id: 1 } }
  ).toArray();

  const map = new Map();
  for (const l of ledgers) {
    if (!l.name) continue;
    const normName = l.name.trim().toLowerCase();
    if (l.company_id) {
      map.set(`${String(l.company_id)}:::${normName}`, l._id);
      map.set(`${String(l.company_id)}:::${l.name.trim()}`, l._id);
    }
    // Global fallback
    if (!map.has(`global:::${normName}`)) {
      map.set(`global:::${normName}`, l._id);
    }
  }
  console.log(`[Migration] Loaded ${ledgers.length} ledgers into memory.`);
  return map;
}

/**
 * Resolves ledger_id from ledger name and company_id
 */
function resolveLedgerId(ledgerMap, companyId, ledgerName) {
  if (!ledgerName) return null;
  const compKey = String(companyId);
  const cleanName = String(ledgerName).trim();
  const lowerName = cleanName.toLowerCase();

  return (
    ledgerMap.get(`${compKey}:::${lowerName}`) ||
    ledgerMap.get(`${compKey}:::${cleanName}`) ||
    ledgerMap.get(`global:::${lowerName}`) ||
    null
  );
}

/**
 * Transforms an embedded ledger entry into a LedgerEntry document
 */
function transformLedgerEntry(entry, voucher, ledgerMap) {
  const rawName = entry.ledger_name || entry.name || entry.ledgername || '';
  const ledgerId = resolveLedgerId(ledgerMap, voucher.company_id, rawName);
  const amount = entry.amount != null ? Number(entry.amount) : 0;
  const isDeemedPositive = Boolean(entry.is_deemed_positive || entry.isdeemedpositive);

  return {
    voucher_id: voucher._id,
    company_id: voucher.company_id,
    ledger_id: ledgerId,
    amount,
    is_deemed_positive: isDeemedPositive,
    entry_type: entry.entry_type || (isDeemedPositive ? 'DEBIT' : 'CREDIT'),
    is_party_ledger: Boolean(entry.is_party_ledger),
    bills_allocation: Array.isArray(entry.bills_allocation) ? entry.bills_allocation : [],
    is_active: true,
    is_deleted: Boolean(entry.is_deleted || voucher.is_deleted),
    created_at: entry.created_at ? new Date(entry.created_at) : (voucher.created_at || new Date()),
    updated_at: entry.updated_at ? new Date(entry.updated_at) : (voucher.updated_at || new Date()),
  };
}

/**
 * Transforms an embedded inventory entry into an InventoryEntry document
 */
function transformInventoryEntry(inv, voucher, ledgerMap) {
  const accLedgerName = inv.accounting_ledger_name || '';
  const accLedgerId = resolveLedgerId(ledgerMap, voucher.company_id, accLedgerName);

  return {
    voucher_id: voucher._id,
    company_id: voucher.company_id,
    stock_item_name: String(inv.stock_item_name || '').trim(),
    quantity: inv.quantity || null,
    rate: inv.rate || null,
    unit_name: inv.unit_name || null,
    amount: inv.amount != null ? Number(inv.amount) : null,
    discount_amount: inv.discount_amount != null ? Number(inv.discount_amount) : null,
    discount_percentage: inv.discount_percentage != null ? Number(inv.discount_percentage) : null,
    godown_name: inv.godown_name || null,
    batch_name: inv.batch_name || null,
    expiry_date: inv.expiry_date ? new Date(inv.expiry_date) : null,
    manufacturing_date: inv.manufacturing_date ? new Date(inv.manufacturing_date) : null,
    hsn_code: inv.hsn_code || null,
    gst_rate: inv.gst_rate != null ? Number(inv.gst_rate) : null,
    accounting_ledger_name: accLedgerName || null,
    accounting_ledger_id: accLedgerId,
    accounting_amount: inv.accounting_amount != null ? Number(inv.accounting_amount) : null,
    accounting_isdeemedpositive: Boolean(inv.accounting_isdeemedpositive),
    is_active: true,
    is_deleted: Boolean(inv.is_deleted || voucher.is_deleted),
    created_at: inv.created_at ? new Date(inv.created_at) : (voucher.created_at || new Date()),
    updated_at: inv.updated_at ? new Date(inv.updated_at) : (voucher.updated_at || new Date()),
  };
}

/**
 * Processes and persists a batch of ledger and inventory entries idempotently
 */
async function processBatch(voucherIds, ledgerEntries, inventoryEntries) {
  if (!voucherIds.length) return;

  // Ensure idempotency: delete pre-existing entries for this batch of vouchers
  await Promise.all([
    LedgerEntry.deleteMany({ voucher_id: { $in: voucherIds } }),
    InventoryEntry.deleteMany({ voucher_id: { $in: voucherIds } }),
  ]);

  const insertTasks = [];
  if (ledgerEntries.length > 0) {
    insertTasks.push(LedgerEntry.insertMany(ledgerEntries, { ordered: false }));
  }
  if (inventoryEntries.length > 0) {
    insertTasks.push(InventoryEntry.insertMany(inventoryEntries, { ordered: false }));
  }

  if (insertTasks.length > 0) {
    await Promise.all(insertTasks);
  }
}

/**
 * Main migration runner
 */
async function runMigration() {
  console.log('[Migration] Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('[Migration] Connected to MongoDB.');

  const ledgerMap = await loadLedgerLookup();

  // Find all vouchers that have embedded entries
  const query = {
    $or: [
      { 'ledgerentries.0': { $exists: true } },
      { 'inventoryentries.0': { $exists: true } }
    ]
  };

  const totalVouchers = await mongoose.connection.db.collection('vouchers').countDocuments(query);
  console.log(`[Migration] Found ${totalVouchers} vouchers with embedded entries to migrate.`);

  if (totalVouchers === 0) {
    console.log('[Migration] No vouchers need migration.');
    await mongoose.disconnect();
    return;
  }

  const cursor = mongoose.connection.db.collection('vouchers')
    .find(query, {
      projection: {
        _id: 1,
        company_id: 1,
        created_at: 1,
        updated_at: 1,
        is_deleted: 1,
        ledgerentries: 1,
        inventoryentries: 1
      }
    })
    .batchSize(BATCH_SIZE);

  let processedVouchers = 0;
  let totalLedgerInserted = 0;
  let totalInventoryInserted = 0;
  let totalUnresolvedLedgers = 0;

  let currentBatchVoucherIds = [];
  let currentBatchLedgerEntries = [];
  let currentBatchInventoryEntries = [];

  for await (const voucher of cursor) {
    currentBatchVoucherIds.push(voucher._id);

    if (Array.isArray(voucher.ledgerentries)) {
      for (const e of voucher.ledgerentries) {
        if (!e) continue;
        const entryDoc = transformLedgerEntry(e, voucher, ledgerMap);
        if (!entryDoc.ledger_id) {
          totalUnresolvedLedgers++;
        }
        currentBatchLedgerEntries.push(entryDoc);
      }
    }

    if (Array.isArray(voucher.inventoryentries)) {
      for (const inv of voucher.inventoryentries) {
        if (!inv) continue;
        const invDoc = transformInventoryEntry(inv, voucher, ledgerMap);
        currentBatchInventoryEntries.push(invDoc);
      }
    }

    processedVouchers++;

    if (currentBatchVoucherIds.length >= BATCH_SIZE) {
      await processBatch(
        currentBatchVoucherIds,
        currentBatchLedgerEntries,
        currentBatchInventoryEntries
      );

      totalLedgerInserted += currentBatchLedgerEntries.length;
      totalInventoryInserted += currentBatchInventoryEntries.length;

      console.log(
        `[Migration] Progress: ${processedVouchers} / ${totalVouchers} vouchers (` +
        `${totalLedgerInserted} ledger entries, ${totalInventoryInserted} inventory entries inserted)`
      );

      currentBatchVoucherIds = [];
      currentBatchLedgerEntries = [];
      currentBatchInventoryEntries = [];
    }
  }

  // Final flush of remaining batch
  if (currentBatchVoucherIds.length > 0) {
    await processBatch(
      currentBatchVoucherIds,
      currentBatchLedgerEntries,
      currentBatchInventoryEntries
    );
    totalLedgerInserted += currentBatchLedgerEntries.length;
    totalInventoryInserted += currentBatchInventoryEntries.length;
  }

  console.log('[Migration] Creating performance indexes on collections...');
  await Promise.all([
    LedgerEntry.collection.createIndex({ voucher_id: 1, company_id: 1 }),
    LedgerEntry.collection.createIndex({ company_id: 1, ledger_id: 1 }),
    InventoryEntry.collection.createIndex({ voucher_id: 1, company_id: 1 }),
    InventoryEntry.collection.createIndex({ company_id: 1, accounting_ledger_id: 1 }),
  ]);

  console.log('========================================');
  console.log('[Migration] Migration Completed Successfully!');
  console.log(`- Vouchers processed: ${processedVouchers}`);
  console.log(`- Ledger entries inserted: ${totalLedgerInserted}`);
  console.log(`- Inventory entries inserted: ${totalInventoryInserted}`);
  console.log(`- Unresolved ledger names: ${totalUnresolvedLedgers}`);
  console.log('========================================');

  await mongoose.disconnect();
}

runMigration().catch((err) => {
  console.error('[Migration ERROR]:', err);
  process.exit(1);
});
