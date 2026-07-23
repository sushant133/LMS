import type { Request, Response } from "express";
import {
  biometricPunchItemSchema,
  biometricPunchRequestSchema,
  type BiometricPunchItemInput
} from "@phit-erp/shared";
import { env } from "../config/env.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  isBiometricAttendanceEnabled,
  processBiometricPunchBatch
} from "../utils/biometricPunchService.js";
import { sendSuccess } from "../utils/response.js";

/**
 * POST /api/biometric/punches
 * Device/bridge ingest — no JWT, no UI. Feature-flagged + API key.
 */
export const ingestBiometricPunches = asyncHandler(async (req: Request, res: Response) => {
  const parsed = biometricPunchRequestSchema.parse(req.body);

  let items: BiometricPunchItemInput[];
  if ("punches" in parsed) {
    const batchSchool = parsed.schoolId;
    items = parsed.punches.map((p) => ({
      ...p,
      schoolId: p.schoolId || batchSchool || env.BIOMETRIC_DEFAULT_SCHOOL_ID
    }));
  } else {
    items = [
      {
        ...parsed,
        schoolId: parsed.schoolId || env.BIOMETRIC_DEFAULT_SCHOOL_ID
      }
    ];
    // Re-validate after default school injection
    items = items.map((item) => biometricPunchItemSchema.parse(item));
  }

  const results = await processBiometricPunchBatch(items);

  return sendSuccess(
    res,
    "Biometric punches processed",
    {
      enabled: isBiometricAttendanceEnabled(),
      processed: results.length,
      results
    },
    200
  );
});

/**
 * GET /api/biometric/health
 * Lightweight probe for integrators (requires API key when enabled).
 * Does not expose secrets.
 */
export const biometricHealth = asyncHandler(async (_req: Request, res: Response) => {
  return sendSuccess(res, "Biometric foundation status", {
    enabled: isBiometricAttendanceEnabled(),
    hasDefaultSchool: Boolean(env.BIOMETRIC_DEFAULT_SCHOOL_ID),
    staffLateAfter: env.BIOMETRIC_STAFF_LATE_AFTER,
    studentLateAfter: env.BIOMETRIC_STUDENT_LATE_AFTER,
    ingestPath: "/api/biometric/punches",
    note: "Foundation only — not exposed in LMS UI yet"
  });
});
