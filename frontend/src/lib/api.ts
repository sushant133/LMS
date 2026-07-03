import axios from "axios";

const DEFAULT_API_BASE = "/api";

const isLocalDevHost = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

/**
 * API base URL including the /api prefix.
 * Production must use same-origin `/api` so Vercel can proxy to Render and auth cookies work.
 * A cross-origin Render URL breaks cookie auth because production cookies use SameSite=Lax.
 */
export const getApiBaseUrl = (): string => {
  if (typeof window !== "undefined" && !isLocalDevHost(window.location.hostname)) {
    return DEFAULT_API_BASE;
  }

  const configured = import.meta.env.VITE_API_URL?.trim();
  if (!configured) {
    return DEFAULT_API_BASE;
  }

  return configured.replace(/\/$/, "");
};

/**
 * Resolve a path relative to the API base for fetch() calls.
 * Pass paths without a leading /api prefix (e.g. /auth/login, /uploads/classroom).
 */
export const resolveApiUrl = (path: string): string => {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBaseUrl();
  const relativePath = normalized.startsWith("/api/") ? normalized.slice(4) : normalized;

  return `${base}${relativePath}`;
};

export const api = axios.create({
  baseURL: getApiBaseUrl(),
  withCredentials: true,
  headers: {
    "Content-Type": "application/json"
  }
});

export const unwrap = async <T>(promise: Promise<{ data: { data: T } }>): Promise<T> => {
  const response = await promise;
  return response.data.data;
};