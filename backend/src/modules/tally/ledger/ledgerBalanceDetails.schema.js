import {Schema , model} from "mongoose";

const ledgerBalanceSchema = new Schema(
  {
    company_id: { type: Schema.Types.ObjectId, ref: "Company", required: true },
    ledger_id: { type: Schema.Types.ObjectId, ref: "Ledger" ,required:true},
    from_date: {
      type: Date,
      default: null,
    },
    to_date: {
      type: Date,
      default: null,
    },
    opening_balance: {
      type: Number,
      default: 0,
    },
    closing_balance: {
      type: Number,
      default: 0,
    },
    is_deemed_positive: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false },
);
const LedgerBalanceDetails=model("LedgerBalanceDetails",ledgerBalanceSchema);
export default LedgerBalanceDetails;