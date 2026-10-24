import { Schema, model } from "mongoose";

/**
 * Standard Voucher Number Prefixes
 */
export const VOUCHER_PREFIXES = {
  SALES: "INV",
  PURCHASE: "PUR",
  CREDIT_NOTE: "CN",
  DEBIT_NOTE: "DN",
  RECEIPT: "RCT",
  PAYMENT: "PAY",
  CONTRA: "CTR",
  JOURNAL: "JV",
};

const sequenceSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    financialYear: {
      type: String, // e.g. "2026-27"
      required: true,
    },
    voucherType: {
      type: String,
      required: true,
      enum: Object.keys(VOUCHER_PREFIXES),
    },
    series: {
      type: String,
      default: "MAIN", // "MAIN" or custom series like "A"
      trim: true,
    },
    currentNumber: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    collection: "sequences",
  }
);

sequenceSchema.index(
  { companyId: 1, financialYear: 1, voucherType: 1, series: 1 },
  { unique: true }
);

/**
 * Helper to fetch the next gapless voucher number inside an active session.
 * Format: [series]PREFIX/FY/0001 (e.g. "INV/26-27/0001" or "AINV/26-27/0001")
 * Maximum 16 characters (GST Legal Limit)
 */
sequenceSchema.statics.getNextNumber = async function ({
  companyId,
  financialYear,
  voucherType,
  series = "MAIN",
  session,
}) {
  const shortFy = financialYear.includes("-")
    ? financialYear.split("-").map((p) => p.slice(-2)).join("-")
    : financialYear;

  const prefix = VOUCHER_PREFIXES[voucherType] || "VCH";
  const seriesPrefix = series === "MAIN" ? "" : series;

  const seq = await this.findOneAndUpdate(
    { companyId, financialYear, voucherType, series },
    { $inc: { currentNumber: 1 } },
    { returnDocument: "after", upsert: true, session }
  );

  const numStr = seq.currentNumber.toString().padStart(4, "0");
  const voucherNumber = `${seriesPrefix}${prefix}/${shortFy}/${numStr}`;

  if (voucherNumber.length > 16) {
    throw new Error(
      `Generated voucher number '${voucherNumber}' exceeds the 16 character GST limit`
    );
  }

  return {
    voucherNumber,
    currentNumber: seq.currentNumber,
  };
};

const Sequence = model("Sequence", sequenceSchema);
export default Sequence;
