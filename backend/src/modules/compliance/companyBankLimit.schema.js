import mongoose from "mongoose";

const monthlyBreakdownSchema = new mongoose.Schema({
  monthKey: { type: String, required: true },
  amount: { type: Number, default: 0 },
  datePaid: { type: Date, default: null },
});

const companyBankLimitSchema = new mongoose.Schema(
  {
    company_id: { type: String, required: true, index: true },
    tenant_id: { type: String, default: null, index: true },
    bankName: { type: String, required: true, trim: true },
    cardNumber: { type: String, default: "", trim: true },
    userName: { type: String, required: true, trim: true },
    dateOfJoining: { type: Date, default: null },
    yearlyLimit: { type: Number, default: 0 },
    usedLimit: { type: Number, default: 0 },
    balanceLimit: { type: Number, default: 0 },
    monthlyBillingDueDate: { type: Date, default: null },
    monthlyBillingStatus: {
      type: String,
      enum: ["Pending", "Paid"],
      default: "Pending",
    },
    cardStatus: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active",
    },
    monthlyBreakdown: [monthlyBreakdownSchema],
  },
  {
    timestamps: true,
  }
);

companyBankLimitSchema.set("toJSON", {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    return ret;
  },
});

const CompanyBankLimit = mongoose.model(
  "CompanyBankLimit",
  companyBankLimitSchema
);

export default CompanyBankLimit;
