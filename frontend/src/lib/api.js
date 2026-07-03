import axios from "axios";
const DEFAULT_API_BASE = "/api";
/** API base URL including the /api prefix (e.g. https://host.onrender.com/api or /api for local proxy). */
export const getApiBaseUrl = () => {
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
export const resolveApiUrl = (path) => {
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
export const unwrap = async (promise) => {
    const response = await promise;
    return response.data.data;
};
