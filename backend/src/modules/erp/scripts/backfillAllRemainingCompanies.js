import mongoose from "mongoose";
import envConfig from "../../../config/env.js";
import Company from "../../companies/company.schema.js";
import Ledger from "../../tally/ledger/ledger.schema.js";
import OldVoucher from "../../tally/voucher/voucher.schema.js";
import OldLedgerEntry from "../../tally/voucher/ledgerentry.schema.js";
import OldInventoryEntry from "../../tally/voucher/inventoryentry.schema.js";
import UnifiedVoucher from "../voucher/voucher.unified.schema.js";
import LedgerPosting from "../ledger/ledgerPosting.schema.js";
import { getFinancialYear } from "../posting/postingEngine.service.js";

function normalizeVoucherType(rawType) {
  if (!rawType) return "JOURNAL";
  const t = rawType.trim().toLowerCase();
  if (t.includes("sales order")) return "SALES_ORDER";
  if (t.includes("purchase order")) return "PURCHASE_ORDER";
  if (t.includes("delivery note")) return "DELIVERY_NOTE";
  if (t.includes("receipt note")) return "RECEIPT_NOTE";
  if (t.includes("stock journal")) return "STOCK_JOURNAL";
  if (t.includes("physical stock")) return "PHYSICAL_STOCK";
  if (t.includes("sales")) return "SALES";
  if (t.includes("purchase")) return "PURCHASE";
  if (t.includes("receipt")) return "RECEIPT";
  if (t.includes("payment")) return "PAYMENT";
  if (t.includes("contra")) return "CONTRA";
  if (t.includes("credit note")) return "CREDIT_NOTE";
  if (t.includes("debit note")) return "DEBIT_NOTE";
  if (t.includes("reversing journal")) return "REVERSING_JOURNAL";
  if (t.includes("memorandum")) return "MEMORANDUM";
  return "JOURNAL";
}

function toDateStr(d) {
  if (!d) return new Date().toISOString().slice(0, 10);
  const dateObj = d instanceof Date ? d : new Date(d);
  if (isNaN(dateObj.getTime())) return new Date().toISOString().slice(0, 10);
  return dateObj.toISOString().slice(0, 10);
}

