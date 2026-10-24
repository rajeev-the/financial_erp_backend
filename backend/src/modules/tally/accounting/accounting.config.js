export const ACCOUNTING_CONFIG = {
  sales: {
    type: "transaction",
    groups: ["Sales Accounts"],
    side: "credit",
    normal_side: "credit",
  },

  purchase: {
    type: "transaction",
    groups: ["Purchase Accounts"],
    side: "debit",
    normal_side: "debit",
  },

  expense: {
    type: "transaction",
    groups: [
      "Indirect Expenses",
    ],
    side: "debit",
    normal_side: "debit",
  },

  direct_expense: {
    type: "transaction",
    groups: ["Direct Expenses"],
    side: "debit",
    normal_side: "debit",
  },

  indirect_expense: {
    type: "transaction",
    groups: ["Indirect Expenses"],
    side: "debit",
    normal_side: "debit",
  },

  income: {
    type: "transaction",
    groups: [
      "Direct Incomes",
      "Indirect Incomes",
    ],
    side: "credit",
    normal_side: "credit",
  },

  direct_income: {
    type: "transaction",
    groups: ["Direct Incomes"],
    side: "credit",
    normal_side: "credit",
  },

  indirect_income: {
    type: "transaction",
    groups: ["Indirect Incomes"],
    side: "credit",
    normal_side: "credit",
  },

  cash: {
    type: "balance",
    groups: ["Cash-in-Hand"],
    normal_side: "debit",
  },
 
  bank: {
    type: "balance",
    groups: ["Bank Accounts"],
    normal_side: "debit",
  },

  receivable: {
    type: "outstanding",
    groups: ["Sundry Debtors"],
    normal_side: "debit",
  },

  payable: {
    type: "outstanding",
    groups: ["Sundry Creditors"],
    normal_side: "credit",
  },
     gstReceivable: {
        type: "tax",
        groups: ["GST Receivable"],
        normal_side: "debit"
    },

    tdsReceivable: {
        type: "tax",
        groups: ["TDS Receivable"],
        normal_side: "debit"
    }
};
