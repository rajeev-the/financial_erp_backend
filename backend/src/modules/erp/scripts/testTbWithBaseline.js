import mongoose from "mongoose";
import dotenv from "dotenv";
import envConfig from "../../../config/env.js";
import Group from "../../tally/group/group.schema.js";
import Ledger from "../../tally/ledger/ledger.schema.js";
import LedgerBalanceDetails from "../../tally/ledger/ledgerBalanceDetails.schema.js";
import LedgerPosting from "../ledger/ledgerPosting.schema.js";
import { getCompanyLedgerBuckets } from "../reports/groupHierarchy.helper.js";

dotenv.config();

async function testWithBaselineOpenings() {
  await mongoose.connect(envConfig.MONGO_URI);
  const companyId = "6aa0ebf73a3260ebc741698b";

  const allBal = await LedgerBalanceDetails.find({ company_id: companyId }).sort({ from_date: 1 }).lean();
  const earliestDate = allBal[0].from_date;
  const baselineOpeningMap = new Map();
  for (const b of allBal) {
    if (String(b.from_date) === String(earliestDate)) {
      const raw = Number(b.opening_balance) || 0;
      const isDebit = b.is_deemed_positive !== undefined ? b.is_deemed_positive : raw < 0;
      const val = isDebit ? -Math.abs(raw) : Math.abs(raw);
      baselineOpeningMap.set(b.ledger_id.toString(), val);
    }
  }

  const buckets = await getCompanyLedgerBuckets(companyId);

  // FY 2024-2025
  const effectiveFrom = "2024-04-01";
  const effectiveTo = "2025-03-31";

  const priorDeltaMap = new Map();
  if (effectiveFrom) {
    const priorAgg = await LedgerPosting.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(companyId), date: { $lt: effectiveFrom } } },
      { $group: { _id: "$ledgerId", totalDebit: { $sum: "$debit" }, totalCredit: { $sum: "$credit" } } },
    ]);
    for (const p of priorAgg) {
      priorDeltaMap.set(p._id.toString(), {
        dr: (p.totalDebit || 0) / 100,
        cr: (p.totalCredit || 0) / 100,
      });
    }
  }

  const postings = await LedgerPosting.aggregate([
    { $match: { companyId: new mongoose.Types.ObjectId(companyId), date: { $gte: effectiveFrom, $lte: effectiveTo } } },
    { $group: { _id: "$ledgerId", totalDebit: { $sum: "$debit" }, totalCredit: { $sum: "$credit" } } },
  ]);

  const postMap = new Map();
  for (const p of postings) {
    postMap.set(p._id.toString(), {
      dr: (p.totalDebit || 0) / 100,
      cr: (p.totalCredit || 0) / 100,
    });
  }

  let totalOpenDr = 0, totalOpenCr = 0;
  let totalPeriodDr = 0, totalPeriodCr = 0;
  let totalCloseDr = 0, totalCloseCr = 0;

  let cashCloseDr = 0, cashCloseCr = 0;
  let bankCloseDr = 0, bankCloseCr = 0;
  let debtorCloseDr = 0, debtorCloseCr = 0;
  let creditorCloseDr = 0, creditorCloseCr = 0;

  for (const [id, l] of buckets.ledgerMap.entries()) {
    const rawOpening = baselineOpeningMap.get(id) || 0;
    const isBaseDebit = rawOpening < 0;
    const baseDr = isBaseDebit ? Math.abs(rawOpening) : 0;
    const baseCr = !isBaseDebit && rawOpening !== 0 ? Math.abs(rawOpening) : 0;

    const prior = priorDeltaMap.get(id) || { dr: 0, cr: 0 };
    const netOpen = (baseDr + prior.dr) - (baseCr + prior.cr);
    const openDr = netOpen > 0 ? netOpen : 0;
    const openCr = netOpen < 0 ? Math.abs(netOpen) : 0;

    const period = postMap.get(id) || { dr: 0, cr: 0 };
    const netClose = (openDr + period.dr) - (openCr + period.cr);
    const closeDr = netClose > 0 ? netClose : 0;
    const closeCr = netClose < 0 ? Math.abs(netClose) : 0;

    totalOpenDr += openDr;
    totalOpenCr += openCr;
    totalPeriodDr += period.dr;
    totalPeriodCr += period.cr;
    totalCloseDr += closeDr;
    totalCloseCr += closeCr;

    if (buckets.cashLedgerIds.has(id)) {
      cashCloseDr += closeDr;
      cashCloseCr += closeCr;
    }
    if (buckets.bankLedgerIds.has(id)) {
      bankCloseDr += closeDr;
      bankCloseCr += closeCr;
    }
    if (buckets.debtorLedgerIds.has(id)) {
      debtorCloseDr += closeDr;
      debtorCloseCr += closeCr;
    }
    if (buckets.creditorLedgerIds.has(id)) {
      creditorCloseDr += closeDr;
      creditorCloseCr += closeCr;
    }
  }

  const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

  console.log("=== TRIAL BALANCE WITH BASELINE OPENINGS ===");
  console.log({
    openingDebit: round2(totalOpenDr),
    openingCredit: round2(totalOpenCr),
    openDiff: round2(totalOpenDr - totalOpenCr),
    periodDebit: round2(totalPeriodDr),
    periodCredit: round2(totalPeriodCr),
    periodDiff: round2(totalPeriodDr - totalPeriodCr),
    closingDebit: round2(totalCloseDr),
    closingCredit: round2(totalCloseCr),
    closeDiff: round2(totalCloseDr - totalCloseCr),
  });

  console.log("\n=== CLOSING BALANCES RECONCILIATION WITH DASHBOARD ===");
  console.log(`Cash Net Dr:       ₹${round2(cashCloseDr - cashCloseCr)} (Dashboard: ₹18644.40)`);
  console.log(`Bank Net Dr:       ₹${round2(bankCloseDr - bankCloseCr)} (Dashboard: ₹4714846.25)`);
  console.log(`Debtors Net Dr:    ₹${round2(debtorCloseDr - debtorCloseCr)} (Dashboard: ₹1848776.03)`);
  console.log(`Creditors Net Cr:  ₹${round2(creditorCloseCr - creditorCloseDr)} (Dashboard: ₹1161216.77)`);

  await mongoose.disconnect();
}

testWithBaselineOpenings().catch(console.error);
