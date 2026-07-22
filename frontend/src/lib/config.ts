/**
 * Centralized frontend configuration.
 *
 * Development (unchanged):
 *   - Browser → http://localhost:5173
 *   - Vite proxies /api and /uploads → local backend (see vite.config.ts)
 *   - VITE_API_URL defaults to /api
 *
 * Production (Hostinger / custom domain — set at build/deploy time only):
 *   - Prefer same-origin `/api` behind Nginx reverse proxy (recommended)
 *   - Or set VITE_API_URL=https://api.yourdomain.com/api for a split API host
 *
 * Never hardcode production domains in application source.
 */

const DEFAULT_API_BASE = "/api";

const isLocalDevHost = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

/**
 * API base URL including the `/api` prefix.
 * Localhost keeps using VITE_API_URL (or /api via Vite proxy).
 * Non-local hosts default to same-origin `/api` for cookie-safe reverse proxy setups.
 * Explicit absolute VITE_API_URL is honored when set (split-domain deployments).
 */
export const getApiBaseUrl = (): string => {
  const configured = import.meta.env.VITE_API_URL?.trim();

  if (typeof window !== "undefined" && !isLocalDevHost(window.location.hostname)) {
    // Absolute URL set at build time for cross-origin API
    if (configured && /^https?:\/\//i.test(configured)) {
      return configured.replace(/\/$/, "");
    }
    // Same-origin reverse proxy (recommended for Hostinger + Nginx)
    return DEFAULT_API_BASE;
  }

  if (!configured) {
    return DEFAULT_API_BASE;
  }

  return configured.replace(/\/$/, "");
};

export const appConfig = {
  /** Display name (optional branding via env). */
  appName: import.meta.env.VITE_APP_NAME?.trim() || "PHIT COLLEGE",
  /** Vite mode: development | production */
  mode: import.meta.env.MODE,
  /** True when running `vite` / `npm run dev`. */
  isDev: import.meta.env.DEV,
  /** True for production builds. */
  isProd: import.meta.env.PROD,
  /** Resolved API base (includes /api). */
  get apiBaseUrl() {
    return getApiBaseUrl();
  }
} as const;
