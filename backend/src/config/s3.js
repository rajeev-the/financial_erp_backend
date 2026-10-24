import { S3Client } from "@aws-sdk/client-s3";

export const s3Client = new S3Client({
  region: process.env.AWS_REGION || "ap-south-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

export const getS3BucketName = () => {
  return process.env.S3_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME || "tally-connector-dev-document-bucket";
};

/**
 * Sanitize voucher number for safe S3 key naming.
 * Replaces forward/backward slashes and unwanted characters with underscores.
 * e.g. "INV/2024-25/001" -> "INV_2024-25_001"
 */
export const sanitizeVoucherNumberForS3Key = (voucherNumber) => {
  if (!voucherNumber) return "voucher";
  return String(voucherNumber)
    .trim()
    .replace(/[\/\\]/g, "_")
    .replace(/[\s]+/g, "_");
};

/**
 * Builds deterministic S3 key:
 * <companyId>/<voucherNumber>.<ext>
 */
export const buildVoucherS3Key = (companyId, voucherNumber, extension = "pdf") => {
  const compIdStr = String(companyId).trim();
  const sanitizedVch = sanitizeVoucherNumberForS3Key(voucherNumber);
  const cleanExt = String(extension || "pdf").replace(/^\./, "").toLowerCase();
  return `${compIdStr}/${sanitizedVch}.${cleanExt}`;
};

export default {
  s3Client,
  getS3BucketName,
  sanitizeVoucherNumberForS3Key,
  buildVoucherS3Key,
};
