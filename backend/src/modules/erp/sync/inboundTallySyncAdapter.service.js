import mongoose from "mongoose";
import UnifiedVoucher from "../voucher/voucher.unified.schema.js";
import LedgerPosting from "../ledger/ledgerPosting.schema.js";
import Ledger from "../../tally/ledger/ledger.schema.js";
import { getFinancialYear } from "../posting/postingEngine.service.js";

/**
 * Normalizes raw Tally voucher types to Unified ERP Voucher Types
 */
export function normalizeTallyVoucherType(rawType) {
  if (!rawType) return "JOURNAL";
  const t = String(rawType).trim().toUpperCase();

  if (t.includes("SALES ORDER")) return "SALES_ORDER";
  if (t.includes("PURCHASE ORDER")) return "PURCHASE_ORDER";
  if (t.includes("DELIVERY NOTE")) return "DELIVERY_NOTE";
  if (t.includes("RECEIPT NOTE")) return "RECEIPT_NOTE";
  if (t.includes("PHYSICAL STOCK")) return "PHYSICAL_STOCK";
  if (t.includes("STOCK JOURNAL")) return "STOCK_JOURNAL";
  if (t.includes("CREDIT NOTE")) return "CREDIT_NOTE";
  if (t.includes("DEBIT NOTE")) return "DEBIT_NOTE";
  if (t.includes("SALES")) return "SALES";
  if (t.includes("PURCHASE")) return "PURCHASE";
  if (t.includes("RECEIPT")) return "RECEIPT";
  if (t.includes("PAYMENT")) return "PAYMENT";
  if (t.includes("CONTRA")) return "CONTRA";
  if (t.includes("MEMORANDUM")) return "MEMORANDUM";
  if (t.includes("REVERSING JOURNAL")) return "REVERSING_JOURNAL";
  if (t.includes("JOURNAL")) return "JOURNAL";
  return "OTHER";
}

/**
 * Converts various date formats (e.g. "20240815", Date object, or ISO string) to "YYYY-MM-DD"
 */
