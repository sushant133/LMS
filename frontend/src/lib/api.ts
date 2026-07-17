import axios from "axios";
import { getApiBaseUrl, appConfig } from "./config";
import { redirectToLogin } from "./redirectToLogin";

export { getApiBaseUrl, appConfig };

/**
 * Resolve a path relative to the API base for fetch() / XHR calls.
 * Pass paths without a leading /api prefix (e.g. /auth/login, /uploads/classroom).
 * Upload POST endpoints live under /api/uploads/* — use this helper for those.
 */
export const resolveApiUrl = (path: string): string => {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBaseUrl();
  const relativePath = normalized.startsWith("/api/") ? normalized.slice(4) : normalized;

  return `${base}${relativePath}`;
};

/**
 * Resolve a stored media path for <img>, <a href>, and browser navigation.
 *
 * MongoDB stores relative paths like `/uploads/{schoolId}/teachers/photos/x.jpg`.
 * Files are served at `/uploads/:schoolId/*` (authenticated), NOT under `/api`.
 * Never prefix these with `/api` or the browser will 404.
 */
export const resolveMediaUrl = (path?: string | null): string | undefined => {
  if (!path || typeof path !== "string") return undefined;
  let trimmed = path.trim();
  if (!trimmed) return undefined;

  // Block dangerous schemes
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) return undefined;

  // Already absolute CDN / external URL
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  // Accidental /api/uploads → /uploads (legacy clients)
  if (trimmed.startsWith("/api/uploads/")) {
    trimmed = trimmed.slice(4);
  } else if (trimmed.startsWith("api/uploads/")) {
    trimmed = `/${trimmed.slice(3)}`;
  }

  if (!trimmed.startsWith("/")) {
    trimmed = `/${trimmed}`;
  }

  // Ensure /uploads prefix for bare storage-relative paths
  if (!trimmed.startsWith("/uploads/") && !trimmed.startsWith("/api/")) {
    // leave non-upload public assets (e.g. /favicon) as-is
  }

  const base = getApiBaseUrl();

  // Cross-origin API host (e.g. http://localhost:5000/api or https://api.example.com/api)
  // Media is on the same origin as the API but outside the /api prefix.
  if (/^https?:\/\//i.test(base)) {
    const origin = base.replace(/\/api\/?$/i, "").replace(/\/$/, "");
    return `${origin}${trimmed}`;
  }

  // Same-origin (Vite / Nginx reverse proxy of /uploads)
  return trimmed;
};

export const api = axios.create({
  baseURL: getApiBaseUrl(),
  withCredentials: true,
  headers: {
    "Content-Type": "application/json"
  }
});

/** Prevent multiple concurrent 401s from thrashing full-page redirects. */
let redirectingOn401 = false;

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status as number | undefined;
    const requestUrl = String(error?.config?.url ?? "");
    // Leave auth bootstrap endpoints alone — AuthProvider handles /auth/me null session.
    const isAuthBootstrap =
      requestUrl.includes("/auth/login") ||
      requestUrl.includes("/auth/register") ||
      requestUrl.includes("/auth/me") ||
      requestUrl.includes("/auth/logout");

    if (status === 401 && !isAuthBootstrap && !redirectingOn401) {
      redirectingOn401 = true;
      redirectToLogin();
    }

    return Promise.reject(error);
  }
);

export const unwrap = async <T>(promise: Promise<{ data: { data: T } }>): Promise<T> => {
  const response = await promise;
  return response.data.data;
};
