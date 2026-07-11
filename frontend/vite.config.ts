import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";

/**
 * Dev proxy target stays localhost by default.
 * Override only via env (VITE_DEV_PROXY_TARGET / BACKEND_URL) — never hardcode production hosts here.
 */
const resolveDevProxyTarget = (env: Record<string, string>): string => {
  const fromEnv =
    env.VITE_DEV_PROXY_TARGET?.trim() ||
    env.BACKEND_URL?.trim() ||
    process.env.VITE_DEV_PROXY_TARGET?.trim() ||
    process.env.BACKEND_URL?.trim();
  return (fromEnv || "http://127.0.0.1:5000").replace(/\/$/, "");
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = resolveDevProxyTarget(env);

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@phit-erp/shared": path.resolve(__dirname, "../backend/shared/src"),
        components: path.resolve(__dirname, "./src/components"),
        features: path.resolve(__dirname, "./src/features"),
        hooks: path.resolve(__dirname, "./src/hooks"),
        i18n: path.resolve(__dirname, "./src/i18n"),
        lib: path.resolve(__dirname, "./src/lib"),
        pages: path.resolve(__dirname, "./src/pages")
      },
      extensions: [".tsx", ".ts", ".jsx", ".js", ".json"]
    },
    build: {
      // Do not ship source maps publicly in production (prevents easy source recovery)
      sourcemap: mode !== "production",
      minify: "esbuild",
      target: "es2020",
      chunkSizeWarningLimit: 1200,
      // Clean output directory for reproducible production deploys
      emptyOutDir: true
    },
    esbuild:
      mode === "production"
        ? {
            // Strip debug noise from production bundles
            drop: ["console", "debugger"]
          }
        : undefined,
    server: {
      port: 5173,
      strictPort: true,
      host: true,
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
          configure: (proxy) => {
            proxy.on("error", (_error, _request, response) => {
              if (
                response &&
                "writeHead" in response &&
                typeof response.writeHead === "function" &&
                !response.headersSent
              ) {
                response.writeHead(503, { "Content-Type": "application/json" });
                response.end(
                  JSON.stringify({
                    success: false,
                    message:
                      "Backend API is not running. Start it with: npm run dev --prefix ../backend"
                  })
                );
              }
            });
          }
        },
        "/uploads": {
          target: proxyTarget,
          changeOrigin: true,
          secure: false
        }
      }
    },
    preview: {
      port: 4173,
      strictPort: true
    }
  };
});
