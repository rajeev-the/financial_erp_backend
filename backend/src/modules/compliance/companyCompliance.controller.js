import fs from "fs";
import path from "path";
import CompanyCompliance from "./companyCompliance.schema.js";
import CompanyComplianceLibrary from "./companyComplianceLibrary.schema.js";

const DEFAULT_LIBRARY_DOCS = [
  { slotKey: "gstr1_guide", title: "GSTR-1 Guidelines", isUploaded: false },
  { slotKey: "gstr3b_guide", title: "GSTR-3B Instructions", isUploaded: false },
  { slotKey: "tds_26q_guide", title: "TDS Form 26Q Reference", isUploaded: false },
  { slotKey: "pf_guide", title: "EPF Compliance Manual", isUploaded: false },
  { slotKey: "esic_guide", title: "ESIC Filing Handbook", isUploaded: false },
];

const ensureUploadDir = (targetPath) => {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

export const getCompanyCompliances = async (req, res) => {
  const companyId =
    req.query.company_id ||
    req.query.companyId ||
    req.query.company_uuid ||
    req.body?.company_id ||
    req.body?.companyId;

  const query = companyId ? { company_id: String(companyId) } : {};
  const compliances = await CompanyCompliance.find(query).sort({
    dueDate: 1,
    createdAt: -1,
  });

  return res.status(200).json({
    success: true,
    data: compliances.map((doc) => doc.toJSON()),
  });
};

export const createCompanyCompliance = async (req, res) => {
  const companyId =
    req.body.company_id ||
    req.body.companyId ||
    req.query.company_id ||
    req.query.companyId;

  const tenantId = req.body.tenant_id || req.query.tenant_id || null;

  if (!companyId) {
    return res.status(400).json({
      success: false,
      message: "company_id is required",
    });
  }

  const newCompliance = new CompanyCompliance({
    company_id: String(companyId),
    tenant_id: tenantId ? String(tenantId) : null,
    form: req.body.form,
    purpose: req.body.purpose,
    whoShouldFile: req.body.whoShouldFile || "",
    dueDateText: req.body.dueDateText || "",
    dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
    status: req.body.status || "Pending",
    attachments: req.body.attachments || [],
  });

  await newCompliance.save();

  return res.status(201).json({
    success: true,
    message: "Company compliance created successfully",
    data: newCompliance.toJSON(),
  });
};

export const updateCompanyCompliance = async (req, res) => {
  const id = req.body.id || req.body._id || req.params.id;

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "Compliance ID is required",
    });
  }

  const updateData = { ...req.body };
  delete updateData.id;
  delete updateData._id;

  if (updateData.dueDate) {
    updateData.dueDate = new Date(updateData.dueDate);
  }

  const updated = await CompanyCompliance.findByIdAndUpdate(id, updateData, {
    new: true,
  });

  if (!updated) {
    return res.status(404).json({
      success: false,
      message: "Compliance record not found",
    });
  }

  return res.status(200).json({
    success: true,
    message: "Company compliance updated successfully",
    data: updated.toJSON(),
  });
};

export const importCompanyCompliances = async (req, res) => {
  const companyId =
    req.body.company_id ||
    req.body.companyId ||
    req.query.company_id ||
    req.query.companyId;

  const tenantId = req.body.tenant_id || req.query.tenant_id || null;
  const { rows = [], replaceExisting = true } = req.body;

  if (!companyId) {
    return res.status(400).json({
      success: false,
      message: "company_id is required",
    });
  }

  if (replaceExisting) {
    await CompanyCompliance.deleteMany({ company_id: String(companyId) });
  }

  const formatted = rows.map((row) => ({
    company_id: String(companyId),
    tenant_id: tenantId ? String(tenantId) : null,
    form: row.form,
    purpose: row.purpose,
    whoShouldFile: row.whoShouldFile || "",
    dueDateText: row.dueDateText || "",
    dueDate: row.dueDate ? new Date(row.dueDate) : null,
    status: row.status || "Pending",
    attachments: row.attachments || [],
  }));

  if (formatted.length > 0) {
    await CompanyCompliance.insertMany(formatted);
  }

  return res.status(200).json({
    success: true,
    message: `${formatted.length} compliances imported successfully`,
    count: formatted.length,
  });
};

export const deleteCompanyCompliance = async (req, res) => {
  const id = req.body.id || req.query.id || req.params.id;

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "Compliance ID is required",
    });
  }

  await CompanyCompliance.findByIdAndDelete(id);

  return res.status(200).json({
    success: true,
    message: "Company compliance deleted successfully",
  });
};

