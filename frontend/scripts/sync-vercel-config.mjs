import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(frontendRoot, "vercel.json");

const backendUrl = (process.env.BACKEND_URL ?? process.env.VITE_BACKEND_URL ?? "https://lms-s7tz.onrender.com")
  .trim()
  .replace(/\/$/, "");

const config = JSON.parse(readFileSync(configPath, "utf8"));

config.rewrites = [
  {
    source: "/api/:path*",
    destination: `${backendUrl}/api/:path*`
  },
  {
    source: "/uploads/:path*",
    destination: `${backendUrl}/uploads/:path*`
  },
  {
    source: "/((?!api|uploads).*)",
    destination: "/index.html"
  }
];

writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`[sync-vercel-config] Proxying /api and /uploads to ${backendUrl}`);