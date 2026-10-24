import mongoose from "mongoose";

const attachmentSchema = new mongoose.Schema({
  id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
  fileName: { type: String, required: true },
  filePath: { type: String, required: true },
  fileUrl: { type: String, default: "" },
  uploadedAt: { type: Date, default: Date.now },
  documentType: { type: String, default: "company_compliance_attachment" },
});

const companyComplianceSchema = new mongoose.Schema(
  {
    company_id: { type: String, required: true, index: true },
    tenant_id: { type: String, default: null, index: true },
    form: { type: String, required: true, trim: true },
    purpose: { type: String, required: true, trim: true },
    whoShouldFile: { type: String, default: "", trim: true },
    dueDateText: { type: String, default: "", trim: true },
    dueDate: { type: Date, default: null },
    status: {
      type: String,
      enum: ["Pending", "In Progress", "Completed"],
      default: "Pending",
    },
    attachments: [attachmentSchema],
  },
  {
    timestamps: true,
  }
);

companyComplianceSchema.set("toJSON", {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    return ret;
  },
});

const CompanyCompliance = mongoose.model(
  "CompanyCompliance",
  companyComplianceSchema
);

export default CompanyCompliance;
