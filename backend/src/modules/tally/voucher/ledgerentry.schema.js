import  { model, Schema } from "mongoose";
import timeStampObj from "../../common/timestamps.object.js";
import commonFields from "../../common/commonFields.object.js";
const billsAllocationSchema = new Schema(
  {
    name: { type: String, trim: true },
    bill_type: { type: String },
    tds_deductee_is_special_rate: { type: Boolean, default: false },
    amount: { type: Number }
  },
  { _id: false, timestamps: timeStampObj },
);
const LedgerEntrySchema = new Schema(
  {
    voucher_id: { type: Schema.Types.ObjectId, ref: "Voucher" ,required:true},
    company_id: { type: Schema.Types.ObjectId, ref: "Company", required: true },
    ledger_id: { type: Schema.Types.ObjectId, ref: "Ledger" ,default:null},
    amount: { type: Number },
    ledger_guid: { type: String, default: null },
    is_deemed_positive: { type: Boolean, default: false },
    entry_type: { type: String, enum: ["DEBIT", "CREDIT"], trim: true },
    is_party_ledger: { type: Boolean, default: false },
    bills_allocation: { type: [billsAllocationSchema], default: [] },
    ...commonFields
  },
  { timestamps: timeStampObj },
);
LedgerEntrySchema.index({ voucher_id: 1, company_id: 1 });
LedgerEntrySchema.index({ ledger_id: 1 });
LedgerEntrySchema.index({ company_id: 1, ledger_guid: 1 });

const LedgerEntry = model("LedgerEntry", LedgerEntrySchema);
export default LedgerEntry;
