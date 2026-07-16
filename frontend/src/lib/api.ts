import axios from "axios";
import { getApiBaseUrl, appConfig } from "./config";
import { redirectToLogin } from "./redirectToLogin";

export { getApiBaseUrl, appConfig };

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
