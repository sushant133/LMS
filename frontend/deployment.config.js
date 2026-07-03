/** Production URLs — used by Vercel API proxy when env vars are not set. */
export const PRODUCTION_BACKEND_URL = "https://lms-s7tz.onrender.com";
export const PRODUCTION_FRONTEND_URL = "https://lms-eulz.vercel.app";

export const getBackendUrl = () =>
  (process.env.BACKEND_URL ?? process.env.VITE_BACKEND_URL ?? PRODUCTION_BACKEND_URL).trim().replace(/\/$/, "");

export async function proxyToBackend(request) {
  const backendUrl = getBackendUrl();
  const incoming = new URL(request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, backendUrl);

  const headers = new Headers(request.headers);
  headers.delete("host");

  const init = {
    method: request.method,
    headers,
    redirect: "manual"
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  return fetch(target.toString(), init);
}