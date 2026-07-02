import type { Response } from "express";

export const sendSuccess = <T>(res: Response, message: string, data?: T, statusCode = 200): Response =>
  res.status(statusCode).json({
    success: true,
    message,
    data
  });

