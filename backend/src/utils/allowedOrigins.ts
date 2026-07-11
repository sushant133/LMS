import { env } from "../config/env.js";

/** Origins listed in CORS_ORIGINS (trimmed; newlines stripped). */
export const configuredCorsOrigins = (): string[] =>
  env.CORS_ORIGINS.split(/[,\n\r]+/)
    .map((origin) => origin.trim())
    .filter(Boolean);

const isLoopbackHostname = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1"
  );
};

/** Common private LAN ranges used when Vite binds to 0.0.0.0 (host: true). */
const isPrivateLanHostname = (hostname: string): boolean => {
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  return false;
};

/**
 * Whether a browser Origin is allowed for CORS / CSRF origin check.
 * Production: only CORS_ORIGINS.
 * Development: CORS_ORIGINS + any localhost/127.0.0.1 port + private LAN IPs.
 */
export const isOriginAllowed = (origin: string | undefined | null): boolean => {
  if (!origin) {
    // Non-browser clients, curl, same-origin proxies without Origin header
    return true;
  }

  const trimmed = origin.trim();
  if (!trimmed) return true;

  const configured = configuredCorsOrigins();
  if (configured.includes(trimmed)) {
    return true;
  }

  // Strict allowlist only in production
  if (env.NODE_ENV === "production") {
    return false;
  }

  // Development convenience: any local Vite port / LAN access for testing
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    if (isLoopbackHostname(url.hostname)) {
      return true;
    }
    if (isPrivateLanHostname(url.hostname)) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
};
