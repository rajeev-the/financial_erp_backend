import { Router } from "express";
import { asyncHandler } from "../../utils/response.js";
import {
  getCompanyCompliances,
  createCompanyCompliance,
  updateCompanyCompliance,
  importCompanyCompliances,
  deleteCompanyCompliance,
  deleteAllCompanyCompliances,
  deleteCompanyComplianceAttachment,
  getCompanyComplianceUploadUrl,
  uploadComplianceFile,
  getCompanyComplianceDocumentPreviewUrl,
  serveComplianceFile,
  getCompanyComplianceLibraryDocuments,
  saveCompanyComplianceLibraryDocument,
} from "./companyCompliance.controller.js";

import {
  getCompanyBankLimits,
  createCompanyBankLimit,
  updateCompanyBankLimit,
  deleteCompanyBankLimit,
  deleteAllCompanyBankLimits,
} from "./companyBankLimit.controller.js";

const complianceRouter = Router();

// ---- Company Compliances Routes ----
complianceRouter.get(
  "/company-compliances",
  asyncHandler(getCompanyCompliances)
);
complianceRouter.post(
  "/company-compliances",
  asyncHandler(createCompanyCompliance)
);
complianceRouter.put(
  "/company-compliances",
  asyncHandler(updateCompanyCompliance)
);
complianceRouter.post(
  "/company-compliances/import",
  asyncHandler(importCompanyCompliances)
);
complianceRouter.delete(
  "/company-compliances/all",
  asyncHandler(deleteAllCompanyCompliances)
);
complianceRouter.delete(
  "/company-compliances",
  asyncHandler(deleteCompanyCompliance)
);
complianceRouter.post(
  "/company-compliances/upload-url",
  asyncHandler(getCompanyComplianceUploadUrl)
);
complianceRouter.put(
  "/company-compliances/upload-file",
  uploadComplianceFile
);
complianceRouter.get(
  "/company-compliances/document-preview-url",
  asyncHandler(getCompanyComplianceDocumentPreviewUrl)
);
complianceRouter.get(
  "/company-compliances/file",
  serveComplianceFile
);
complianceRouter.delete(
  "/company-compliances/attachment",
  asyncHandler(deleteCompanyComplianceAttachment)
);
complianceRouter.get(
  "/company-compliances/library-documents",
  asyncHandler(getCompanyComplianceLibraryDocuments)
);
complianceRouter.post(
  "/company-compliances/library-documents/upload-url",
  asyncHandler(getCompanyComplianceUploadUrl)
);
complianceRouter.post(
  "/company-compliances/library-documents",
  asyncHandler(saveCompanyComplianceLibraryDocument)
);

// ---- Company Bank Limits Routes ----
complianceRouter.get(
  "/company-bank-limits",
  asyncHandler(getCompanyBankLimits)
);
complianceRouter.post(
  "/company-bank-limits",
  asyncHandler(createCompanyBankLimit)
);
complianceRouter.put(
  "/company-bank-limits",
  asyncHandler(updateCompanyBankLimit)
);
complianceRouter.delete(
  "/company-bank-limits/all",
  asyncHandler(deleteAllCompanyBankLimits)
);
complianceRouter.delete(
  "/company-bank-limits",
  asyncHandler(deleteCompanyBankLimit)
);

export default complianceRouter;
