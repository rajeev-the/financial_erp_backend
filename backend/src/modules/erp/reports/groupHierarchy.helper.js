import Group from "../../tally/group/group.schema.js";
import Ledger from "../../tally/ledger/ledger.schema.js";
import LedgerBalanceDetails from "../../tally/ledger/ledgerBalanceDetails.schema.js";

/**
 * Resolves all descendant group names recursively starting from root group names.
 */
export function getDescendantGroupNames(allGroups, rootNames) {
  const normalizedRoots = rootNames.map((n) => n.trim().toLowerCase());
  const descendants = new Set(normalizedRoots);

  let added = true;
  while (added) {
    added = false;
    for (const g of allGroups) {
      if (!g.name || !g.parent) continue;
      const parentLower = g.parent.trim().toLowerCase();
      const nameLower = g.name.trim().toLowerCase();
      if (descendants.has(parentLower) && !descendants.has(nameLower)) {
        descendants.add(nameLower);
        added = true;
      }
    }
  }

  return descendants;
}

const BUCKET_CACHE = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL for stable ledger hierarchies

/**
 * Loads company groups and categorizes all company ledgers into high-level accounting buckets:
 * - Sales, Purchases, Direct Expenses, Indirect Expenses, Direct Incomes, Indirect Incomes
 * - Cash-in-Hand, Bank Accounts, Sundry Debtors, Sundry Creditors
 * - Capital Account, Loans, Fixed Assets, Investments, Duties & Taxes, Current Liabilities, Current Assets
 */
