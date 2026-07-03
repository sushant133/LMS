import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import waitOn from "wait-on";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");
const backendRoot = path.resolve(frontendRoot, "../backend");
const tsxCli = path.resolve(backendRoot, "node_modules/tsx/dist/cli.mjs");
const viteBin = path.resolve(frontendRoot, "node_modules/vite/bin/vite.js");

let backendProcess = null;
let viteProcess = null;
let shuttingDown = false;

const freePort = (port) => {
  if (process.platform !== "win32") {
    return;
  }

  try {
    const output = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8" });
    const processIds = new Set();

    for (const line of output.split("\n")) {
      if (!line.includes("LISTENING")) {
        continue;
      }

      const processId = line.trim().split(/\s+/).pop();
      if (processId && processId !== "0") {
        processIds.add(processId);
      }
    }

    for (const processId of processIds) {
      console.log(`[dev] Stopping stale process ${processId} on port ${port}`);
      execSync(`taskkill /PID ${processId} /F`, { stdio: "ignore" });
    }
  } catch {
    // Port is already free.
  }
};

const cleanup = () => {
  shuttingDown = true;
  viteProcess?.kill();
  backendProcess?.kill();
};

process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});

process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

if (!existsSync(tsxCli) || !existsSync(viteBin)) {
  console.error("[dev] Missing dependencies. Run: npm install (in frontend and backend)");
  process.exit(1);
}

freePort(5000);
freePort(5173);

console.log("[dev] Starting backend API on http://127.0.0.1:5000 ...");

backendProcess = spawn(process.execPath, [tsxCli, "watch", "src/server.ts"], {
  cwd: backendRoot,
  stdio: "inherit",
  env: process.env
});

backendProcess.on("exit", (code) => {
  if (!shuttingDown && code !== 0) {
    console.error(`[dev] Backend exited with code ${code}`);
    viteProcess?.kill();
    process.exit(code ?? 1);
  }
});

try {
  await waitOn({
    resources: ["http-get://127.0.0.1:5000/api/health"],
    timeout: 120_000,
    interval: 500,
    window: 2_000
  });
  console.log("[dev] Backend is ready.");
} catch {
  console.error("[dev] Backend failed to start within 120 seconds.");
  console.error("[dev] Verify backend/.env exists and MONGODB_URI is valid.");
  cleanup();
  process.exit(1);
}

console.log("[dev] Starting Vite on http://localhost:5173 ...");

viteProcess = spawn(process.execPath, [viteBin], {
  cwd: frontendRoot,
  stdio: "inherit",
  env: process.env
});

viteProcess.on("exit", (code) => {
  if (!shuttingDown) {
    cleanup();
    process.exit(code ?? 0);
  }
});