import {Schema ,model} from "mongoose";
import timeStampObj from "../../common/timestamps.object.js";
import commonFields from "../../common/commonFields.object.js";
const InventoryEntrySchema = new Schema(
    {
        voucher_id: { type: Schema.Types.ObjectId, ref: "Voucher" ,required:true},
        company_id: { type: Schema.Types.ObjectId, ref: "Company", required: true },
        stock_item_name: { type: String, trim: true ,required:true},
        quantity: { type: String, trim: true },
        rate: { type: String, trim: true },
        unit_name: { type: String, trim: true },
        amount: { type: Number },
        discount_amount: { type: Number, default: null },
        discount_percentage: { type: Number, default: null },
        godown_name: { type: String, trim: true },
        batch_name: { type: String, trim: true },
        expiry_date: { type: Date, default: null },
        manufacturing_date: { type: Date, default: null },
        hsn_code: { type: String, trim: true },
        gst_rate: { type: Number, default: null },
        accounting_ledger_name: { type: String, trim: true },
        accounting_ledger_id:{type:Schema.Types.ObjectId,ref:"Ledger"},
        accounting_amount: { type: Number, default: null },
        accounting_isdeemedpositive: { type: Boolean, default: false },
        ...commonFields
    },
    {timestamps: timeStampObj }
);
InventoryEntrySchema.index({ voucher_id: 1, company_id: 1 });
InventoryEntrySchema.index({ accounting_ledger_id: 1 });

const InventoryEntry=model("InventoryEntry",InventoryEntrySchema);
export default InventoryEntry;