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

