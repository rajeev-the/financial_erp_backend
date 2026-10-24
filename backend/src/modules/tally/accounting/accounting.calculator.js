/*
|--------------------------------------------------------------------------
| Convert Tally Entry → Debit / Credit
|--------------------------------------------------------------------------
*/

export const getEntrySide = (entry) => {
  const amount = Number(entry.amount) || 0;

  if (entry.entry_type === "DEBIT") return "debit";
  if (entry.entry_type === "CREDIT") return "credit";

  // In Tally:
  // - is_deemed_positive = false with positive amount is DEBIT
  // - is_deemed_positive = true (or negative adjustment entries) is CREDIT
  if (entry.is_deemed_positive === false) {
    return amount >= 0 ? "debit" : "credit";
  } else {
    return "credit";
  }
};



/*
|--------------------------------------------------------------------------
| TRANSACTION CALCULATION (Sales, Purchase, Expense, Income)
|--------------------------------------------------------------------------
*/

export const calculateTransaction = ({ entries = [], ledgers = [], side = "debit" }) => {
  let totalDebit = 0;
  let totalCredit = 0;

  if (Array.isArray(ledgers) && ledgers.length > 0) {
    // In Tally Trial Balance, total_debit and total_credit represent the sum
    // of individual ledger net balances classified into Dr or Cr columns
    for (const ledger of ledgers) {
      const rawAmount = Number(ledger.amount) || 0;
      if (!rawAmount) continue;

      const net = ledger.net !== undefined ? Number(ledger.net) : rawAmount;
      const absAmount = Math.abs(rawAmount);

      if (side === "debit") {
        // In Tally XML, Debit entries are negative (net <= 0)
        if (net <= 0) {
          totalDebit += absAmount;
        } else {
          totalCredit += absAmount;
        }
      } else {
        // For Credit-nature groups (Sales, Incomes):
        if (net >= 0) {
          totalCredit += absAmount;
        } else {
          totalDebit += absAmount;
        }
      }
    }
  } else {
    // Fallback to entry-level accumulation if ledgers are not provided
    for (const entry of entries) {
      const rawAmount = Number(entry.amount) || 0;
      const absAmount = Math.abs(rawAmount);
      if (!absAmount) continue;

      const entrySide = getEntrySide(entry);

      if (entrySide === "debit") {
        totalDebit += absAmount;
      } else {
        totalCredit += absAmount;
      }
    }
  }

  totalDebit = Math.round(totalDebit * 100) / 100;
  totalCredit = Math.round(totalCredit * 100) / 100;

  // Net amount (Debit - Credit for debit side, Credit - Debit for credit side)
  const netAmount = Math.round(Math.abs(totalDebit - totalCredit) * 100) / 100;

  return {
    total_debit: totalDebit,
    total_credit: totalCredit,
    total_amount: netAmount,
    amount: netAmount,
  };
};

/*
|--------------------------------------------------------------------------
| BALANCE CALCULATION (Cash, Bank)
|--------------------------------------------------------------------------
*/

export const calculateBalance = ({ entries, normalSide = "debit" }) => {
  let totalDebit = 0;
  let totalCredit = 0;

  for (const entry of entries) {
    const amount = Number(entry.amount) || 0;
    const side = getEntrySide(entry);

    if (side === "debit") {
      totalDebit += amount;
    } else {
      totalCredit += amount;
    }
  }

  totalDebit = Math.round(totalDebit * 100) / 100;
  totalCredit = Math.round(totalCredit * 100) / 100;

  /*
   * Net balance calculated with respect to normal side:
   * Debit normal balance accounts (Cash, Bank, Debtors): Debit - Credit
   * Credit normal balance accounts (Creditors, Loans): Credit - Debit
   */

  const netBalance =
    normalSide === "credit"
      ? Math.round((totalCredit - totalDebit) * 100) / 100
      : Math.round((totalDebit - totalCredit) * 100) / 100;

  return {
    total_debit: totalDebit,
    total_credit: totalCredit,
    balance: Math.round(Math.abs(netBalance) * 100) / 100,
    net_balance: netBalance,
  };
};



/*
|--------------------------------------------------------------------------
| OUTSTANDING CALCULATION (Receivable / Sundry Debtors, Payable / Sundry Creditors)
|--------------------------------------------------------------------------
*/

export const calculateOutstanding = ({
  entries,
  ledgers,
  vouchers = [],
  normalSide = "debit",
}) => {
  // ---------------------------------------
  // 1. Create ledger lookup
  // ---------------------------------------
  const ledgerMap = new Map(
    ledgers.map((ledger) => [String(ledger._id), ledger])
  );

  // ---------------------------------------
  // 2. Group entries by ledger
  // ---------------------------------------
  const partyMap = new Map();

  for (const entry of entries) {
    const ledgerId = String(entry.ledger_id);
    const rawAmount = Number(entry.amount) || 0;
    const amount = Math.abs(rawAmount);

    // Determine debit / credit
    const isDebit =
      (rawAmount > 0 && !entry.is_deemed_positive) ||
      (rawAmount < 0 && entry.is_deemed_positive);

    const debit = isDebit ? amount : 0;
    const credit = !isDebit ? amount : 0;

    if (!partyMap.has(ledgerId)) {
      partyMap.set(ledgerId, {
        ledger_id: entry.ledger_id,
        debit: 0,
        credit: 0,
      });
    }

    const party = partyMap.get(ledgerId);
    party.debit += debit;
    party.credit += credit;
  }

  // ---------------------------------------
  // 3. Calculate outstanding
  // ---------------------------------------
  const parties = [];

  for (const party of partyMap.values()) {
    let outstanding;

    if (normalSide === "debit") {
      // Receivable (Sundry Debtors: Debit - Credit)
      outstanding = party.debit - party.credit;
    } else {
      // Payable (Sundry Creditors: Credit - Debit)
      outstanding = party.credit - party.debit;
    }

    // Only actual positive outstanding
    if (outstanding <= 0) {
      continue;
    }

    const ledger = ledgerMap.get(String(party.ledger_id));

    parties.push({
      ledger_id: party.ledger_id,
      party_name: ledger?.name || "Unknown",
      group_id: ledger?.group_id || null,
      parent: ledger?.parent || null,
      debit: Math.round(party.debit * 100) / 100,
      credit: Math.round(party.credit * 100) / 100,
      outstanding: Math.round(outstanding * 100) / 100,
    });
  }

  // ---------------------------------------
  // 4. Sort highest outstanding first
  // ---------------------------------------
  parties.sort((a, b) => b.outstanding - a.outstanding);

  // ---------------------------------------
  // 5. Total
  // ---------------------------------------
  const total = parties.reduce(
    (sum, party) => sum + party.outstanding,
    0
  );

  // ---------------------------------------
  // 6. Final response
  // ---------------------------------------
  return {
    total: Math.round(total * 100) / 100,
    amount: Math.round(total * 100) / 100,
    total_parties: parties.length,
    parties,
  };
};

