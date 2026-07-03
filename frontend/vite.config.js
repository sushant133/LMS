import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            "@nepal-school-erp/shared": path.resolve(__dirname, "../backend/shared/src"),
            components: path.resolve(__dirname, "./src/components"),
            features: path.resolve(__dirname, "./src/features"),
            hooks: path.resolve(__dirname, "./src/hooks"),
            i18n: path.resolve(__dirname, "./src/i18n"),
            lib: path.resolve(__dirname, "./src/lib"),
            pages: path.resolve(__dirname, "./src/pages")
        },
        extensions: [".ts", ".tsx", ".js", ".jsx", ".json"]
    },
    server: {
        port: 5173,
        strictPort: true,
        proxy: {
            "/api": {
                target: "http://127.0.0.1:5000",
                changeOrigin: true,
                secure: false,
                configure: (proxy) => {
                    proxy.on("error", (_error, _request, response) => {
                        if (response && "writeHead" in response && typeof response.writeHead === "function" && !response.headersSent) {
                            response.writeHead(503, { "Content-Type": "application/json" });
                            response.end(JSON.stringify({
                                success: false,
                                message: "Backend API is not running. Start it with: npm run dev --prefix ../backend"
                            }));
                        }
                    });
                }
            },
            "/uploads": {
                target: "http://127.0.0.1:5000",
                changeOrigin: true,
                secure: false
            }
        }
    }
});
