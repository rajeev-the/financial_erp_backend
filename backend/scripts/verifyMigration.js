import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import LedgerEntry from "../src/modules/tally/voucher/ledgerentry.schema.js";
import InventoryEntry from "../src/modules/tally/voucher/inventoryentry.schema.js";
import Voucher from "../src/modules/tally/voucher/voucher.schema.js";
import Ledger from "../src/modules/tally/ledger/ledger.schema.js";
import Group from "../src/modules/tally/group/group.schema.js";

async function verify() {
  await mongoose.connect(process.env.MONGO_URI);

  console.log("=== POST-MIGRATION COUNTS ===");
  const lc = await LedgerEntry.countDocuments({});
  const ic = await InventoryEntry.countDocuments({});
  console.log("LedgerEntry count:", lc);
  console.log("InventoryEntry count:", ic);

  // Test calculateSalesThroughVoucher simulation
  const compId = new mongoose.Types.ObjectId("6a955243a8c39d30663cca31");
  const fromDate = new Date("2025-04-01");
  const toDate = new Date("2026-03-31");
  toDate.setHours(23, 59, 59, 999);

  const vouchers = await Voucher.find({
    company_id: compId,
    is_deleted: false,
    is_optional: { $ne: true },
    is_cancelled: { $ne: true },
    date: { $gte: fromDate, $lte: toDate },
  })
    .select("_id date vchtype voucher_number narration party_ledger_name")
    .sort({ date: -1 })
    .lean();

  console.log("Matching vouchers count:", vouchers.length);
  const voucherIds = vouchers.map((v) => v._id);

  const [ledgerEntries, inventoryEntries, groups] = await Promise.all([
    LedgerEntry.find({
      voucher_id: { $in: voucherIds },
      company_id: compId,
      is_deleted: { $ne: true },
    })
      .populate("ledger_id")
      .lean(),
    InventoryEntry.find({
      voucher_id: { $in: voucherIds },
      company_id: compId,
      is_deleted: { $ne: true },
    })
      .populate("accounting_ledger_id")
      .lean(),
    Group.find({ company_id: compId, is_deleted: false }).select("name parent").lean(),
  ]);

  console.log("Retrieved ledgerEntries count:", ledgerEntries.length);
  console.log("Retrieved inventoryEntries count:", inventoryEntries.length);

  const salesGroupNames = new Set(["sales accounts"]);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const g of groups) {
      const nameLower = g.name?.trim().toLowerCase();
      const parentLower = g.parent?.trim().toLowerCase();
      if (parentLower && salesGroupNames.has(parentLower) && !salesGroupNames.has(nameLower)) {
        salesGroupNames.add(nameLower);
        expanded = true;
      }
    }
  }

  let total_dr_amount = 0;
  let total_cr_amount = 0;
  const voucherIdsWithSales = new Set();

  const isSalesLedger = (ledger) => {
    if (!ledger) return false;
    const groupParent = ledger.group_id?.parent?.trim()?.toLowerCase();
    const groupName = ledger.group_id?.name?.trim()?.toLowerCase();
    const ledgerParent = ledger.parent?.trim()?.toLowerCase();
    const ledgerName = ledger.name?.trim()?.toLowerCase();

    return (
      salesGroupNames.has(ledgerParent) ||
      salesGroupNames.has(ledgerName) ||
      (groupParent && salesGroupNames.has(groupParent)) ||
      (groupName && salesGroupNames.has(groupName))
    );
  };

  ledgerEntries.forEach((entry) => {
    const ledger = entry.ledger_id;
    if (!ledger) return;
    if (isSalesLedger(ledger)) {
      voucherIdsWithSales.add(String(entry.voucher_id));
      const amount = Number(entry.amount) || 0;
      if (
        (amount > 0 && !entry.is_deemed_positive) ||
        (amount < 0 && entry.is_deemed_positive)
      ) {
        total_dr_amount += amount;
      } else {
        total_cr_amount += amount;
      }
    }
  });

  inventoryEntries.forEach((entry) => {
    const ledger = entry.accounting_ledger_id;
    if (!ledger) return;
    if (isSalesLedger(ledger)) {
      voucherIdsWithSales.add(String(entry.voucher_id));
      const amount =
        Number(
          entry.accounting_amount !== undefined && entry.accounting_amount !== null
            ? entry.accounting_amount
            : entry.amount,
        ) || 0;
      const isDeemedPositive =
        entry.accounting_isdeemedpositive !== undefined
          ? entry.accounting_isdeemedpositive
          : entry.is_deemed_positive;
      if (
        (amount > 0 && !isDeemedPositive) ||
        (amount < 0 && isDeemedPositive)
      ) {
        total_dr_amount += amount;
      } else {
        total_cr_amount += amount;
      }
    }
  });

  const filteredVouchers = vouchers.filter((v) =>
    voucherIdsWithSales.has(String(v._id)),
  );
  const roundedDr = Math.round(total_dr_amount * 100) / 100;
  const roundedCr = Math.round(total_cr_amount * 100) / 100;
  const total_amount = Math.round((roundedCr + roundedDr) * 100) / 100;

  console.log("\n=== SALES CALCULATION RESULT ===");
  console.log({
    salesVouchersCount: filteredVouchers.length,
    total_amount,
    total_dr_amount: roundedDr,
    total_cr_amount: roundedCr,
  });

  // Date validation check
  console.log("\n=== DATE VALIDATION TEST ===");
  const testInvalidDate = (from_date, to_date) => {
    const fromD = new Date(from_date);
    const toD = new Date(to_date);
    if (isNaN(fromD.getTime()) || isNaN(toD.getTime())) {
      return { success: false, error: "Invalid date format for from_date or to_date. Please use YYYY-MM-DD." };
    }
    return { success: true };
  };

  const check1 = testInvalidDate("2025-0-01", "2026-03-31");
  console.log("Invalid date '2025-0-01' caught properly:", !check1.success, check1.error);

  const check2 = testInvalidDate("2025-04-01", "2026-03-31");
  console.log("Valid date '2025-04-01' passed:", check2.success);

  await mongoose.disconnect();
}

verify().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
