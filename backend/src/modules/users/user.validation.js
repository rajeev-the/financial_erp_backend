import Joi from "joi";
import mongoose from "mongoose";
import { ApiError } from "../../utils/api-error.js";
import regexValidation from "../common/regexValidation.js";

const objectIdCustom = (value, helpers) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    return helpers.error("any.invalid");
  }
  return value;
};

const createUserByAdminSchema = Joi.object({
  first_name: Joi.string().trim().required().messages({
    "any.required": "First name is required",
    "string.empty": "First name cannot be empty",
  }),
  last_name: Joi.string().trim().required().messages({
    "any.required": "Last name is required",
    "string.empty": "Last name cannot be empty",
  }),
  email: Joi.string().trim().regex(regexValidation.EMAIL).required().messages({
    "any.required": "Email is required",
    "string.empty": "Email cannot be empty",
    "string.pattern.base": "Please enter a valid email address",
  }),
  tenant_id: Joi.string().custom(objectIdCustom).required().messages({
    "any.required": "tenant_id is required",
    "any.invalid": "Invalid tenant_id format. Must be a 24-character ObjectId.",
  }),
  company_id: Joi.string().custom(objectIdCustom).required().messages({
    "any.required": "company_id is required",
    "any.invalid":
      "Invalid company_id format. Must be a 24-character ObjectId.",
  }),
  tenant_role_id: Joi.string()
    .custom(objectIdCustom)
    .optional()
    .allow(null, "")
    .messages({
      "any.invalid":
        "Invalid tenant_role_id format. Must be a 24-character ObjectId.",
    }),
  company_role_id: Joi.string()
    .custom(objectIdCustom)
    .optional()
    .allow(null, "")
    .messages({
      "any.invalid":
        "Invalid company_role_id format. Must be a 24-character ObjectId.",
    }),
}).unknown(true);

export const validateCreateUserByAdmin = (req, res, next) => {
  const { error } = createUserByAdminSchema.validate(req.body, {
    abortEarly: false,
  });
  if (error) {
    return next(ApiError.badRequest(error.details[0].message));
  }
  next();
};

const userSignUpSchema = Joi.object({
  userFirstName: Joi.string().trim().optional().allow(null, ""),
  userLastName: Joi.string().trim().optional().allow(null, ""),
  userEmail: Joi.string()
    .trim()
    .regex(regexValidation.EMAIL)
    .required()
    .messages({
      "any.required": "Missing required user fields",
      "string.empty": "Missing required user fields",
      "string.pattern.base": "Invalid user email",
    }),
  tenantName: Joi.string().trim().required().messages({
    "any.required": "Missing required tenant fields",
    "string.empty": "Missing required tenant fields",
  }),
  tenantEmail: Joi.string()
    .trim()
    .regex(regexValidation.EMAIL)
    .optional()
    .allow(null, ""),
  tenantPhone: Joi.string().trim().optional().allow(null, ""),
  gstin: Joi.string().trim().optional().allow(null, ""),
  pan: Joi.string().trim().optional().allow(null, ""),
  address: Joi.string().trim().optional().allow(null, ""),
  state: Joi.string().trim().optional().allow(null, ""),
  country: Joi.string().trim().optional().allow(null, ""),
}).unknown(true);

export const validateUserSignUp = (req, res, next) => {
  const { error } = userSignUpSchema.validate(req.body, {
    abortEarly: false,
  });
  if (error) {
    return next(ApiError.badRequest(error.details[0].message));
  }
  next();
};
