import crypto from "crypto";

import jwt from "jsonwebtoken";

import { env } from "../config/env.js";

export function signAccessToken(user) {
  const userId = String(user._id || user.id);
  return jwt.sign(
    {
      id: userId,
      email: user.email,
    },
    env.jwt.accessSecret,
    { expiresIn: env.jwt.accessTtl },
  );
}

export function signRefreshToken(user) {
  const tokenId = crypto.randomUUID();
  const userId = String(user._id || user.id);

  const token = jwt.sign(
    { sub: userId, userId: userId, jti: tokenId },
    env.jwt.refreshSecret,
    {
      expiresIn: `${env.jwt.refreshTtlDays}d`,
    },
  );

  return { token, tokenId };
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwt.refreshSecret);
}

/** Refresh tokens are stored hashed, so a database dump cannot be replayed. */
export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Cookie flags shared by both tokens; `sameSite: 'none'` needs HTTPS in prod. */
function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: env.isProduction ? "none" : "lax",
    path: "/",
    maxAge: maxAgeMs,
  };
}

export const ACCESS_COOKIE = "tb_access_token";
export const REFRESH_COOKIE = "tb_refresh_token";

export function setAuthCookies(res, { accessToken, refreshToken }) {
  res.cookie(ACCESS_COOKIE, accessToken, cookieOptions(15 * 60 * 1000));
  res.cookie(
    REFRESH_COOKIE,
    refreshToken,
    cookieOptions(env.jwt.refreshTtlDays * 24 * 60 * 60 * 1000),
  );
}

export function clearAuthCookies(res) {
  const options = { ...cookieOptions(0) };
  delete options.maxAge;

  res.clearCookie(ACCESS_COOKIE, options);
  res.clearCookie(REFRESH_COOKIE, options);
}