async function backfillSingleCompany(company) {
  const compId = company._id;
  console.log(`\n========================================================================`);
  console.log(`Migrating: ${company.name || company.tally_company_name} (${compId})`);
  console.log(`========================================================================`);

  // Pre-cache all Ledgers for this company
  const allLedgers = await Ledger.find({ company_id: compId }).lean();
  const ledgerMap = new Map();
  for (const l of allLedgers) {
    ledgerMap.set(String(l._id), l);
  }
  console.log(`[INFO] Cached ${allLedgers.length} ledgers in memory.`);

  const defaultSalesLedger = allLedgers.find(
    (l) => (l.parent && l.parent.toLowerCase().includes("sales")) ||
           (l.name && l.name.toLowerCase() === "sales") ||
           (l.classification && l.classification.toLowerCase().includes("direct income"))
  );
  const defaultPurchaseLedger = allLedgers.find(
    (l) => (l.parent && l.parent.toLowerCase().includes("purchase")) ||
           (l.name && l.name.toLowerCase() === "purchase") ||
           (l.classification && l.classification.toLowerCase().includes("direct expense"))
  );

  // Fetch all old vouchers
  const oldVouchers = await OldVoucher.find({
    company_id: compId,
    is_deleted: { $ne: true },
  })
    .sort({ date: 1 })
    .lean();

  const totalVouchers = oldVouchers.length;
  console.log(`[INFO] Found ${totalVouchers} historical vouchers to migrate.`);
  if (totalVouchers === 0) return;

  // Clear existing records to ensure idempotent clean run
  await UnifiedVoucher.deleteMany({ companyId: compId, "sync.source": "TALLY_SYNC" });
  await LedgerPosting.deleteMany({ companyId: compId });

  const BATCH_SIZE = 500;
  let totalMigrated = 0;
  const startTime = Date.now();

  for (let i = 0; i < totalVouchers; i += BATCH_SIZE) {
    const batchVouchers = oldVouchers.slice(i, i + BATCH_SIZE);
    const batchIds = batchVouchers.map((v) => v._id);

    // Batch load entries and inventory
    const [batchEntries, batchInventory] = await Promise.all([
      OldLedgerEntry.find({
        voucher_id: { $in: batchIds },
        is_deleted: { $ne: true },
      }).lean(),
      OldInventoryEntry.find({
        voucher_id: { $in: batchIds },
        is_deleted: { $ne: true },
      }).lean(),
    ]);

    // Group by voucher_id
    const entriesByVoucher = new Map();
    for (const e of batchEntries) {
      const vId = String(e.voucher_id);
      if (!entriesByVoucher.has(vId)) entriesByVoucher.set(vId, []);
      entriesByVoucher.get(vId).push(e);
    }

    const itemsByVoucher = new Map();
    for (const inv of batchInventory) {
      const vId = String(inv.voucher_id);
      if (!itemsByVoucher.has(vId)) itemsByVoucher.set(vId, []);
      itemsByVoucher.get(vId).push(inv);
    }

    const vouchersToInsert = [];
    const postingsToInsert = [];

    for (const ov of batchVouchers) {
      const vId = String(ov._id);
      const entries = entriesByVoucher.get(vId) || [];
      if (entries.length < 1) continue;

      const dateStr = toDateStr(ov.date);
      const fy = getFinancialYear(dateStr);
      const vType = normalizeVoucherType(ov.vchtype || ov.category);

      let totalDebit = 0;
      let totalCredit = 0;
      const mappedEntries = [];

      for (const oe of entries) {
        const rawAmt = Math.abs(Number(oe.amount) || 0);
        const paiseAmt = Math.round(rawAmt * 100);

        let isDebit = false;
        if (oe.entry_type === "DEBIT") isDebit = true;
        else if (oe.entry_type === "CREDIT") isDebit = false;
        else if (oe.amount < 0 || oe.is_deemed_positive === true) isDebit = true;

        const dr = isDebit ? paiseAmt : 0;
        const cr = !isDebit ? paiseAmt : 0;
        totalDebit += dr;
        totalCredit += cr;

        const lDoc = oe.ledger_id ? ledgerMap.get(String(oe.ledger_id)) : null;

        mappedEntries.push({
          ledgerId: oe.ledger_id || compId,
          name: lDoc ? lDoc.name : oe.ledger_guid || "General Ledger",
          debit: dr,
          credit: cr,
        });
      }

      if (totalDebit !== totalCredit) {
        const diff = totalDebit - totalCredit;
        if (diff > 0) {
          if (vType === "SALES" && defaultSalesLedger) {
            mappedEntries.push({
              ledgerId: defaultSalesLedger._id,
              name: defaultSalesLedger.name,
              debit: 0,
              credit: diff,
            });
            totalCredit += diff;
          } else if (mappedEntries.length >= 2) {
            mappedEntries[1].credit += diff;
            totalCredit += diff;
          }
        } else {
          const absDiff = Math.abs(diff);
          if (vType === "PURCHASE" && defaultPurchaseLedger) {
            mappedEntries.push({
              ledgerId: defaultPurchaseLedger._id,
              name: defaultPurchaseLedger.name,
              debit: absDiff,
              credit: 0,
            });
            totalDebit += absDiff;
          } else if (mappedEntries.length >= 1) {
            mappedEntries[0].debit += absDiff;
            totalDebit += absDiff;
          }
        }
      }

      const partyLedger = ov.party_ledger_id
        ? ledgerMap.get(String(ov.party_ledger_id))
        : null;

      const partySnapshot = {
        ledgerId: partyLedger ? partyLedger._id : compId,
        name: partyLedger ? partyLedger.name : "Cash / General Party",
        gstin: ov.party_gstin || (partyLedger ? partyLedger.gstin : null),
        stateCode: "27",
      };

      const oldItems = itemsByVoucher.get(vId) || [];
      const mappedItems = oldItems.map((oi) => {
        const qty = parseFloat(oi.quantity) || 1;
        const rawRate = Math.abs(Number(oi.rate) || Number(oi.amount) || 0);
        const amtPaise = Math.round(Math.abs(Number(oi.amount) || 0) * 100);
        return {
          name: oi.stock_item_name || "Stock Item",
          hsn: oi.hsn_code || "9999",
          qty: Math.max(0.001, qty),
          unit: oi.unit_name || "PCS",
          rate: Math.round(rawRate * 100),
          discountPct: 0,
          discount: 0,
          taxableValue: amtPaise,
          taxRate: 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
          cess: 0,
          total: amtPaise,
        };
      });

      const vNum = (ov.voucher_number || `H-${vId.slice(-6)}`).slice(0, 32);
      const newVoucherId = new mongoose.Types.ObjectId();

      const vDoc = {
        _id: newVoucherId,
        companyId: compId,
        voucherType: vType,
        voucherNumber: vNum,
        financialYear: fy,
        date: dateStr,
        status: ov.is_cancelled ? "CANCELLED" : "POSTED",
        paymentStatus: "UNPAID",
        narration: ov.narration || null,
        tallyVoucherType: ov.vchtype || null,
        party: vType !== "CONTRA" ? partySnapshot : undefined,
        items: mappedItems.length > 0 ? mappedItems : undefined,
        entries: mappedEntries.length >= 2 ? mappedEntries : [
          { ledgerId: compId, name: "General Ledger", debit: totalDebit, credit: 0 },
          { ledgerId: compId, name: "General Ledger", debit: 0, credit: totalDebit },
        ],
        summary: {
          subtotal: totalDebit,
          taxTotal: 0,
          roundOff: 0,
          grandTotal: totalDebit,
        },
        sync: {
          source: "TALLY_SYNC",
          tallyGuid: ov.guid || null,
          tallyMasterId: ov.master_id || null,
          tallyAlterId: ov.alter_id || null,
          tallyVoucherType: ov.vchtype || null,
          isDeletedInTally: false,
          balanceMismatch: totalDebit !== totalCredit,
          tallyExtras: {
            raw_vchtype: ov.vchtype,
            reference_number: ov.reference_number,
            reference_date: ov.reference_date,
          },
        },
      };

      vouchersToInsert.push(vDoc);

      for (const e of mappedEntries) {
        postingsToInsert.push({
          companyId: compId,
          ledgerId: e.ledgerId,
          date: dateStr,
          voucherId: newVoucherId,
          voucherType: vType,
          voucherNumber: vNum,
          debit: e.debit,
          credit: e.credit,
          partyName: partySnapshot.name,
          isCancelled: ov.is_cancelled || false,
        });
      }
    }

    if (vouchersToInsert.length > 0) {
      await UnifiedVoucher.insertMany(vouchersToInsert, { ordered: false });
      await LedgerPosting.insertMany(postingsToInsert, { ordered: false });
      totalMigrated += vouchersToInsert.length;
    }

    console.log(`   Migrated ${Math.min(i + BATCH_SIZE, totalVouchers)} / ${totalVouchers} vouchers...`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[SUCCESS] Migrated ${totalMigrated} vouchers for ${company.name} in ${elapsed}s!`);
}

async function runAll() {
  await mongoose.connect(envConfig.MONGO_URI);
  console.log("Connected to MongoDB:", mongoose.connection.name);

  const companies = await Company.find({}, { _id: 1, name: 1, tally_company_name: 1 }).lean();

  for (const c of companies) {
    const compId = c._id;
    const oldVoucherCount = await OldVoucher.countDocuments({ company_id: compId, is_deleted: { $ne: true } });
    const unifiedCount = await UnifiedVoucher.countDocuments({ companyId: compId });

    // Migrate if company has old vouchers and unified vouchers are missing
    if (oldVoucherCount > 0 && unifiedCount === 0) {
      await backfillSingleCompany(c);
    }
  }

  console.log("\n========================================================================");
  console.log("         ALL REMAINING COMPANIES BACKFILL COMPLETED SUCCESSFULLY        ");
  console.log("========================================================================");
  await mongoose.disconnect();
}

runAll().catch(console.error);
