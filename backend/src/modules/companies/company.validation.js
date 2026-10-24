import Joi from "joi";
import mongoose from "mongoose";
import { ApiError } from "../../utils/api-error.js";

const objectIdCustom = (value, helpers) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    return helpers.error("any.invalid");
  }
  return value;
};

const createCompanySchema = Joi.object({
  tenant_id: Joi.string().custom(objectIdCustom).required().messages({
    "any.required": "tenant_id is required",
    "any.invalid": "Invalid tenant_id format. Must be a 24-character ObjectId.",
  }),
  name: Joi.string().optional().allow(null, ""),
  address: Joi.string().optional().allow(null, ""),
  state: Joi.string().optional().allow(null, ""),
  country: Joi.string().optional().allow(null, ""),
  tally_company_name: Joi.string().optional().allow(null, ""),
  tally_company_guid: Joi.string().optional().allow(null, ""),
  last_voucher_date: Joi.date().optional().allow(null, ""),
  statistics: Joi.array()
    .items(
      Joi.object({
        name: Joi.string().optional().allow(null, ""),
        direct: Joi.string().optional().allow(null, ""),
        cancelled: Joi.string().optional().allow(null, ""),
      }).unknown(true),
    )
    .optional(),
})
  .or("name", "tally_company_name")
  .messages({
    "object.missing": "Please provide either name or tally_company_name",
  })
  .unknown(true);

export const validateCreateCompany = (req, res, next) => {
  const { error } = createCompanySchema.validate(req.body, {
    abortEarly: false,
  });
  if (error) {
    return next(ApiError.badRequest(error.details[0].message));
  }
  next();
};

const updateCompanySchema = Joi.object({
  name: Joi.string().optional().allow(null, ""),
  email: Joi.string().email().optional().allow(null, ""),
  phone: Joi.string().optional().allow(null, ""),
  tally_company_name: Joi.string().optional().allow(null, ""),
  tally_company_guid: Joi.string().optional().allow(null, ""),
  financial_year_from: Joi.date().optional().allow(null),
  financial_year_to: Joi.date().optional().allow(null),
  books_begin_from: Joi.date().optional().allow(null),
  last_voucher_date: Joi.date().optional().allow(null),
  gst_number: Joi.string().optional().allow(null, ""),
  gst_registration_type: Joi.string().optional().allow(null, ""),
  pan_number: Joi.string().optional().allow(null, ""),
  address: Joi.string().optional().allow(null, ""),
  state: Joi.string().optional().allow(null, ""),
  country: Joi.string().optional().allow(null, ""),
  base_currency: Joi.string().optional(),
  statistics: Joi.array()
    .items(
      Joi.object({
        name: Joi.string().optional().allow(null, ""),
        direct: Joi.string().optional().allow(null, ""),
        cancelled: Joi.string().optional().allow(null, ""),
      }).unknown(true),
    )
    .optional(),
  sync_enabled: Joi.boolean().optional(),
  is_interval_sync: Joi.boolean().optional(),
  sync_interval_minutes: Joi.number().min(5).optional(),
  sync_time: Joi.date().optional().allow(null),
  tally_host: Joi.string().optional().allow(null, ""),
  tally_port: Joi.number().optional().allow(null),
}).unknown(true);

export const validateUpdateCompany = (req, res, next) => {
  const { error } = updateCompanySchema.validate(req.body, {
    abortEarly: false,
  });
  if (error) {
    return next(ApiError.badRequest(error.details[0].message));
  }
  next();
};

const queryParamsSchema = Joi.object({
  tenant_id: Joi.string().custom(objectIdCustom).messages({
    "any.invalid": "Invalid tenant_id format",
  }),
  tenantId: Joi.string().custom(objectIdCustom).messages({
    "any.invalid": "Invalid tenant_id format",
  }),
  id: Joi.string().custom(objectIdCustom).messages({
    "any.invalid": "Invalid company ID format",
  }),
  userId: Joi.string().custom(objectIdCustom).messages({
    "any.invalid": "Invalid user_id format",
  }),
}).unknown(true);

export const validateCompanyParams = (req, res, next) => {
  const { error: queryError } = queryParamsSchema.validate(req.query, {
    abortEarly: false,
  });
  if (queryError) {
    return next(ApiError.badRequest(queryError.details[0].message));
  }

  const { error: paramsError } = queryParamsSchema.validate(req.params, {
    abortEarly: false,
  });
  if (paramsError) {
    return next(ApiError.badRequest(paramsError.details[0].message));
  }

  next();
};
