import "dotenv/config";
import { z } from "zod";

const bool = (def: boolean) =>
  z
    .enum(["true", "false"])
    .default(def ? "true" : "false")
    .transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  API_PREFIX: z.string().default("/api/v1"),
  PUBLIC_API_URL: z.string().default("http://localhost:5000"),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  MONGODB_URI: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, "must be at least 32 characters"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_SECRET: z.string().min(32, "must be at least 32 characters"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  REFRESH_COOKIE_NAME: z.string().default("flexo_rt"),
  COOKIE_SECURE: bool(false),
  COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
  COOKIE_DOMAIN: z.string().optional().default(""),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  R2_ACCOUNT_ID: z.string().default(""),
  R2_ACCESS_KEY_ID: z.string().default(""),
  R2_SECRET_ACCESS_KEY: z.string().default(""),
  R2_BUCKET_NAME: z.string().default(""),
  R2_ENDPOINT: z.string().default(""),
  R2_REGION: z.string().default("auto"),
  R2_PRESIGNED_URL_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(30)
    .max(3600)
    .default(900),
  R2_MULTIPART_PART_SIZE_MB: z.coerce
    .number()
    .int()
    .min(5)
    .max(5000)
    .default(10),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().default(1024),
  MAX_SINGLE_UPLOAD_SIZE_MB: z.coerce.number().int().positive().default(25),
  ALLOWED_UPLOAD_MIME_TYPES: z.string().default(""),
  ABANDONED_UPLOAD_HOURS: z.coerce.number().int().positive().default(24),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  JOB_NAME_REJECT_ARABIC: bool(true),
  COLOR_COUNT_INCLUDES_PANTONE: bool(false),
  DEFAULT_CURRENCY: z.string().length(3).default("DZD"),
  ALERT_SCAN_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(60),
  INITIAL_ADMIN_NAME: z.string().optional().default(""),
  INITIAL_ADMIN_EMAIL: z.string().optional().default(""),
  INITIAL_ADMIN_PASSWORD: z.string().optional().default(""),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production") {
    const problems: string[] = [];
    for (const k of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"] as const) {
      if (env[k].startsWith("replace_with"))
        problems.push(`${k} still has the placeholder value`);
    }
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET)
      problems.push("JWT secrets must differ");
    if (!env.COOKIE_SECURE)
      problems.push("COOKIE_SECURE must be true in production");
    for (const k of [
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET_NAME",
      "R2_ENDPOINT",
    ] as const) {
      if (!env[k]) problems.push(`${k} is required in production`);
    }
    if (problems.length)
      throw new Error(
        `Invalid production configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
      );
  }
  return env;
}

export const env: Env = loadEnv();

export const isProd = env.NODE_ENV === "production";
export const corsOrigins = env.CORS_ORIGINS.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
