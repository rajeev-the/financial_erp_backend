import crypto from "crypto";

import { env } from "../config/env.js";

/**
 * A numeric code of `env.otp.length` digits, drawn from the CSPRNG.
 *
 * `randomInt` is used per digit rather than `Math.random()` scaled to a range:
 * it is uniform and unpredictable, and a 6-digit code guessed at 1-in-a-million
 * is only safe if the attacker cannot narrow the space.
 */
export function generateOtp(length = env.otp.length) {
  let code = "";

  for (let index = 0; index < length; index += 1) {
    code += crypto.randomInt(0, 10).toString();
  }

  return code;
}

/**
 * Peppered SHA-256.
 *
 * bcrypt would be the reflex, but it is the wrong tool here: the search space is
 * 10^6 and the code lives for ten minutes, so a slow hash buys nothing an
 * attempt-counter does not already give. The pepper (`OTP_SECRET`, held outside
 * the database) is what makes a dumped `auth_otp` table useless.
 */
export function hashOtp(code) {
  const secretKey =
    env?.otp?.secret ||
    process.env.OTP_SECRET ||
    "tally_bridge_otp_secret_key_default";
  return crypto
    .createHmac("sha256", secretKey)
    .update(String(code))
    .digest("hex");
}

/** Constant-time compare, so response timing does not leak a digit at a time. */
export function otpMatches(code, storedHash) {
  const candidate = Buffer.from(hashOtp(code), "utf8");
  const expected = Buffer.from(String(storedHash), "utf8");

  if (candidate.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(candidate, expected);
}
