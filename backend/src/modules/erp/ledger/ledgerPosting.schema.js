import { Schema, model } from "mongoose";

const ledgerPostingSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    ledgerId: {
      type: Schema.Types.ObjectId,
      ref: "Ledger",
      required: true,
      index: true,
    },
    date: {
      type: String, // "YYYY-MM-DD"
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
    },
    voucherId: {
      type: Schema.Types.ObjectId,
      ref: "UnifiedVoucher",
      required: true,
      index: true,
    },
    voucherType: {
      type: String,
      required: true,
    },
    voucherNumber: {
      type: String,
      required: true,
      trim: true,
    },
    debit: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    credit: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    partyName: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: false,
    versionKey: false,
    collection: "ledger_postings",
  }
);

ledgerPostingSchema.index({ companyId: 1, ledgerId: 1, date: 1 });
ledgerPostingSchema.index({ companyId: 1, date: 1 });

const LedgerPosting = model("LedgerPosting", ledgerPostingSchema);
export default LedgerPosting;
