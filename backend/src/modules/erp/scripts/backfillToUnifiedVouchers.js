import mongoose from "mongoose";
import connectDB from "../../../config/db.js";
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
  if (t.includes("sales")) return "SALES";
  if (t.includes("purchase")) return "PURCHASE";
  if (t.includes("receipt")) return "RECEIPT";
  if (t.includes("payment")) return "PAYMENT";
  if (t.includes("contra")) return "CONTRA";
  if (t.includes("credit note")) return "CREDIT_NOTE";
  if (t.includes("debit note")) return "DEBIT_NOTE";
  return "JOURNAL";
}

function toDateStr(d) {
  if (!d) return new Date().toISOString().slice(0, 10);
  const dateObj = d instanceof Date ? d : new Date(d);
  if (isNaN(dateObj.getTime())) return new Date().toISOString().slice(0, 10);
  return dateObj.toISOString().slice(0, 10);
}

export async function runBackfill(targetCompanyId) {
  console.log(`\n--- Starting High-Speed Batch Backfill ---`);
  await connectDB();

  try {
    const compId = new mongoose.Types.ObjectId(targetCompanyId);
    const company = await Company.findById(compId).lean();
    if (!company) throw new Error("Company not found");

    console.log(`Processing Company: ${company.name} (${compId})`);

    // 1. Clear existing backfilled records to avoid partial duplication
    await UnifiedVoucher.deleteMany({ companyId: compId, "sync.source": "TALLY_SYNC" });
    await LedgerPosting.deleteMany({ companyId: compId });
    console.log(`[INFO] Cleaned existing TALLY_SYNC unified vouchers & ledger postings for fresh high-speed run.`);

    // 2. Pre-cache all Ledgers for this company in memory
    const allLedgers = await Ledger.find({ company_id: compId }).lean();
    const ledgerMap = new Map();
    for (const l of allLedgers) {
      ledgerMap.set(String(l._id), l);
    }
    console.log(`[INFO] Cached ${allLedgers.length} ledgers in memory.`);

    // 3. Fetch all old vouchers
    const oldVouchers = await OldVoucher.find({
      company_id: compId,
      is_deleted: { $ne: true },
    })
      .sort({ date: 1 })
      .lean();

    const totalVouchers = oldVouchers.length;
    console.log(`[INFO] Total historical vouchers to migrate: ${totalVouchers}`);

    const BATCH_SIZE = 500;
    let totalMigrated = 0;
    const startTime = Date.now();

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
            // Need more Credit
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
            // Need more Debit
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
            taxRate: 18,
            cgst: 0,
            sgst: 0,
            igst: 0,
            cess: 0,
            total: amtPaise,
          };
        });

        if (["SALES", "PURCHASE", "CREDIT_NOTE", "DEBIT_NOTE"].includes(vType) && mappedItems.length === 0) {
          mappedItems.push({
            name: "General Goods & Services",
            hsn: "9999",
            qty: 1,
            unit: "PCS",
            rate: totalDebit,
            discountPct: 0,
            discount: 0,
            taxableValue: totalDebit,
            taxRate: 18,
            cgst: 0,
            sgst: 0,
            igst: 0,
            cess: 0,
            total: totalDebit,
          });
        }

        const vNum = (ov.voucher_number || `H-${vId.slice(-6)}`).slice(0, 16);
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
          party: vType !== "CONTRA" ? partySnapshot : undefined,
          gst: ["SALES", "PURCHASE", "CREDIT_NOTE", "DEBIT_NOTE"].includes(vType)
            ? {
                placeOfSupply: ov.place_of_supply || "27",
                supplyType: "B2B",
                taxMode: "INTRA",
                reverseCharge: false,
              }
            : undefined,
          items: mappedItems.length > 0 ? mappedItems : undefined,
          entries: mappedEntries,
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
            tallyExtras: {
              raw_vchtype: ov.vchtype,
              reference_number: ov.reference_number,
              reference_date: ov.reference_date,
            },
          },
        };

        if (vType === "PURCHASE") {
          vDoc.supplierInvoice = {
            number: (ov.reference_number || "SUPP-01").slice(0, 16),
            date: dateStr,
          };
        }
        if (["PAYMENT", "RECEIPT"].includes(vType)) {
          vDoc.payment = {
            mode: "BANK",
            bankLedgerId: mappedEntries[0]?.ledgerId || compId,
            reference: ov.reference_number || null,
          };
        }
        if (vType === "CONTRA") {
          vDoc.transfer = {
            fromLedgerId: mappedEntries[0]?.ledgerId || compId,
            toLedgerId: mappedEntries[1]?.ledgerId || compId,
          };
        }

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
          });
        }
      }

      if (vouchersToInsert.length > 0) {
        await UnifiedVoucher.insertMany(vouchersToInsert, { ordered: false });
        await LedgerPosting.insertMany(postingsToInsert, { ordered: false });
        totalMigrated += vouchersToInsert.length;
      }

      console.log(`   Processed ${Math.min(i + BATCH_SIZE, totalVouchers)} / ${totalVouchers} vouchers...`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n[SUCCESS] Migrated ${totalMigrated} vouchers & generated postings in ${elapsed}s!`);
  } catch (err) {
    console.error("Backfill Failed:", err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

const targetId = process.argv[2] || "6aa0ebf73a3260ebc741698b";
runBackfill(targetId);
