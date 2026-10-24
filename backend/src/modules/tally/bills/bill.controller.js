import mongoose from "mongoose";
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client, getS3BucketName, sanitizeVoucherNumberForS3Key, buildVoucherS3Key } from "../../../config/s3.js";
import VoucherBill from "./voucherBill.schema.js";
import Voucher from "../voucher/voucher.schema.js";
import Company from "../../companies/company.schema.js";
import { ApiError } from "../../../utils/api-error.js";
import { ok } from "../../../utils/response.js";

/**
 * Helper to resolve company ID from raw string or ObjectId
 */
const resolveCompanyId = async (rawId) => {
  if (!rawId) return null;
  if (mongoose.Types.ObjectId.isValid(rawId)) {
    return new mongoose.Types.ObjectId(rawId);
  }
  const comp = await Company.findOne({
    $or: [{ tally_company_guid: rawId }, { name: rawId }],
    is_deleted: { $ne: true },
  }).select("_id");
  return comp ? comp._id : null;
};

/**
 * 1. Generate Presigned S3 Upload URL for a bill matching a voucher number
 * Route: POST /api/v1/tally/bills/upload-url
 */
export const generateUploadUrl = async (req, res, next) => {
  try {
    const rawCompanyId = req.body.companyId || req.body.company_id || req.params.companyId;
    const { voucherNumber, voucher_number, fileName, file_name, fileType, file_type, fileSize, file_size } = req.body;

    const vNo = voucherNumber || voucher_number;
    const fName = fileName || file_name || `${vNo || "voucher"}.pdf`;
    const fType = fileType || file_type || "application/pdf";
    const fSize = Number(fileSize || file_size || 0);

    if (!rawCompanyId) {
      throw ApiError.badRequest("Company ID is required");
    }
    if (!vNo || !String(vNo).trim()) {
      throw ApiError.badRequest("Voucher number is required");
    }

    const resolvedCompanyId = await resolveCompanyId(rawCompanyId);
    if (!resolvedCompanyId) {
      throw ApiError.notFound("Company not found");
    }

    const bucket = getS3BucketName();
    // Extract file extension
    const extMatch = String(fName).match(/\.([0-9a-z]+)$/i);
    const extension = extMatch ? extMatch[1].toLowerCase() : "pdf";

    // Build standard key: <company_id>/<sanitized_voucher_no>.<ext>
    const s3Key = buildVoucherS3Key(resolvedCompanyId, vNo, extension);

    const putCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      ContentType: fType,
    });

    // 15 minutes expiration for upload
    const signedUrl = await getSignedUrl(s3Client, putCommand, {
      expiresIn: 900,
    });

    return ok(
      res,
      {
        signedUrl,
        s3Key,
        bucket,
        voucherNumber: String(vNo).trim(),
        fileName: fName,
        extension,
        contentType: fType,
      },
      "Upload URL generated successfully"
    );
  } catch (error) {
    next(error);
  }
};

/**
 * 2. Confirm Upload & Save Metadata in DB
 * Route: POST /api/v1/tally/bills/confirm-upload
 */
export const confirmUpload = async (req, res, next) => {
  try {
    const rawCompanyId = req.body.companyId || req.body.company_id;
    const { voucherNumber, voucher_number, s3Key, s3_key, fileName, file_name, fileSize, file_size, mimeType, mime_type } = req.body;

    const vNo = voucherNumber || voucher_number;
    const key = s3Key || s3_key;
    const fName = fileName || file_name;

    if (!rawCompanyId || !vNo || !key) {
      throw ApiError.badRequest("companyId, voucherNumber, and s3Key are required");
    }

    const resolvedCompanyId = await resolveCompanyId(rawCompanyId);
    if (!resolvedCompanyId) {
      throw ApiError.notFound("Company not found");
    }

    // Try finding the voucher document
    const voucherDoc = await Voucher.findOne({
      company_id: resolvedCompanyId,
      voucher_number: String(vNo).trim(),
      is_deleted: { $ne: true },
    }).select("_id");

    const extMatch = String(fName || key).match(/\.([0-9a-z]+)$/i);
    const extension = extMatch ? extMatch[1].toLowerCase() : "pdf";
    const bucket = getS3BucketName();

    const billRecord = await VoucherBill.findOneAndUpdate(
      {
        company_id: resolvedCompanyId,
        voucher_number: String(vNo).trim(),
      },
      {
        company_id: resolvedCompanyId,
        voucher_number: String(vNo).trim(),
        voucher_id: voucherDoc ? voucherDoc._id : null,
        s3_key: key,
        s3_bucket: bucket,
        file_name: fName || `${vNo}.${extension}`,
        file_size: Number(fileSize || file_size || 0),
        mime_type: mimeType || mime_type || "application/pdf",
        extension,
        uploaded_at: new Date(),
        is_deleted: false,
      },
      { upsert: true, new: true }
    );

    return ok(
      res,
      billRecord,
      "Bill successfully attached to voucher"
    );
  } catch (error) {
    next(error);
  }
};

