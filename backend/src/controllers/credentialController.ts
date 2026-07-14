import type { Request, Response } from "express";
import { z } from "zod";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { resendAccountCredentials } from "../utils/credentialEmail.js";
import { sendSuccess } from "../utils/response.js";
import { isSoftDeletedAdminEmail } from "../utils/adminAccount.js";

const resendSchema = z.object({
  password: z.string().min(6).max(128).optional()
});

/**
 * POST /api/users/:userId/resend-credentials
 * Resets password (optional admin-provided, else strong random) and emails credentials.
 * Available for any ERP user role — no need to recreate the account.
 */
export const resendCredentials = asyncHandler(async (req: Request, res: Response) => {
  const userId = String(req.params.userId);
  const payload = resendSchema.parse(req.body ?? {});

  const existing = await User.findById(userId).select("email isActive schoolId role").lean();
  if (!existing) {
    throw new ApiError(404, "User not found");
  }

  if (isSoftDeletedAdminEmail(existing.email)) {
    throw new ApiError(400, "Cannot resend credentials for a deleted account");
  }

  // Never allow non–System Admins to reset System Administrator credentials
  if (existing.role === "SUPER_ADMIN" && req.user?.role !== "SUPER_ADMIN") {
    throw new ApiError(403, "You cannot resend credentials for a System Administrator account");
  }

  // Tenant isolation: institution users may only resend within their school.
  if (req.user?.role !== "SUPER_ADMIN") {
    const actorSchool = req.tenantSchoolId ?? req.user?.schoolId;
    if (!actorSchool || !existing.schoolId || existing.schoolId.toString() !== actorSchool.toString()) {
      throw new ApiError(403, "You cannot resend credentials for users outside your institution");
    }
  }

  try {
    const result = await resendAccountCredentials({
      userId,
      password: payload.password,
      req
    });

    const message = result.credentialsEmail.sent
      ? `Login credentials have been sent to: ${result.credentialsEmail.email}`
      : `Credential email could not be delivered. Reason: ${result.credentialsEmail.error ?? "Unknown error"}`;

    // Only return plaintext password when email delivery failed (admin must share manually).
    // Successful email delivery must not echo the password in the API response body.
    return sendSuccess(res, message, {
      user: result.user,
      loginEmail: result.user.email,
      ...(result.credentialsEmail.sent ? {} : { defaultPassword: result.password }),
      credentialsEmail: result.credentialsEmail
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "USER_NOT_FOUND") throw new ApiError(404, "User not found");
      if (error.message === "USER_INACTIVE") throw new ApiError(400, "User account is inactive");
    }
    throw error;
  }
});
