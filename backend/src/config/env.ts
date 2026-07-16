import { existsSync } from "node:fs";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = path.join(backendRoot, ".env");

// Local dev uses backend/.env. On VPS / cloud hosts, set vars in the process manager or system env.
if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const boolFromEnv = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value === "") return defaultValue;
      return value === "true" || value === "1";
    })
    .pipe(z.boolean());

const envSchema = z.object({
  /** Listen port (Hostinger / PM2 / systemd can override). */
  PORT: z.coerce.number().default(5000),
  /** Bind address. Use 127.0.0.1 behind Nginx on the same host, or 0.0.0.0 if needed. */
  HOST: z.string().default("0.0.0.0"),
  /**
   * Any standard MongoDB connection string (Atlas, local replica set, or VPS MongoDB).
   * The app does not hardcode Atlas — only this URI.
   */
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default("7d"),
  /**
   * Optional separate secret for future refresh tokens.
   * When unset, falls back to JWT_SECRET (current single-token auth unchanged).
   */
  JWT_REFRESH_SECRET: z.string().min(16).optional(),
  JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),
  COOKIE_SECRET: z.string().min(8),
  /** Comma-separated browser origins allowed for CORS (e.g. http://localhost:5173 or https://app.example.com). */
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  COOKIE_NAME: z.string().default("nepal_school_erp_token"),
  ACTIVE_SCHOOL_COOKIE_NAME: z.string().default("nepal_school_erp_active_school"),
  COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
  COOKIE_SECURE: boolFromEnv(false),
  /** Optional cookie Domain attribute (e.g. .example.com). Leave empty for host-only cookies. */
  COOKIE_DOMAIN: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    }),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  /**
   * Express trust proxy hop count (for X-Forwarded-* behind Nginx).
   * Default: 0 in development, 1 in production.
   */
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value === "") {
        return process.env.NODE_ENV === "production" ? 1 : 0;
      }
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    })
    .pipe(z.number().int().min(0)),
  /**
   * Absolute or relative path for the centralized upload root on this machine/VPS.
   * Defaults to <cwd>/uploads in development.
   * Production example: UPLOAD_DIR=/var/www/phit-erp/uploads
   *
   * All new uploads (images, PDFs, documents) are stored here as files.
   * MongoDB stores only relative paths + metadata — never binary content.
   * Works the same in local dev and production (only this env value changes).
   */
  UPLOAD_DIR: z.string().optional(),
  /**
   * Legacy Cloudinary credentials (optional).
   * New uploads always go to local/VPS disk (UPLOAD_DIR).
   * These vars are only used to delete historical Cloudinary assets still referenced in MongoDB.
   */
  CLOUDINARY_CLOUD_NAME: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  CLOUDINARY_API_KEY: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  CLOUDINARY_API_SECRET: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  /** Legacy Cloudinary folder prefix (cleanup only). */
  CLOUDINARY_FOLDER: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim().replace(/^\/+|\/+$/g, "");
      return trimmed || "phit-erp";
    })
    .default("phit-erp"),
  /**
   * Optional public origin of the API (e.g. https://api.example.com).
   * Used only for diagnostics / absolute URL helpers — routes stay relative by default.
   */
  PUBLIC_API_URL: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim().replace(/\/$/, "");
      return trimmed ? trimmed : undefined;
    }),
  LOG_LEVEL: z
    .enum(["error", "warn", "info", "debug"])
    .default(process.env.NODE_ENV === "production" ? "info" : "debug"),
  /** Demo seed: default off in production unless explicitly SEED_DEMO=true. */
  SEED_DEMO: z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value === "") {
        return process.env.NODE_ENV !== "production";
      }
      return value === "true";
    })
    .pipe(z.boolean()),
  DEFAULT_USER_PASSWORD: z.string().min(6).default("ChangeMe123!"),
  SUPER_ADMIN_NAME: z.string().min(2).default("System Administrator"),
  SUPER_ADMIN_EMAIL: z.email().default("superadmin@nepal-school.com"),
  SUPER_ADMIN_PASSWORD: z.string().min(6).default("Admin@123456"),
  /** Public frontend URL used in credential emails (login link). Falls back to first CORS origin. */
  APP_URL: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: boolFromEnv(false),
  SMTP_USER: z.string().optional(),
  /** Gmail app passwords may include spaces — strip them. */
  SMTP_PASS: z
    .string()
    .optional()
    .transform((value) => value?.replace(/\s+/g, "") || undefined),
  SMTP_FROM_EMAIL: z.string().optional(),
  SMTP_FROM_NAME: z.string().default("Public Himal Institute of Technology"),
  /** Optional Reply-To (defaults to From). Use a monitored institution inbox when possible. */
  SMTP_REPLY_TO: z.string().optional(),
  /**
   * Process-wide default for subject-assignment scope mode when Setting has no override.
   * Keep `legacy` until migration + dual soak complete.
   */
  /**
   * Teacher LMS scope source.
   * - dual (default): NA/ACCEPTED teachers use SubjectAssignment matrix; PENDING use legacy arrays
   * - assignment: always SubjectAssignment rows
   * - legacy: always Teacher.subjects / assigned* arrays (cartesian, no units)
   */
  SUBJECT_ASSIGNMENT_SCOPE_DEFAULT: z.enum(["legacy", "dual", "assignment"]).default("dual"),
  /**
   * When true (and Setting does not override), new timetable slots require subjectAssignmentId.
   * Enable only after backfill is clean for the school.
   */
  SUBJECT_ASSIGNMENT_TIMETABLE_REQUIRE_LINK: boolFromEnv(false)
});

