import axios from "axios";
import { getApiBaseUrl, appConfig } from "./config";

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

export const unwrap = async <T>(promise: Promise<{ data: { data: T } }>): Promise<T> => {
  const response = await promise;
  return response.data.data;
};
