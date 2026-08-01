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

  // Already absolute CDN / external URL — still rewrite same-site /uploads → /api/uploads
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      if (u.pathname.startsWith("/uploads/") && !u.pathname.startsWith("/api/uploads/")) {
        if (typeof window !== "undefined" && u.origin === window.location.origin) {
          return `/api${u.pathname}${u.search}`;
        }
      }
    } catch {
      /* keep original */
    }
    return trimmed;
  }

  // Normalize /api/uploads → /uploads then re-prefix for serving
  if (trimmed.startsWith("/api/uploads/")) {
    trimmed = trimmed.slice(4);
  } else if (trimmed.startsWith("api/uploads/")) {
    trimmed = `/${trimmed.slice(3)}`;
  }

  if (!trimmed.startsWith("/")) {
    trimmed = trimmed.startsWith("uploads/") ? `/${trimmed}` : `/${trimmed}`;
  }

  // Protected uploads: prefer /api/uploads so production reverse proxy works
  if (trimmed.startsWith("/uploads/")) {
    const base = getApiBaseUrl();
    if (/^https?:\/\//i.test(base)) {
      const apiBase = base.replace(/\/$/, "");
      if (apiBase.endsWith("/api")) {
        return `${apiBase}${trimmed}`;
      }
      return `${apiBase}/api${trimmed}`;
    }
    return `/api${trimmed}`;
  }

  const base = getApiBaseUrl();

  // Cross-origin API host for non-upload paths
  if (/^https?:\/\//i.test(base)) {
    const origin = base.replace(/\/api\/?$/i, "").replace(/\/$/, "");
    return `${origin}${trimmed}`;
  }

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
