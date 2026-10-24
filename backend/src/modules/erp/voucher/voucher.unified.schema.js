import mongoose, { Schema, model } from "mongoose";

/**
 * Allowed GST tax slabs in India
 */
export const ALLOWED_GST_RATES = [0, 0.25, 1.5, 3, 5, 12, 18, 28];

/**
 * Voucher Type Matrix definition:
 * R = Required, O = Optional, F = Forbidden
 */
export const VOUCHER_TYPE_MATRIX = {
  SALES: {
    party: "R",
    items: "R",
    gst: "R",
    supplierInvoice: "F",
    allocations: "O",
    payment: "O",
    originalVoucher: "F",
    transfer: "F",
  },
  PURCHASE: {
    party: "R",
    items: "R",
    gst: "R",
    supplierInvoice: "R",
    allocations: "O",
    payment: "O",
    originalVoucher: "F",
    transfer: "F",
  },
  CREDIT_NOTE: {
    party: "R",
    items: "R",
    gst: "R",
    supplierInvoice: "F",
    allocations: "R",
    payment: "F",
    originalVoucher: "R",
    transfer: "F",
  },
  DEBIT_NOTE: {
    party: "R",
    items: "R",
    gst: "R",
    supplierInvoice: "O",
    allocations: "R",
    payment: "F",
    originalVoucher: "R",
    transfer: "F",
  },
  RECEIPT: {
    party: "R",
    items: "F",
    gst: "F",
    supplierInvoice: "F",
    allocations: "O",
    payment: "R",
    originalVoucher: "F",
    transfer: "F",
  },
  PAYMENT: {
    party: "R",
    items: "F",
    gst: "F",
    supplierInvoice: "F",
    allocations: "O",
    payment: "R",
    originalVoucher: "F",
    transfer: "F",
  },
  CONTRA: {
    party: "F",
    items: "F",
    gst: "F",
    supplierInvoice: "F",
    allocations: "F",
    payment: "O",
    originalVoucher: "F",
    transfer: "R",
  },
  JOURNAL: {
    party: "O",
    items: "F",
    gst: "F",
    supplierInvoice: "F",
    allocations: "F",
    payment: "F",
    originalVoucher: "F",
    transfer: "F",
  },
};

// ----------------------------------------------------
// Sub-schemas
// ----------------------------------------------------

