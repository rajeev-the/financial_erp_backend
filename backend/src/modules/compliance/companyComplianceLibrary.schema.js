import mongoose from "mongoose";

const companyComplianceLibrarySchema = new mongoose.Schema(
  {
    slotKey: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    fileName: { type: String, default: "" },
    filePath: { type: String, default: "" },
    isUploaded: { type: Boolean, default: false },
    uploadedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

companyComplianceLibrarySchema.set("toJSON", {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    return ret;
  },
});

const CompanyComplianceLibrary = mongoose.model(
  "CompanyComplianceLibrary",
  companyComplianceLibrarySchema
);

export default CompanyComplianceLibrary;