export const env = envSchema.parse(process.env);

/** Effective refresh secret — separate secret if set, else JWT_SECRET. */
export const getJwtRefreshSecret = (): string => env.JWT_REFRESH_SECRET ?? env.JWT_SECRET;

// Production hard-fail on weak secrets / insecure cookie settings
if (env.NODE_ENV === "production") {
  const weakSecrets = [
    "replace-with-a-strong-secret",
    "replace-with-a-cookie-secret",
    "secret",
    "changeme",
    "Admin@123456",
    "ChangeMe123!"
  ];
  if (env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters in production");
  }
  if (weakSecrets.some((w) => env.JWT_SECRET.toLowerCase().includes(w.toLowerCase()))) {
    throw new Error("JWT_SECRET must not use a placeholder/weak value in production");
  }
  if (env.COOKIE_SECRET.length < 16) {
    throw new Error("COOKIE_SECRET must be at least 16 characters in production");
  }
  if (env.CORS_ORIGINS.includes("*")) {
    throw new Error("CORS_ORIGINS must not be * for authenticated production APIs");
  }
  if (env.COOKIE_SAME_SITE === "none" && !env.COOKIE_SECURE) {
    throw new Error("COOKIE_SECURE must be true when COOKIE_SAME_SITE=none");
  }
  if (env.JWT_REFRESH_SECRET && env.JWT_REFRESH_SECRET.length < 32) {
    throw new Error("JWT_REFRESH_SECRET must be at least 32 characters in production when set");
  }
  // Block well-known demo defaults for the System Administrator account
  const weakAdminPasswords = ["Admin@123456", "ChangeMe123!", "password", "admin123", "123456"];
  if (weakAdminPasswords.includes(env.SUPER_ADMIN_PASSWORD)) {
    throw new Error(
      "SUPER_ADMIN_PASSWORD must not use a default/demo value in production. Set a strong unique password."
    );
  }
  if (env.SEED_DEMO) {
    throw new Error("SEED_DEMO must be false in production");
  }
}

/**
 * Absolute path for the centralized upload root.
 * Dev: <backend cwd>/uploads · Prod: set UPLOAD_DIR (e.g. /var/www/phit-erp/uploads).
 */
export const getUploadDir = (): string =>
  env.UPLOAD_DIR ? path.resolve(env.UPLOAD_DIR) : path.join(process.cwd(), "uploads");

/**
 * True when legacy Cloudinary credentials are fully configured.
 * Used only for deleting historical CDN assets — new uploads always use local disk.
 */
export const isCloudinaryEnabled = (): boolean =>
  Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);

const isLocalHostname = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0";

const normalizeBaseUrl = (value: string): string => value.replace(/\/$/, "");

/**
 * Public frontend base URL for credential emails / login links.
 * Prefer a non-localhost HTTPS origin so real student inboxes never get
 * http://localhost links (those look like phishing and land in Spam).
 */
export const getPublicAppBaseUrl = (): string => {
  const candidates = [
    env.APP_URL?.trim(),
    ...env.CORS_ORIGINS.split(",").map((origin) => origin.trim())
  ].filter((value): value is string => Boolean(value));

  const parsed = candidates
    .map((value) => {
      try {
        return new URL(value);
      } catch {
        return null;
      }
    })
    .filter((url): url is URL => Boolean(url));

  const publicHttps = parsed.find(
    (url) => url.protocol === "https:" && !isLocalHostname(url.hostname)
  );
  if (publicHttps) {
    return normalizeBaseUrl(publicHttps.origin);
  }

  const anyPublic = parsed.find((url) => !isLocalHostname(url.hostname));
  if (anyPublic) {
    return normalizeBaseUrl(anyPublic.origin);
  }

  if (candidates[0]) {
    return normalizeBaseUrl(candidates[0]);
  }

  return "http://localhost:5173";
};

/** Login page URL for credential emails. */
export const getAppLoginUrl = (): string => `${getPublicAppBaseUrl()}/login`;

/** First configured CORS origin (frontend base). */
export const getPrimaryFrontendOrigin = (): string =>
  env.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .find(Boolean) || "http://localhost:5173";
