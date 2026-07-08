import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import morgan from "morgan";
import path from "path";
import { connectDatabase } from "./config/db.js";
import { env } from "./config/env.js";
import { serveComplaintAttachment } from "./controllers/complaintFileController.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { protect } from "./middleware/auth.js";
import routes from "./routes/index.js";
import { ensureDemoData } from "./seed/index.js";
import { migrateLegacyDemoDisplayNames } from "./utils/migrateLegacyDemoDisplayNames.js";

const app = express();

if (env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

const corsOrigins = env.CORS_ORIGINS ? env.CORS_ORIGINS.split(",").map((origin) => origin.trim()) : ["http://localhost:5173"];

app.use(
  cors({
    origin: corsOrigins,
    credentials: true
  })
);

app.use(cookieParser(env.COOKIE_SECRET));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

const uploadsDir = env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
app.get("/uploads/:schoolId/complaints/:filename", protect, serveComplaintAttachment);
app.use("/uploads", (req, res, next) => {
  if (req.path.includes("/complaints/")) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }
  return next();
});
app.use("/uploads", express.static(uploadsDir));

app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "PHIT ERP backend API",
    version: "1.0.0"
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    message: "PHIT ERP backend is running"
  });
});

// All routes under /api
app.use("/api", routes);

// Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

const startServer = async (): Promise<void> => {
  await connectDatabase();
  await migrateLegacyDemoDisplayNames();
  await ensureDemoData();

  app.listen(env.PORT, () => {
    console.log(`Backend server listening on http://localhost:${env.PORT}`);
  });
};

startServer().catch((error) => {
  console.error("Failed to start backend", error);
  process.exit(1);
});