import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { authenticate } from "../../middleware/authenticate.js";
import {
  handleLogout,
  handleMe,
  handleRefresh,
  handleSendOtp,
  handleVerifyOtp,
} from "./auth.controller.js";
import { validateSendOtp, validateVerifyOtp } from "./auth.validation.js";

const authRouter = Router();

authRouter.post("/request-otp", validateSendOtp, asyncHandler(handleSendOtp));
authRouter.post(
  "/verify-otp",
  validateVerifyOtp,
  asyncHandler(handleVerifyOtp),
);

authRouter.post("/refresh", asyncHandler(handleRefresh));
authRouter.post("/logout", asyncHandler(handleLogout));
authRouter.get("/me", authenticate, asyncHandler(handleMe));

export default authRouter;