export async function getCompanyLedgerBuckets(companyId) {
  const cId = String(companyId);
  const cached = BUCKET_CACHE.get(cId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const [allGroups, allLedgers, allBalanceDetails] = await Promise.all([
    Group.find({ company_id: companyId, is_deleted: { $ne: true } })
      .select("_id name parent company_id")
      .lean(),
    Ledger.find({ company_id: companyId, is_deleted: { $ne: true } })
      .select("_id name parent classification opening_balance is_deemed_positive")
      .lean(),
    LedgerBalanceDetails.find({ company_id: companyId })
      .select("ledger_id opening_balance is_deemed_positive from_date")
      .sort({ from_date: 1 })
      .lean(),
  ]);

  const salesGroups = getDescendantGroupNames(allGroups, ["Sales Accounts"]);
  const purchaseGroups = getDescendantGroupNames(allGroups, ["Purchase Accounts"]);
  const expenseGroups = getDescendantGroupNames(allGroups, ["Indirect Expenses"]);
  const directExpGroups = getDescendantGroupNames(allGroups, ["Direct Expenses"]);
  const directIncomeGroups = getDescendantGroupNames(allGroups, ["Direct Incomes"]);
  const indirectIncomeGroups = getDescendantGroupNames(allGroups, ["Indirect Incomes"]);

  const cashGroups = getDescendantGroupNames(allGroups, ["Cash-in-Hand"]);
  const bankGroups = getDescendantGroupNames(allGroups, ["Bank Accounts", "Bank OD A/c", "Bank OCC A/c"]);
  const debtorGroups = getDescendantGroupNames(allGroups, ["Sundry Debtors"]);
  const creditorGroups = getDescendantGroupNames(allGroups, ["Sundry Creditors"]);

  const capitalGroups = getDescendantGroupNames(allGroups, ["Capital Account", "Reserves & Surplus", "Reserves and Surplus"]);
  const loanGroups = getDescendantGroupNames(allGroups, ["Secured Loans", "Unsecured Loans", "Loans (Liability)"]);
  const fixedAssetGroups = getDescendantGroupNames(allGroups, ["Fixed Assets"]);
  const investmentGroups = getDescendantGroupNames(allGroups, ["Investments"]);
  const dutiesAndTaxesGroups = getDescendantGroupNames(allGroups, ["Duties & Taxes", "Duties and Taxes"]);
  const liabilityGroups = getDescendantGroupNames(allGroups, ["Current Liabilities", "Provisions"]);
  const assetGroups = getDescendantGroupNames(allGroups, ["Current Assets", "Deposits (Asset)", "Loans & Advances (Asset)"]);

  // Build raw opening balances map from LedgerBalanceDetails at earliest baseline date
  const rawBalanceDetailsMap = new Map();
  if (allBalanceDetails && allBalanceDetails.length > 0) {
    const earliestFrom = allBalanceDetails[0].from_date;
    for (const b of allBalanceDetails) {
      if (String(b.from_date) === String(earliestFrom)) {
        rawBalanceDetailsMap.set(b.ledger_id.toString(), {
          raw: Number(b.opening_balance) || 0,
          isDeemedPositive: b.is_deemed_positive,
        });
      }
    }
  }

  const buckets = {
    salesLedgerIds: new Set(),
    purchaseLedgerIds: new Set(),
    expenseLedgerIds: new Set(),
    directExpenseLedgerIds: new Set(),
    directIncomeLedgerIds: new Set(),
    indirectIncomeLedgerIds: new Set(),
    cashLedgerIds: new Set(),
    bankLedgerIds: new Set(),
    debtorLedgerIds: new Set(),
    creditorLedgerIds: new Set(),
    capitalLedgerIds: new Set(),
    loanLedgerIds: new Set(),
    fixedAssetLedgerIds: new Set(),
    investmentLedgerIds: new Set(),
    dutiesAndTaxesLedgerIds: new Set(),
    liabilityLedgerIds: new Set(),
    assetLedgerIds: new Set(),
    allGroups,
    ledgerMap: new Map(),
  };

  for (const l of allLedgers) {
    const p = (typeof l.parent === "string" ? l.parent : (l.parent?.name || "")).trim().toLowerCase();
    const id = l._id.toString();
    const nameLower = (l.name || "").trim().toLowerCase();

    const balDetail = rawBalanceDetailsMap.get(id);
    let openingBalance = 0;
    if (balDetail) {
      const raw = balDetail.raw;
      if (creditorGroups.has(p)) {
        // Creditors (Sundry Creditors): raw > 0 is Credit (payable: +), raw < 0 is Debit (advance: -)
        openingBalance = raw > 0 ? Math.abs(raw) : (raw < 0 ? -Math.abs(raw) : 0);
      } else if (debtorGroups.has(p)) {
        // Debtors (Sundry Debtors): raw < 0 or isDeemedPositive is Debit (receivable: +), raw > 0 is Credit (advance: -)
        const isDebit = raw < 0 || balDetail.isDeemedPositive === true;
        openingBalance = isDebit ? Math.abs(raw) : (raw !== 0 ? -Math.abs(raw) : 0);
      } else if (cashGroups.has(p) || nameLower === "cash" || bankGroups.has(p) || nameLower.includes("bank")) {
        // Bank / Cash: raw < 0 is Debit (asset cash/bank: +), raw > 0 is Credit (overdraft: -)
        const isDebit = raw < 0;
        openingBalance = isDebit ? Math.abs(raw) : (raw !== 0 ? -Math.abs(raw) : 0);
      } else {
        // Default standard Tally numeric convention: negative in Tally is Debit
        const isDebit = raw < 0 || balDetail.isDeemedPositive === true;
        openingBalance = isDebit ? Math.abs(raw) : (raw !== 0 ? -Math.abs(raw) : 0);
      }
    } else {
      openingBalance = Number(l.opening_balance) || 0;
    }

    buckets.ledgerMap.set(id, {
      id: l._id,
      name: l.name,
      parent: l.parent,
      openingBalance,
      closingBalance: Number(l.closing_balance) || 0,
      gstin: l.gstin || null,
      stateCode: l.state_code || "27",
      phone: l.phone || l.mobile || null,
      address: l.address || l.mailing_address || null,
    });

    if (salesGroups.has(p)) buckets.salesLedgerIds.add(id);
    if (purchaseGroups.has(p)) buckets.purchaseLedgerIds.add(id);
    if (expenseGroups.has(p)) buckets.expenseLedgerIds.add(id);
    if (directExpGroups.has(p)) buckets.directExpenseLedgerIds.add(id);
    if (directIncomeGroups.has(p)) buckets.directIncomeLedgerIds.add(id);
    if (indirectIncomeGroups.has(p)) buckets.indirectIncomeLedgerIds.add(id);

    if (cashGroups.has(p) || nameLower === "cash") buckets.cashLedgerIds.add(id);
    const isBankExp = expenseGroups.has(p) || directExpGroups.has(p) || nameLower.includes("charge") || nameLower.includes("fee");
    if (bankGroups.has(p) || (nameLower.includes("bank") && !isBankExp)) buckets.bankLedgerIds.add(id);

    if (debtorGroups.has(p)) buckets.debtorLedgerIds.add(id);
    if (creditorGroups.has(p)) buckets.creditorLedgerIds.add(id);

    if (capitalGroups.has(p)) buckets.capitalLedgerIds.add(id);
    if (loanGroups.has(p)) buckets.loanLedgerIds.add(id);
    if (fixedAssetGroups.has(p)) buckets.fixedAssetLedgerIds.add(id);
    if (investmentGroups.has(p)) buckets.investmentLedgerIds.add(id);
    if (dutiesAndTaxesGroups.has(p)) buckets.dutiesAndTaxesLedgerIds.add(id);
    if (liabilityGroups.has(p)) buckets.liabilityLedgerIds.add(id);
    if (assetGroups.has(p)) buckets.assetLedgerIds.add(id);
  }

  BUCKET_CACHE.set(cId, { timestamp: Date.now(), data: buckets });
  return buckets;
}

