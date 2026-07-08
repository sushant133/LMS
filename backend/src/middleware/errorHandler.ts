import type { NextFunction, Request, Response } from "express";
import { Error as MongooseError } from "mongoose";
import { ZodError } from "zod";
import { ApiError } from "../utils/apiError.js";

export const notFoundHandler = (req: Request, _res: Response, next: NextFunction): void => {
  next(new ApiError(404, `Route not found: ${req.originalUrl}`));
};

export const errorHandler = (error: unknown, _req: Request, res: Response, _next: NextFunction): Response => {
  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: error.issues
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

  console.error(error);

  return res.status(500).json({
    success: false,
    message: "Internal server error"
  });
};