export const deleteAllCompanyCompliances = async (req, res) => {
  const companyId =
    req.body.company_id ||
    req.body.companyId ||
    req.query.company_id ||
    req.query.companyId;

  if (!companyId) {
    return res.status(400).json({
      success: false,
      message: "company_id is required",
    });
  }

  await CompanyCompliance.deleteMany({ company_id: String(companyId) });

  return res.status(200).json({
    success: true,
    message: "All company compliances deleted successfully",
  });
};

export const deleteCompanyComplianceAttachment = async (req, res) => {
  const { attachmentId } = req.body;

  if (!attachmentId) {
    return res.status(400).json({
      success: false,
      message: "attachmentId is required",
    });
  }

  await CompanyCompliance.updateMany(
    { "attachments.id": attachmentId },
    { $pull: { attachments: { id: attachmentId } } }
  );

  return res.status(200).json({
    success: true,
    message: "Attachment deleted successfully",
  });
};

export const getCompanyComplianceUploadUrl = async (req, res) => {
  const fileName = String(req.body.fileName || "document").replace(/[^a-zA-Z0-9.-]/g, "_");
  const sanitizedPath = `uploads/compliances/${Date.now()}-${fileName}`;
  const baseUrl = `${req.protocol}://${req.get("host")}`;

  const signedUrl = `${baseUrl}/api/v1/compliance/company-compliances/upload-file?filePath=${encodeURIComponent(
    sanitizedPath
  )}`;

  return res.status(200).json({
    success: true,
    signedUrl,
    filePath: sanitizedPath,
  });
};

export const uploadComplianceFile = async (req, res) => {
  const filePathParam = req.query.filePath || req.body?.filePath;
  if (!filePathParam) {
    return res.status(400).json({ success: false, message: "filePath is required" });
  }

  const fullPath = path.resolve(process.cwd(), filePathParam);
  ensureUploadDir(fullPath);

  const writeStream = fs.createWriteStream(fullPath);
  req.pipe(writeStream);

  writeStream.on("finish", () => {
    return res.status(200).json({
      success: true,
      message: "File uploaded successfully",
      filePath: filePathParam,
    });
  });

  writeStream.on("error", (err) => {
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to save file",
    });
  });
};

export const getCompanyComplianceDocumentPreviewUrl = async (req, res) => {
  const filePath = req.query.filePath;
  if (!filePath) {
    return res.status(400).json({ success: false, message: "filePath is required" });
  }

  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const signedUrl = `${baseUrl}/api/v1/compliance/company-compliances/file?filePath=${encodeURIComponent(
    filePath
  )}`;

  return res.status(200).json({
    success: true,
    signedUrl,
  });
};

export const serveComplianceFile = async (req, res) => {
  const filePathParam = req.query.filePath;
  if (!filePathParam) {
    return res.status(400).json({ success: false, message: "filePath is required" });
  }

  const fullPath = path.resolve(process.cwd(), filePathParam);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ success: false, message: "File not found" });
  }

  return res.sendFile(fullPath);
};

export const getCompanyComplianceLibraryDocuments = async (req, res) => {
  const savedDocs = await CompanyComplianceLibrary.find({});
  const savedMap = new Map(savedDocs.map((doc) => [doc.slotKey, doc.toJSON()]));

  const merged = DEFAULT_LIBRARY_DOCS.map((defaultDoc) => {
    if (savedMap.has(defaultDoc.slotKey)) {
      return savedMap.get(defaultDoc.slotKey);
    }
    return defaultDoc;
  });

  return res.status(200).json({
    success: true,
    data: merged,
  });
};

export const saveCompanyComplianceLibraryDocument = async (req, res) => {
  const { slotKey, title, fileName, filePath } = req.body;
  if (!slotKey) {
    return res.status(400).json({ success: false, message: "slotKey is required" });
  }

  const doc = await CompanyComplianceLibrary.findOneAndUpdate(
    { slotKey },
    {
      slotKey,
      title: title || slotKey,
      fileName: fileName || "",
      filePath: filePath || "",
      isUploaded: Boolean(filePath),
      uploadedAt: new Date(),
    },
    { upsert: true, new: true }
  );

  return res.status(200).json({
    success: true,
    data: doc.toJSON(),
    message: "Library document saved successfully",
  });
};
