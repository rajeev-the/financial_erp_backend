import mongoose from "mongoose";
import timeStampObj from "../../common/timestamps.object.js";
import commonFields from "../../common/commonFields.object.js";

const voucherTypeSchema = new mongoose.Schema(
  {
    company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    name: { type: String },
    guid: { type: String, required: true },
    parent: { type: String, default: null },
    synced_at: { type: Date, default: null },
    ...commonFields,
  },
  {
    timestamps: timeStampObj,
  },
);

const VoucherType = mongoose.model("VoucherType", voucherTypeSchema);
export default VoucherType;
