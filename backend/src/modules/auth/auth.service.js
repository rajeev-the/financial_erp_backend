import { env } from "../../config/env.js";
import User from "../users/user.schema.js";
import AuthOtp from "./authOtp.schema.js";
import RefreshToken from "./refreshToken.schema.js";
import { ApiError } from "../../utils/api-error.js";
import { sendOtpEmail } from "../../utils/mailer.js";
import { generateOtp, hashOtp, otpMatches } from "../../utils/otp.js";
import {
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../utils/tokens.js";
import fieldExclusions from "../common/fieldExclusions.js";

const OTP_PURPOSE = "LOGIN";
const REFRESH_REPLAY_GRACE_SECONDS = 30;

function toPublicUser(user) {
  const userIdStr = (user._id || user.id).toString();
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ");
  const publicUser = {
    id: userIdStr,
    firstName: user.first_name || "",
    lastName: user.last_name || "",
    name: fullName || (user.email ? user.email.split("@")[0] : "User"),
    email: user.email,
    isActive: user.is_active !== false,
  };

  if (user.tenant_memberships && user.tenant_memberships.length > 0) {
    publicUser.tenants = user.tenant_memberships.map((t) => ({
      id: t.tenant_id?._id?.toString() || t.tenant_id?.toString() || "",
      name: t.tenant_id?.name || "Workspace",
      role: t.role ? t.role.name : null,
    }));
  } else if (user.tenants && user.tenants.length > 0) {
    publicUser.tenants = user.tenants.map((t) => ({
      id: t._id?.toString() || t.toString(),
      name: t.name || "Workspace",
      role: "Member",
    }));
  } else {
    publicUser.tenants = [];
  }

  if (user.company_memberships && user.company_memberships.length > 0) {
    publicUser.companies = user.company_memberships.map((c) => ({
      id: c.company_id?._id?.toString() || c.company_id?.toString() || "",
      name: c.company_id?.name || "Company",
      role: c.role ? c.role.name : null,
    }));
  } else if (user.companies && user.companies.length > 0) {
    publicUser.companies = user.companies.map((c) => ({
      id: c._id?.toString() || c.toString(),
      name: c.name || "Company",
      role: "Member",
    }));
  } else {
    publicUser.companies = [];
  }

  return publicUser;
}

export async function sendOtp({ email, ipAddress }) {
  let user = await User.findOne({ email });

  if (!user) {
    throw ApiError.badRequest("User not found. Please check the email.");
  }

  if (user.is_active === false) {
    throw ApiError.forbidden("Account is disabled. Please contact admin.");
  }

  if (env.otp.resendCooldownSeconds > 0) {
    const lastOtp = await AuthOtp.findOne({
      user_id: user._id,
      purpose: OTP_PURPOSE,
      consumed_at: null,
    }).sort({ created_at: -1 });
    if (lastOtp) {
      const sinceLast =
        (Date.now() - new Date(lastOtp.created_at).getTime()) / 1000;
      if (sinceLast < env.otp.resendCooldownSeconds) {
        throw ApiError.tooManyRequests(
          `Please wait ${Math.ceil(env.otp.resendCooldownSeconds - sinceLast)}s before requesting another code.`,
        );
      }
    }
  }

  if (env.otp.rateLimit > 0) {
    const windowStart = new Date(
      Date.now() - env.otp.rateWindowMinutes * 60 * 1000,
    );
    const recentCount = await AuthOtp.countDocuments({
      user_id: user._id,
      purpose: OTP_PURPOSE,
      created_at: { $gte: windowStart },
    });
    if (recentCount >= env.otp.rateLimit) {
      throw ApiError.tooManyRequests(
        `Too many codes requested. Try again in ${env.otp.rateWindowMinutes} minutes.`,
      );
    }
  }

  const code = generateOtp();

  await AuthOtp.updateMany(
    { user_id: user._id, purpose: OTP_PURPOSE, consumed_at: null },
    { $set: { consumed_at: new Date() } },
  );

  await AuthOtp.create({
    user_id: user._id,
    otp_hash: hashOtp(code),
    purpose: OTP_PURPOSE,
    expires_at: new Date(Date.now() + env.otp.ttlMinutes * 60 * 1000),
    ip_address: ipAddress,
  });

  const delivered = await sendOtpEmail(email, code);

  return {
    sent: true,
  };
}

export async function verifyOtp({ email, otp, userAgent, ipAddress }) {
  const invalid = ApiError.badRequest(
    "Invalid or expired code. Please request a new one.",
  );

  const user = await User.findOne({ email })
    .select(fieldExclusions.user)
    .populate({
      path: "tenant_memberships",
      select: "tenant_id role -_id",
      populate: [
        { path: "tenant_id", select: "name" },
        { path: "role", select: "name -_id" },
      ],
    })
    .populate({
      path: "company_memberships",
      select: "company_id role -_id",
      populate: [
        { path: "company_id", select: "name" },
        { path: "role", select: "name -_id" },
      ],
    });
  if (!user || user.is_active === false) {
    throw invalid;
  }

  const record = await AuthOtp.findOne({
    user_id: user._id,
    purpose: OTP_PURPOSE,
    consumed_at: null,
    expires_at: { $gt: new Date() },
  });

  if (!record) {
    throw invalid;
  }

  if (record.attempts >= env.otp.maxAttempts) {
    record.consumed_at = new Date();
    await record.save();
    throw ApiError.tooManyRequests(
      "Too many incorrect attempts. Please request a new code.",
    );
  }

  record.attempts += 1;
  await record.save();

  if (!otpMatches(otp, record.otp_hash)) {
    throw invalid;
  }

  record.consumed_at = new Date();
  await record.save();

  const session = await issueSession(user, { userAgent, ipAddress });
  return { ...session, user: toPublicUser(user) };
}

async function issueSession(user, { userAgent, ipAddress }) {
  const accessToken = signAccessToken(user);
  const { token: refreshToken } = signRefreshToken(user);

  await RefreshToken.create({
    user_id: user._id,
    token_hash: hashToken(refreshToken),
    expires_at: new Date(
      Date.now() + env.jwt.refreshTtlDays * 24 * 60 * 60 * 1000,
    ),
    user_agent: userAgent,
    ip_address: ipAddress,
  });

  return { accessToken, refreshToken };
}

export async function refreshSession(presentedToken, { userAgent, ipAddress }) {
  if (!presentedToken) {
    throw ApiError.unauthorized("No refresh token provided");
  }

  try {
    verifyRefreshToken(presentedToken);
  } catch {
    throw ApiError.unauthorized("Invalid refresh token");
  }

  const stored = await RefreshToken.findOne({
    token_hash: hashToken(presentedToken),
  });

  if (!stored || stored.expires_at < new Date()) {
    throw ApiError.unauthorized("Session expired. Please sign in again.");
  }

  if (stored.revoked_at) {
    const secondsSinceRevoked =
      (Date.now() - new Date(stored.revoked_at).getTime()) / 1000;
    const liveSessions = await RefreshToken.countDocuments({
      user_id: stored.user_id,
      revoked_at: null,
      expires_at: { $gt: new Date() },
    });

    const isRotationRace =
      secondsSinceRevoked <= REFRESH_REPLAY_GRACE_SECONDS && liveSessions > 0;

    if (!isRotationRace) {
      await RefreshToken.updateMany(
        { user_id: stored.user_id },
        { $set: { revoked_at: new Date() } },
      );
      throw ApiError.unauthorized("Session revoked. Please sign in again.");
    }
  }

  const user = await User.findById(stored.user_id)
    .select(fieldExclusions.user)
    .populate({
      path: "tenant_memberships",
      select: "tenant_id role -_id",
      populate: [
        { path: "tenant_id", select: "name" },
        { path: "role", select: "name -_id" },
      ],
    })
    .populate({
      path: "company_memberships",
      select: "company_id role -_id",
      populate: [
        { path: "company_id", select: "name" },
        { path: "role", select: "name -_id" },
      ],
    });
  if (!user || user.is_active === false) {
    throw ApiError.unauthorized("Account is disabled");
  }

  stored.revoked_at = new Date();
  await stored.save();

  const session = await issueSession(user, { userAgent, ipAddress });
  return { ...session, user: toPublicUser(user) };
}

export async function logout(presentedToken) {
  if (!presentedToken) return;

  const stored = await RefreshToken.findOne({
    token_hash: hashToken(presentedToken),
  });
  if (stored && !stored.revoked_at) {
    stored.revoked_at = new Date();
    await stored.save();
  }
}

export async function getSessionUser(userId) {
  const user = await User.findById(userId)
    .select(fieldExclusions.user)
    .populate({
      path: "tenant_memberships",
      select: "tenant_id role -_id",
      populate: [
        { path: "tenant_id", select: "name" },
        { path: "role", select: "name -_id" },
      ],
    })
    .populate({
      path: "company_memberships",
      select: "company_id role -_id",
      populate: [
        { path: "company_id", select: "name" },
        { path: "role", select: "name -_id" },
      ],
    });

  if (!user || user.is_active === false) {
    throw ApiError.unauthorized("Account is disabled");
  }

  return toPublicUser(user);
}
