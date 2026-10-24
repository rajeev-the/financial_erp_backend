import dotenv from "dotenv";
dotenv.config();

function number(key, fallback) {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolean(key, fallback) {
  const value = process.env[key];
  return value === undefined ? fallback : value.toLowerCase() === "true";
}

const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5173",
  "https://tally-dev.aventiq.ai",
  "https://tally.aventiq.ai",
];

function parseCorsOrigins(key, fallback = DEFAULT_CORS_ORIGINS) {
  const rawValue = process.env[key];
  if (!rawValue) return fallback;
  const value = rawValue.trim().replace(/^["']|["']$/g, "");
  if (!value) return fallback;
  if (value === "*") return true;
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : fallback;
}

const nodeEnv = process.env.NODE_ENV || "development";

export const env = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  port: number("PORT", 3000),
  cors: {
    origin: parseCorsOrigins("CORS_ORIGIN", DEFAULT_CORS_ORIGINS),
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessTtl: process.env.ACCESS_TOKEN_TTL,
    refreshTtlDays: number("REFRESH_TOKEN_TTL_DAYS", 30),
  },
  db: {
    uri: process.env.MONGO_URI,
  },

  otp: {
    secret: process.env.OTP_SECRET || "tally_bridge_otp_secret_key_default",
    length: number("OTP_LENGTH", 6),
    ttlMinutes: number("OTP_TTL_MINUTES", 10),
    maxAttempts: number("OTP_MAX_ATTEMPTS", 5),
    rateLimit: number("OTP_RATE_LIMIT", 3),
    rateWindowMinutes: number("OTP_RATE_WINDOW_MINUTES", 10),
    resendCooldownSeconds: number("OTP_RESEND_COOLDOWN_SECONDS", 60),
  },

  smtp: {
    host: process.env.SMTP_HOST,
    port: number("SMTP_PORT", 587),
    secure: boolean("SMTP_SECURE", false),
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.SMTP_FROM,
  },
};

const envConfig = {
  PORT: env.port,
  MONGO_URI: env.db.uri,
  CORS_ORIGIN: env.cors.origin,
};

export default envConfig;