export function parseDateToIso(val) {
  if (!val) return new Date().toISOString().slice(0, 10);
  if (typeof val === "string") {
    const s = val.trim();
    if (/^\d{8}$/.test(s)) {
      return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      return s.slice(0, 10);
    }
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

/**
 * Normalizes helper to ensure array
 */
function toArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

/**
 * Maps raw Tally bill allocations into unified schema format
 */
function parseBillAllocations(rawAllocations) {
  const list = toArray(rawAllocations);
  if (!list.length) return undefined;

  const result = [];
  for (const b of list) {
    if (!b) continue;
    const billName = String(b.name || b.billname || b.bill_name || "").trim();
    if (!billName) continue;

    let billType = "New Ref";
    const rawType = String(b.billtype || b.bill_type || "").trim();
    if (/agst/i.test(rawType)) billType = "Agst Ref";
    else if (/adv/i.test(rawType)) billType = "Advance";
    else if (/on\s*acc/i.test(rawType)) billType = "On Account";

    const amt = Math.round(Math.abs(Number(b.amount) || 0) * 100);
    const dueDate = b.duedate || b.due_date ? parseDateToIso(b.duedate || b.due_date) : null;

    result.push({
      billType,
      billName,
      amount: amt,
      dueDate,
    });
  }
  return result.length > 0 ? result : undefined;
}

/**
 * Maps raw Tally cost center allocations into unified schema format
 */
function parseCostCentres(rawCostCentres) {
  const list = toArray(rawCostCentres);
  if (!list.length) return undefined;

  const result = [];
  for (const c of list) {
    if (!c) continue;
    const name = String(c.name || c.cost_centre_name || "").trim();
    if (!name) continue;
    const amt = Math.round(Math.abs(Number(c.amount) || 0) * 100);
    result.push({
      costCentreId: null,
      name,
      amount: amt,
    });
  }
  return result.length > 0 ? result : undefined;
}

/**
 * Ingests a batch of raw vouchers synced from Tally directly into Unified ERP models:
 * UnifiedVoucher & LedgerPosting.
 */
export async function syncTallyVouchersToUnified({ rawVouchers, companyId }) {
  if (!rawVouchers || !Array.isArray(rawVouchers) || rawVouchers.length === 0) {
    return { success: true, count: 0 };
  }

  const compId = new mongoose.Types.ObjectId(companyId);

  // 1. Gather all ledger GUIDs and Names in this batch for efficient resolution
  const ledgerGuids = new Set();
  const ledgerNames = new Set();

  for (const v of rawVouchers) {
    if (!v) continue;
    if (v.partyledgerguid) ledgerGuids.add(String(v.partyledgerguid).trim());
    if (v.partyledgername) ledgerNames.add(String(v.partyledgername).trim());

    const entries = toArray(
      v.ledgerentries ||
      v.allledgerentries ||
      v["allledgerentries.list"] ||
      v["ledgerentries.list"]
    );
    for (const e of entries) {
      if (!e) continue;
      const g = e.ledger_guid || e.ledgerguid || e.ledgerGuid || e.LEDGER_GUID;
      if (g) ledgerGuids.add(String(g).trim());
      const n = e.ledgername || e.name || e.ledger_name;
      if (n) ledgerNames.add(String(n).trim());
    }
  }

  // 2. Resolve ledgers from DB
  const query = { company_id: compId, is_deleted: { $ne: true } };
  const orClauses = [];
  if (ledgerGuids.size > 0) orClauses.push({ guid: { $in: [...ledgerGuids] } });
  if (ledgerNames.size > 0) orClauses.push({ name: { $in: [...ledgerNames] } });

  let matchedLedgers = [];
  if (orClauses.length > 0) {
    matchedLedgers = await Ledger.find({ ...query, $or: orClauses }).lean();
  }

  const ledgerByGuid = new Map();
  const ledgerByName = new Map();
  for (const l of matchedLedgers) {
    if (l.guid) {
      ledgerByGuid.set(l.guid.trim(), l);
      ledgerByGuid.set(l.guid.trim().toLowerCase(), l);
    }
    if (l.name) {
      ledgerByName.set(l.name.trim().toLowerCase(), l);
    }
  }

  function resolveLedger(guid, name) {
    if (guid) {
      const g = String(guid).trim();
      const byG = ledgerByGuid.get(g) || ledgerByGuid.get(g.toLowerCase());
      if (byG) return byG;
    }
    if (name) {
      const n = String(name).trim().toLowerCase();
      const byN = ledgerByName.get(n);
      if (byN) return byN;
    }
    return null;
  }

  // 3. Find existing UnifiedVouchers by Tally GUID to preserve MongoDB _ids
  const tallyGuids = rawVouchers
    .filter((v) => v && v.guid)
    .map((v) => String(v.guid).trim());

  const existingUnified = await UnifiedVoucher.find(
    { companyId: compId, "sync.tallyGuid": { $in: tallyGuids } },
    { _id: 1, "sync.tallyGuid": 1 }
  ).lean();

  const existingIdByGuid = new Map();
  for (const doc of existingUnified) {
    if (doc.sync?.tallyGuid) {
      existingIdByGuid.set(doc.sync.tallyGuid, doc._id);
    }
  }

  const voucherBulkOps = [];
  const postingsToInsert = [];
  const voucherIdsToClearPostings = [];

  for (const v of rawVouchers) {
    if (!v || !v.guid) continue;
    const tallyGuid = String(v.guid).trim();

    // Generate or reuse _id
    const voucherId = existingIdByGuid.get(tallyGuid) || new mongoose.Types.ObjectId();
    voucherIdsToClearPostings.push(voucherId);

    const isCancelled = v.iscancelled === "Yes" || v.iscancelled === true || v.is_cancelled === true;
    const isDeleted = v.isdeleted === "Yes" || v.isdeleted === true || v.is_deleted === true;

    if (isDeleted) {
      voucherBulkOps.push({
        updateOne: {
          filter: { companyId: compId, "sync.tallyGuid": tallyGuid },
          update: {
            $set: {
              status: "CANCELLED",
              "sync.isDeletedInTally": true,
            },
          },
        },
      });
      continue;
    }

    const dateStr = parseDateToIso(v.date);
    const fy = getFinancialYear(dateStr);
    const rawType = v.vouchertypename || v.vchtype || v.category || "JOURNAL";
    const vType = normalizeTallyVoucherType(rawType);
    const vNum = String(v.vouchernumber || v.voucher_number || "").trim().slice(0, 32);

    // Parse Entries
    const rawEntries = toArray(
      v.ledgerentries ||
      v.allledgerentries ||
      v["allledgerentries.list"] ||
      v["ledgerentries.list"]
    );

    let totalDebit = 0;
    let totalCredit = 0;
    const mappedEntries = [];
    const partyLedgerDoc = resolveLedger(v.partyledgerguid, v.partyledgername);

    for (const re of rawEntries) {
      if (!re) continue;
      const rName = re.ledgername || re.name || re.ledger_name;
      const rGuid = re.ledger_guid || re.ledgerguid || re.ledgerGuid || re.LEDGER_GUID;
      const lDoc = resolveLedger(rGuid, rName);

      const rawAmt = Number(re.amount) || 0;
      const paiseAmt = Math.round(Math.abs(rawAmt) * 100);

      let isDebit = false;
      if (re.entry_type === "DEBIT") isDebit = true;
      else if (re.entry_type === "CREDIT") isDebit = false;
      else if (rawAmt < 0 || re.isdeemedpositive === "Yes" || re.is_deemed_positive === true) isDebit = true;

      const dr = isDebit ? paiseAmt : 0;
      const cr = !isDebit ? paiseAmt : 0;
      totalDebit += dr;
      totalCredit += cr;

      const billAllocations = parseBillAllocations(re.billallocations || re["billallocations.list"]);
      const costCentres = parseCostCentres(re.costcentreallocations || re["costcentreallocations.list"]);

      const isParty = partyLedgerDoc && lDoc && String(lDoc._id) === String(partyLedgerDoc._id);

      mappedEntries.push({
        ledgerId: lDoc ? lDoc._id : compId,
        name: lDoc ? lDoc.name : rName || "General Ledger",
        debit: dr,
        credit: cr,
        isPartyLedger: !!isParty,
        billAllocations,
        costCentres,
      });

      // Prepare LedgerPosting row
      postingsToInsert.push({
        companyId: compId,
        ledgerId: lDoc ? lDoc._id : compId,
        date: dateStr,
        voucherId,
        voucherType: vType,
        voucherNumber: vNum,
        debit: dr,
        credit: cr,
        partyName: partyLedgerDoc ? partyLedgerDoc.name : (v.partyledgername || null),
        billName: billAllocations && billAllocations.length > 0 ? billAllocations[0].billName : null,
        billType: billAllocations && billAllocations.length > 0 ? billAllocations[0].billType : null,
        isCancelled,
      });
    }

    // Party Snapshot
    const partySnapshot = {
      ledgerId: partyLedgerDoc ? partyLedgerDoc._id : compId,
      name: partyLedgerDoc ? partyLedgerDoc.name : (v.partyledgername || "General Party"),
      gstin: v.partygstin || (partyLedgerDoc ? partyLedgerDoc.gstin : null),
      stateCode: "27",
    };

    // Parse Inventory Items
    const rawItems = toArray(
      v.inventoryentries ||
      v.allinventoryentries ||
      v["allinventoryentries.list"] ||
      v["inventoryentries.list"]
    );
    const mappedItems = [];
    for (const inv of rawItems) {
      if (!inv) continue;
      const qty = Math.abs(parseFloat(inv.quantity) || 1);
      const amtPaise = Math.round(Math.abs(Number(inv.amount) || 0) * 100);
      mappedItems.push({
        name: inv.stockitemname || inv.stock_item_name || "Item",
        hsn: inv.hsncode || inv.hsn_code || "9999",
        qty: Math.max(0.0001, qty),
        unit: inv.unit || inv.unit_name || "PCS",
        rate: Math.round(Math.abs(Number(inv.rate) || 0) * 100) || amtPaise,
        taxableValue: amtPaise,
        taxRate: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        cess: 0,
        total: amtPaise,
      });
    }

    const doc = {
      _id: voucherId,
      companyId: compId,
      voucherType: vType,
      voucherNumber: vNum,
      financialYear: fy,
      date: dateStr,
      dueDate: v.duedate ? parseDateToIso(v.duedate) : null,
      status: isCancelled ? "CANCELLED" : "POSTED",
      paymentStatus: "UNPAID",
      narration: v.narration || null,
      tallyVoucherType: rawType,
      isOptional: v.isoptional === "Yes" || v.isoptional === true,
      party: vType !== "CONTRA" ? partySnapshot : null,
      items: mappedItems.length > 0 ? mappedItems : undefined,
      entries: mappedEntries.length >= 2 ? mappedEntries : undefined,
      summary: {
        subtotal: totalDebit,
        taxTotal: 0,
        roundOff: 0,
        grandTotal: totalDebit,
      },
      sync: {
        source: "TALLY_SYNC",
        tallyGuid,
        tallyMasterId: v.masterid ? Number(v.masterid) : null,
        tallyAlterId: v.alterid ? Number(v.alterid) : null,
        tallyVoucherType: rawType,
        isDeletedInTally: false,
        balanceMismatch: totalDebit !== totalCredit,
        tallyExtras: {
          reference: v.reference,
          reference_date: v.referencedate,
        },
      },
    };

    // Ensure entries have at least 2 rows for schema compatibility if Tally sent 1 row
    if (!doc.entries || doc.entries.length < 2) {
      doc.entries = [
        {
          ledgerId: partySnapshot.ledgerId,
          name: partySnapshot.name,
          debit: totalDebit,
          credit: 0,
        },
        {
          ledgerId: compId,
          name: "General Balance Ledger",
          debit: 0,
          credit: totalDebit,
        },
      ];
    }

    voucherBulkOps.push({
      updateOne: {
        filter: { companyId: compId, "sync.tallyGuid": tallyGuid },
        update: { $set: doc },
        upsert: true,
      },
    });
  }

  // 4. Execute Unified Voucher Bulk Operations
  if (voucherBulkOps.length > 0) {
    await UnifiedVoucher.bulkWrite(voucherBulkOps, { ordered: false });
  }

  // 5. Replace LedgerPostings for updated vouchers
  if (voucherIdsToClearPostings.length > 0) {
    await LedgerPosting.deleteMany({
      companyId: compId,
      voucherId: { $in: voucherIdsToClearPostings },
    });
    if (postingsToInsert.length > 0) {
      await LedgerPosting.insertMany(postingsToInsert, { ordered: false });
    }
  }

  return {
    success: true,
    syncedCount: voucherBulkOps.length,
    postingsCount: postingsToInsert.length,
  };
}
