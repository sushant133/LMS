import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import morgan from "morgan";
import { connectDatabase } from "./config/db";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import routes from "./routes";

const app = express();

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
app.use(morgan("dev"));

// Serve uploaded files (tenant-isolated under /uploads)
import path from "path";
const uploadsDir = path.join(process.cwd(), "uploads");
app.use("/uploads", express.static(uploadsDir));

app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "MantraSphere CampusPro backend API",
    version: "1.0.0"
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    message: "MantraSphere CampusPro backend is running"
  });
});

// All routes under /api
app.use("/api", routes);

// Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

const startServer = async (): Promise<void> => {
  await connectDatabase();

  app.listen(env.PORT, () => {
    console.log(`Backend server listening on http://localhost:${env.PORT}`);
  });
};

startServer().catch((error) => {
  console.error("Failed to start backend", error);
  process.exit(1);
});