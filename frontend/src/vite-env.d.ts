/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * API base path or absolute URL including `/api`.
   * Dev default: `/api` (Vite proxies to local backend).
   * Production: leave unset or `/api` for same-origin Nginx proxy.
   */
  readonly VITE_API_URL?: string;
  /** Optional product display name. */
  readonly VITE_APP_NAME?: string;
  /**
   * Dev-only: Vite proxy target for /api and /uploads (see vite.config.ts).
   * Default: http://127.0.0.1:5000
   */
  readonly VITE_DEV_PROXY_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}