const partySnapshotSchema = new Schema(
  {
    ledgerId: { type: Schema.Types.ObjectId, ref: "Ledger", required: true },
    name: { type: String, required: true, trim: true },
    gstin: { type: String, trim: true, default: null },
    stateCode: { type: String, trim: true, default: null },
    address: { type: String, trim: true, default: null },
    phone: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const gstBlockSchema = new Schema(
  {
    placeOfSupply: { type: String, required: true, trim: true },
    supplyType: {
      type: String,
      enum: ["B2B", "B2C", "EXPORT", "SEZ"],
      default: "B2B",
      required: true,
    },
    taxMode: {
      type: String,
      enum: ["INTRA", "INTER"],
      required: true,
    },
    reverseCharge: { type: Boolean, default: false },
    irn: { type: String, trim: true, default: null },
    ewayBillNo: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const itemLineSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "StockItem", default: null },
    name: { type: String, required: true, trim: true },
    hsn: { type: String, required: true, trim: true },
    qty: { type: Number, required: true, min: 0.0001 },
    unit: { type: String, required: true, trim: true },
    rate: { type: Number, required: true, min: 0 }, // Paise
    discountPct: { type: Number, default: 0, min: 0, max: 100 },
    discount: { type: Number, default: 0, min: 0 }, // Paise
    taxableValue: { type: Number, required: true, min: 0 }, // Paise
    taxRate: {
      type: Number,
      required: true,
      enum: ALLOWED_GST_RATES,
    },
    cgst: { type: Number, default: 0, min: 0 }, // Paise
    sgst: { type: Number, default: 0, min: 0 }, // Paise
    igst: { type: Number, default: 0, min: 0 }, // Paise
    cess: { type: Number, default: 0, min: 0 }, // Paise
    total: { type: Number, required: true, min: 0 }, // Paise
    itcEligible: { type: Boolean, default: true },
  },
  { _id: false }
);

const entryLineSchema = new Schema(
  {
    ledgerId: { type: Schema.Types.ObjectId, ref: "Ledger", required: true },
    name: { type: String, required: true, trim: true },
    debit: { type: Number, required: true, min: 0, default: 0 }, // Paise
    credit: { type: Number, required: true, min: 0, default: 0 }, // Paise
  },
  { _id: false }
);

const allocationSchema = new Schema(
  {
    voucherId: { type: Schema.Types.ObjectId, ref: "UnifiedVoucher", required: true },
    voucherNumber: { type: String, trim: true },
    amount: { type: Number, required: true, min: 1 }, // Paise
  },
  { _id: false }
);

const paymentBlockSchema = new Schema(
  {
    mode: {
      type: String,
      enum: ["CASH", "BANK", "UPI", "CHEQUE", "CARD", "OTHER"],
      required: true,
    },
    bankLedgerId: { type: Schema.Types.ObjectId, ref: "Ledger", required: true },
    reference: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const supplierInvoiceSchema = new Schema(
  {
    number: { type: String, required: true, trim: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  },
  { _id: false }
);

const originalVoucherSchema = new Schema(
  {
    voucherId: { type: Schema.Types.ObjectId, ref: "UnifiedVoucher", required: true },
    voucherNumber: { type: String, trim: true },
    reason: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const transferBlockSchema = new Schema(
  {
    fromLedgerId: { type: Schema.Types.ObjectId, ref: "Ledger", required: true },
    toLedgerId: { type: Schema.Types.ObjectId, ref: "Ledger", required: true },
  },
  { _id: false }
);

const summaryBlockSchema = new Schema(
  {
    subtotal: { type: Number, required: true, min: 0 }, // Paise
    taxTotal: { type: Number, required: true, min: 0 }, // Paise
    roundOff: { type: Number, default: 0 }, // Paise (may be negative)
    grandTotal: { type: Number, required: true, min: 0 }, // Paise
  },
  { _id: false }
);

const auditBlockSchema = new Schema(
  {
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdAt: { type: Date, default: Date.now },
    version: { type: Number, default: 1 },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelReason: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const syncBlockSchema = new Schema(
  {
    source: {
      type: String,
      enum: ["APP_DIRECT", "TALLY_SYNC"],
      default: "APP_DIRECT",
      required: true,
    },
    tallyGuid: { type: String, trim: true, default: null },
    tallyMasterId: { type: Number, default: null },
    tallyAlterId: { type: Number, default: null },
    tallyExtras: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

// ----------------------------------------------------
// Master Voucher Unified Schema
// ----------------------------------------------------

const unifiedVoucherSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "companyId is required"],
      index: true,
    },
    voucherType: {
      type: String,
      required: [true, "voucherType is required"],
      enum: Object.keys(VOUCHER_TYPE_MATRIX),
      index: true,
    },
    voucherNumber: {
      type: String,
      required: [true, "voucherNumber is required"],
      maxlength: [16, "Voucher number cannot exceed 16 characters"],
      trim: true,
    },
    financialYear: {
      type: String,
      required: [true, "financialYear is required"],
      trim: true,
    },
    date: {
      type: String,
      required: [true, "date (YYYY-MM-DD) is required"],
      match: [/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"],
      index: true,
    },
    dueDate: {
      type: String,
      match: [/^\d{4}-\d{2}-\d{2}$/, "dueDate must be in YYYY-MM-DD format"],
      default: null,
    },
    status: {
      type: String,
      enum: ["DRAFT", "POSTED", "CANCELLED"],
      default: "POSTED",
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ["UNPAID", "PARTIAL", "PAID"],
      default: "UNPAID",
      index: true,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      default: null,
    },
    narration: {
      type: String,
      trim: true,
      default: null,
    },

    // Specialized Blocks
    party: { type: partySnapshotSchema, default: null },
    gst: { type: gstBlockSchema, default: null },
    items: {
      type: [itemLineSchema],
      default: undefined,
      validate: [
        (items) => !items || items.length <= 200,
        "Voucher cannot exceed 200 line items",
      ],
    },
    supplierInvoice: { type: supplierInvoiceSchema, default: null },
    allocations: { type: [allocationSchema], default: undefined },
    payment: { type: paymentBlockSchema, default: null },
    originalVoucher: { type: originalVoucherSchema, default: null },
    transfer: { type: transferBlockSchema, default: null },

    // Core Accounting
    entries: {
      type: [entryLineSchema],
      required: [true, "Double-entry accounting entries are required"],
      validate: [
        (entries) => entries && entries.length >= 2,
        "Voucher must contain at least 2 double-entry rows",
      ],
    },
    summary: {
      type: summaryBlockSchema,
      required: [true, "Summary block is required"],
    },
    audit: {
      type: auditBlockSchema,
      default: () => ({}),
    },
    sync: {
      type: syncBlockSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
    collection: "vouchers_unified",
  }
);

// ----------------------------------------------------
// Upfront Indexes
// ----------------------------------------------------

unifiedVoucherSchema.index(
  { companyId: 1, voucherType: 1, financialYear: 1, voucherNumber: 1 },
  { unique: true }
);
unifiedVoucherSchema.index({ companyId: 1, date: 1 });
unifiedVoucherSchema.index({ companyId: 1, "entries.ledgerId": 1, date: 1 });
unifiedVoucherSchema.index({ companyId: 1, "party.ledgerId": 1, date: 1 });
unifiedVoucherSchema.index(
  { companyId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);
unifiedVoucherSchema.index({ companyId: 1, "sync.tallyGuid": 1 }, { sparse: true });

// ----------------------------------------------------
// Validation Hook: Type Matrix & Debit == Credit
// ----------------------------------------------------

unifiedVoucherSchema.pre("validate", function () {
  // 1. Skip heavy validation for DRAFT status
  if (this.status === "DRAFT") {
    return;
  }

  const vType = this.voucherType;
  const matrix = VOUCHER_TYPE_MATRIX[vType];

  if (!matrix) {
    throw new Error(`Invalid voucherType: ${vType}`);
  }

  // 2. Validate Type Matrix
  const checkBlock = (name, val) => {
    const rule = matrix[name];
    const isPresent =
      val !== null &&
      val !== undefined &&
      (Array.isArray(val) ? val.length > 0 : Object.keys(val || {}).length > 0);

    if (rule === "R" && !isPresent) {
      return `Block '${name}' is required for voucherType '${vType}'`;
    }
    if (rule === "F" && isPresent) {
      return `Block '${name}' is forbidden for voucherType '${vType}'`;
    }
    return null;
  };

  const blocksToCheck = [
    "party",
    "items",
    "gst",
    "supplierInvoice",
    "allocations",
    "payment",
    "originalVoucher",
    "transfer",
  ];

  for (const b of blocksToCheck) {
    const err = checkBlock(b, this[b]);
    if (err) throw new Error(`Type Matrix Violation: ${err}`);
  }

  // 3. Double-entry validation
  let totalDebit = 0;
  let totalCredit = 0;

  for (let i = 0; i < this.entries.length; i++) {
    const e = this.entries[i];
    const dr = Number(e.debit) || 0;
    const cr = Number(e.credit) || 0;

    // Must be integer paise
    if (!Number.isInteger(dr) || !Number.isInteger(cr)) {
      throw new Error(`Entry row ${i + 1} amounts must be integers in paise`);
    }

    // Exactly one side must be non-zero
    if ((dr > 0 && cr > 0) || (dr === 0 && cr === 0)) {
      throw new Error(
        `Entry row ${i + 1} (${e.name}): exactly one of debit or credit must be greater than zero`
      );
    }

    totalDebit += dr;
    totalCredit += cr;
  }

  if (totalDebit !== totalCredit) {
    throw new Error(
      `Double-entry imbalance: Total debits (${totalDebit} paise) != Total credits (${totalCredit} paise)`
    );
  }

  // 4. Summary grandTotal must match total debit
  if (this.summary && this.summary.grandTotal !== totalDebit) {
    throw new Error(
      `Summary mismatch: summary.grandTotal (${this.summary.grandTotal}) != Total debits (${totalDebit})`
    );
  }
});

const UnifiedVoucher = model("UnifiedVoucher", unifiedVoucherSchema);
export default UnifiedVoucher;
