import axios from "axios";

export const getApiBaseUrl = (): string => import.meta.env.VITE_API_BASE_URL ?? "/api";

/** Resolve an API or upload path for fetch/axios (supports cross-origin Render backend). */
export const resolveApiUrl = (path: string): string => {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBaseUrl();

  if (base.startsWith("http")) {
    const origin = base.replace(/\/api\/?$/, "");
    return `${origin}${normalized}`;
  }

  return normalized;
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