/**
 * 3. Get Presigned View / Download URL for a voucher's bill
 * Route: GET /api/v1/tally/bills/:companyId/view/:voucherNumber
 */
export const getBillViewUrl = async (req, res, next) => {
  try {
    const { companyId, voucherNumber } = req.params;

    if (!companyId || !voucherNumber) {
      throw ApiError.badRequest("companyId and voucherNumber are required");
    }

    const resolvedCompanyId = await resolveCompanyId(companyId);
    if (!resolvedCompanyId) {
      throw ApiError.notFound("Company not found");
    }

    const vNo = String(voucherNumber).trim();
    const bill = await VoucherBill.findOne({
      company_id: resolvedCompanyId,
      voucher_number: vNo,
      is_deleted: { $ne: true },
    }).lean();

    const bucket = bill?.s3_bucket || getS3BucketName();
    const s3Key = bill?.s3_key || buildVoucherS3Key(resolvedCompanyId, vNo, "pdf");

    const getCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: s3Key,
    });

    const signedUrl = await getSignedUrl(s3Client, getCommand, {
      expiresIn: 3600, // 1 hour expiration
    });

    return ok(
      res,
      {
        signedUrl,
        voucherNumber: vNo,
        fileName: bill?.file_name || `${vNo}.${bill?.extension || "pdf"}`,
        fileSize: bill?.file_size || 0,
        mimeType: bill?.mime_type || "application/pdf",
        s3Key,
        uploadedAt: bill?.uploaded_at || null,
      },
      "Bill view URL generated successfully"
    );
  } catch (error) {
    next(error);
  }
};

/**
 * 4. Batch query to check which vouchers have bills attached
 * Route: POST /api/v1/tally/bills/:companyId/batch-status
 */
export const getBillStatusBatch = async (req, res, next) => {
  try {
    const rawCompanyId = req.params.companyId || req.body.companyId;
    const voucherNumbers = Array.isArray(req.body.voucherNumbers)
      ? req.body.voucherNumbers
      : (Array.isArray(req.body.voucher_numbers) ? req.body.voucher_numbers : []);

    if (!rawCompanyId) {
      throw ApiError.badRequest("companyId is required");
    }

    const resolvedCompanyId = await resolveCompanyId(rawCompanyId);
    if (!resolvedCompanyId) {
      throw ApiError.notFound("Company not found");
    }

    if (!voucherNumbers || voucherNumbers.length === 0) {
      return ok(res, {}, "No voucher numbers provided");
    }

    const cleanVNos = voucherNumbers.map((v) => String(v || "").trim()).filter(Boolean);

    const bills = await VoucherBill.find({
      company_id: resolvedCompanyId,
      voucher_number: { $in: cleanVNos },
      is_deleted: { $ne: true },
    }).lean();

    const statusMap = {};
    for (const b of bills) {
      statusMap[b.voucher_number] = {
        hasBill: true,
        fileName: b.file_name,
        fileSize: b.file_size,
        mimeType: b.mime_type,
        extension: b.extension,
        s3Key: b.s3_key,
        uploadedAt: b.uploaded_at,
      };
    }

    return ok(res, statusMap, "Batch bill status retrieved successfully");
  } catch (error) {
    next(error);
  }
};

/**
 * 5. Detach / Delete Bill
 * Route: DELETE /api/v1/tally/bills/:companyId/:voucherNumber
 */
export const deleteBill = async (req, res, next) => {
  try {
    const { companyId, voucherNumber } = req.params;

    if (!companyId || !voucherNumber) {
      throw ApiError.badRequest("companyId and voucherNumber are required");
    }

    const resolvedCompanyId = await resolveCompanyId(companyId);
    if (!resolvedCompanyId) {
      throw ApiError.notFound("Company not found");
    }

    const vNo = String(voucherNumber).trim();
    const bill = await VoucherBill.findOne({
      company_id: resolvedCompanyId,
      voucher_number: vNo,
      is_deleted: { $ne: true },
    });

    if (!bill) {
      throw ApiError.notFound("No active bill found for this voucher");
    }

    // Attempt to delete from S3 (safely caught if IAM policy does not grant DeleteObject)
    try {
      const delCmd = new DeleteObjectCommand({
        Bucket: bill.s3_bucket || getS3BucketName(),
        Key: bill.s3_key,
      });
      await s3Client.send(delCmd);
    } catch (s3Err) {
      console.warn("S3 DeleteObject warning (soft delete used):", s3Err.message);
    }

    // Soft delete in database
    bill.is_deleted = true;
    await bill.save();

    return ok(res, null, "Bill detached successfully");
  } catch (error) {
    next(error);
  }
};

export default {
  generateUploadUrl,
  confirmUpload,
  getBillViewUrl,
  getBillStatusBatch,
  deleteBill,
};
