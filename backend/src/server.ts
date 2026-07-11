import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import type { Server } from "node:http";
import morgan from "morgan";
import path from "path";
import { connectDatabase, disconnectDatabase } from "./config/db.js";
import { env, getUploadDir } from "./config/env.js";
import { serveComplaintAttachment } from "./controllers/complaintFileController.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { protect } from "./middleware/auth.js";
import { originCheck } from "./middleware/originCheck.js";
import { securityHeaders } from "./middleware/securityHeaders.js";
import routes from "./routes/index.js";
import { ensureDemoData } from "./seed/index.js";
import { migrateLegacyDemoDisplayNames } from "./utils/migrateLegacyDemoDisplayNames.js";
import { startAcademicManagementNotificationScheduler } from "./utils/academicManagementNotifications.js";
import { configuredCorsOrigins, isOriginAllowed } from "./utils/allowedOrigins.js";
import { logger } from "./utils/logger.js";

const app = express();

// Reverse-proxy readiness (Nginx / Hostinger): respect X-Forwarded-* for IP, proto, host
if (env.TRUST_PROXY > 0) {
  app.set("trust proxy", env.TRUST_PROXY);
}

// Disable fingerprinting
app.disable("x-powered-by");

app.use(securityHeaders);

app.use(
  cors({
    origin: (origin, callback) => {
      // Shared allowlist with originCheck (dev: localhost any port + LAN; prod: CORS_ORIGINS only)
      if (isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    maxAge: 600
  })
);

app.use(cookieParser(env.COOKIE_SECRET));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(originCheck);

// Development: detailed logs. Production: Apache combined (no sensitive bodies).
if (env.NODE_ENV === "production") {
  app.use(morgan("combined", { skip: (req) => req.url === "/api/health" }));
} else if (env.LOG_LEVEL === "debug" || env.LOG_LEVEL === "info") {
  app.use(morgan("dev"));
}

const uploadsDir = getUploadDir();
app.get("/uploads/:schoolId/complaints/:filename", protect, serveComplaintAttachment);
app.use("/uploads", (req, res, next) => {
  if (req.path.includes("/complaints/")) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }
  // Never execute uploaded content as scripts
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", "inline");
  return next();
});
app.use(
  "/uploads",
  express.static(uploadsDir, {
    dotfiles: "deny",
    index: false,
    setHeaders: (res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, max-age=3600");
    }
  })
);

app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "PHIT LMS backend API",
    version: "1.0.0",
    environment: env.NODE_ENV
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    message: "PHIT LMS backend is running",
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// All routes under /api
app.use("/api", routes);

// Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

let httpServer: Server | null = null;
let isShuttingDown = false;

const shutdown = async (signal: string): Promise<void> => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`Received ${signal} — graceful shutdown starting`);

  const forceTimer = setTimeout(() => {
    logger.error("Graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, 15_000);
  forceTimer.unref();

  try {
    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer!.close((err) => (err ? reject(err) : resolve()));
      });
      logger.info("HTTP server closed");
    }
    await disconnectDatabase();
    logger.info("Database disconnected");
    process.exit(0);
  } catch (error) {
    logger.error("Error during shutdown", error);
    process.exit(1);
  }
};

const startServer = async (): Promise<void> => {
  await connectDatabase();
  await migrateLegacyDemoDisplayNames();
  await ensureDemoData();

  startAcademicManagementNotificationScheduler();

  httpServer = app.listen(env.PORT, env.HOST, () => {
    logger.info(
      `Backend listening on http://${env.HOST === "0.0.0.0" ? "localhost" : env.HOST}:${env.PORT} (${env.NODE_ENV})`
    );
    logger.info(`Uploads directory: ${uploadsDir}`);
    logger.debug(`CORS origins: ${configuredCorsOrigins().join(", ")}`);
    logger.debug(`Trust proxy hops: ${env.TRUST_PROXY}`);
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
};

startServer().catch((error) => {
  logger.error("Failed to start backend", error);
  process.exit(1);
});
