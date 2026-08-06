import type { Response } from "express";

/**
 * `meta` carries out-of-band details about the payload — pagination totals, for example —
 * without changing the shape of `data`, so clients that only read `data` are unaffected.
 */
export const sendSuccess = <T>(
  res: Response,
  message: string,
  data?: T,
  statusCode = 200,
  meta?: Record<string, unknown>
): Response =>
  res.status(statusCode).json({
    success: true,
    message,
    data,
    ...(meta ? { meta } : {})
  });

