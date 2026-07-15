import type { NextFunction, Request, Response } from "express";
import { Error as MongooseError } from "mongoose";
import { ZodError } from "zod";
import { env } from "../config/env.js";
import { ApiError } from "../utils/apiError.js";

export const notFoundHandler = (req: Request, _res: Response, next: NextFunction): void => {
  // Do not echo full originalUrl internals in production responses
  next(new ApiError(404, env.NODE_ENV === "production" ? "Route not found" : `Route not found: ${req.originalUrl}`));
};

export const errorHandler = (error: unknown, _req: Request, res: Response, _next: NextFunction): Response => {
  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      // Field issues are safe (client form feedback); never include stack/secrets
      errors: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
  }

  if (error instanceof ApiError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message
    });
  }

  // Multer file upload errors (size limit, unexpected field, etc.)
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "MulterError"
  ) {
    const multerError = error as { code?: string; message?: string; field?: string };
    let message = multerError.message || "File upload failed";
    if (multerError.code === "LIMIT_FILE_SIZE") {
      message =
        "File is too large for this upload. Photos max 2MB, banners max 5MB, documents max 10MB, assignments max 25MB.";
    } else if (multerError.code === "LIMIT_UNEXPECTED_FILE") {
      message = `Unexpected file field${multerError.field ? ` "${multerError.field}"` : ""}. Please use the correct upload control.`;
    } else if (multerError.code === "LIMIT_FILE_COUNT") {
      message = "Too many files in this upload.";
    }
    return res.status(400).json({
      success: false,
      message
    });
  }

  if (error instanceof MongooseError.CastError) {
    return res.status(400).json({
      success: false,
      message: "Invalid identifier"
    });
  }

  // Duplicate key (e.g. unique email) — generic message
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 11000
  ) {
    return res.status(409).json({
      success: false,
      message: "A record with this value already exists"
    });
  }

  // Log full error server-side only (never send stack to clients)
  const message = error instanceof Error ? error.message : String(error);
  console.error("[error]", message);
  if (env.NODE_ENV !== "production" && error instanceof Error && error.stack) {
    console.error(error.stack);
  }

  return res.status(500).json({
    success: false,
    message: "Internal server error"
  });
};

