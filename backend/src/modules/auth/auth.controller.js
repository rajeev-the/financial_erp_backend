import { ok } from "../../utils/response.js";
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  setAuthCookies,
} from "../../utils/tokens.js";
import {
  getSessionUser,
  logout,
  refreshSession,
  sendOtp,
  verifyOtp,
} from "./auth.service.js";
export const handleSendOtp = async (req, res) => {
  const { email, firstName, lastName, phone } = req.body;

  const result = await sendOtp({
    email,
    firstName: firstName?.trim() || undefined,
    lastName: lastName?.trim() || undefined,
    phone: phone?.trim() || undefined,
    ipAddress: req.ip,
  });

  return ok(
    res,
    null,
    "If that email has an account, a sign-in code has been sent.",
  );
};
export const handleVerifyOtp = async (req, res) => {
  const { email, otp } = req.body;

  const { accessToken, refreshToken, user } = await verifyOtp({
    email,
    otp,
    userAgent: req.headers["user-agent"],
    ipAddress: req.ip,
  });
  setAuthCookies(res, { accessToken, refreshToken });
  return ok(res, { accessToken, refreshToken, user }, "Signed in successfully");
};

export const handleRefresh = async (req, res) => {
  const presented = req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken;

  const { accessToken, refreshToken, user } = await refreshSession(presented, {
    userAgent: req.headers["user-agent"],
    ipAddress: req.ip,
  });

  setAuthCookies(res, { accessToken, refreshToken });

  return ok(res, { accessToken, refreshToken, user }, "Session refreshed");
};

export const handleLogout = async (req, res) => {
  await logout(req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken);
  clearAuthCookies(res);

  return ok(res, null, "Signed out");
};

export const handleMe = async (req, res) => {
  const { id } = req.user;
  const user = await getSessionUser(id);
  return ok(res, { user });
};
