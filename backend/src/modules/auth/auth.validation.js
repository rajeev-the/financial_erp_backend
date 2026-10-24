import { ApiError } from '../../utils/api-error.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSendOtp(req, _res, next) {
  const raw = req.body?.email ?? req.body?.identifier ?? '';
  const email = String(raw).trim().toLowerCase();

  if (!email) {
    return next(ApiError.badRequest('Email is required'));
  }

  if (!EMAIL_PATTERN.test(email) || email.length > 255) {
    return next(ApiError.badRequest('Please enter a valid email address'));
  }

  req.body.email = email;

  return next();
}

export function validateVerifyOtp(req, _res, next) {
  const rawEmail = req.body?.email ?? req.body?.identifier ?? '';
  const email = String(rawEmail).trim().toLowerCase();
  const otp = String(req.body?.otp ?? '').trim();

  if (!email || !EMAIL_PATTERN.test(email)) {
    return next(ApiError.badRequest('Please enter a valid email address'));
  }

  if (!/^\d{4,8}$/.test(otp)) {
    return next(ApiError.badRequest('Please enter the numeric code from your email'));
  }

  req.body.email = email;
  req.body.otp = otp;

  return next();
}
