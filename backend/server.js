import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import morgan from "morgan";
import path from "path";
import { connectDatabase } from "./dist/config/db.js";
import { env } from "./dist/config/env.js";
import { errorHandler, notFoundHandler } from "./dist/middleware/errorHandler.js";
import routes from "./dist/routes/index.js";

const app = express();

if (env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

const corsOrigins = env.CORS_ORIGINS
  ? env.CORS_ORIGINS.split(",").map((origin) => origin.trim())
  : ["http://localhost:5173"];

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

const uploadsDir = env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
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

app.use("/api", routes);

app.use(notFoundHandler);
app.use(errorHandler);

const startServer = async () => {
  await connectDatabase();

  app.listen(env.PORT, () => {
    console.log(`Backend server listening on http://localhost:${env.PORT}`);
  });
};

startServer().catch((error) => {
  console.error("Failed to start backend", error);
  process.exit(1);
});