import { existsSync } from "node:fs";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = path.join(backendRoot, ".env");

// Local dev uses backend/.env. On Render, set vars in the dashboard (or paste via "Add from .env").
if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const envSchema = z.object({
  PORT: z.coerce.number().default(5000),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default("7d"),
  COOKIE_SECRET: z.string().min(8),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  COOKIE_NAME: z.string().default("nepal_school_erp_token"),
  ACTIVE_SCHOOL_COOKIE_NAME: z.string().default("nepal_school_erp_active_school"),
  COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((value) => value === "true")
    .pipe(z.boolean())
    .default(false),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  UPLOAD_DIR: z.string().optional(),
  SEED_DEMO: z
    .string()
    .optional()
    .transform((value) => value !== "false")
    .pipe(z.boolean())
    .default(true),
  DEFAULT_USER_PASSWORD: z.string().min(6).default("ChangeMe123!"),
  SUPER_ADMIN_NAME: z.string().min(2).default("System Super Admin"),
  SUPER_ADMIN_EMAIL: z.email().default("superadmin@nepal-school.com"),
  SUPER_ADMIN_PASSWORD: z.string().min(6).default("Admin@123456")
});

export const env = envSchema.parse(process.env);
