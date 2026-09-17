import { z } from "zod";
import { objectIdSchema } from "./schemas.js";
import {
  LIBRARY_BORROWER_TYPES,
  LIBRARY_ISSUE_LIMIT_YEAR_LEVELS,
  type LibraryIssueLimitYearLevel,
  type LibraryIssueStaffLimits
} from "./library-issue-limits-types.js";

const yearLimitValue = z.coerce.number().int().min(0).max(50);

export const libraryIssueYearLimitsSchema = z.object({
  "1st Year": yearLimitValue,
  "2nd Year": yearLimitValue,
  "3rd Year": yearLimitValue
}) satisfies z.ZodType<Record<LibraryIssueLimitYearLevel, number>>;

export const libraryIssueStaffLimitsSchema = z.object({
  TEACHER: yearLimitValue,
  STAFF: yearLimitValue
}) satisfies z.ZodType<LibraryIssueStaffLimits>;

export const libraryBorrowerTypeSchema = z.enum(LIBRARY_BORROWER_TYPES);

export const libraryIssueLimitConfigUpdateSchema = z.object({
  limits: libraryIssueYearLimitsSchema,
  /** Optional so an older client that only sends year limits keeps working. */
  staffLimits: libraryIssueStaffLimitsSchema.optional()
});

const bsDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD (BS)");

/**
 * A borrower is addressed either by the legacy `studentId` field or by the
 * `borrowerType` + `borrowerId` pair. Exactly one borrower must resolve.
 */
export const libraryIssueLimitExceptionSchema = z
  .object({
    borrowerType: libraryBorrowerTypeSchema.default("STUDENT"),
    borrowerId: objectIdSchema.optional(),
    /** Legacy field — same as borrowerId when borrowerType is STUDENT. */
    studentId: objectIdSchema.optional(),
    additionalBooks: z.coerce.number().int().min(1).max(20),
    reason: z.string().trim().min(2, "Reason is required").max(300),
    effectiveFromBs: bsDate,
    effectiveUntilBs: bsDate.optional().or(z.literal("")),
    remarks: z.string().trim().max(500).optional().or(z.literal(""))
  })
  .superRefine((data, ctx) => {
    const until = (data.effectiveUntilBs ?? "").trim();
    if (until && until < data.effectiveFromBs) {
      ctx.addIssue({
        code: "custom",
        message: "Effective until must be on or after effective from",
        path: ["effectiveUntilBs"]
      });
    }
    if (!data.borrowerId && !data.studentId) {
      ctx.addIssue({
        code: "custom",
        message: "Select the teacher, staff member, or student",
        path: ["borrowerId"]
      });
    }
    if (data.borrowerType !== "STUDENT" && !data.borrowerId) {
      ctx.addIssue({
        code: "custom",
        message: "borrowerId is required for teacher and staff exceptions",
        path: ["borrowerId"]
      });
    }
  });

export const libraryIssueLimitExceptionUpdateSchema = z
  .object({
    additionalBooks: z.coerce.number().int().min(1).max(20).optional(),
    reason: z.string().trim().min(2).max(300).optional(),
    effectiveFromBs: bsDate.optional(),
    effectiveUntilBs: bsDate.optional().or(z.literal("")),
    remarks: z.string().trim().max(500).optional().or(z.literal("")),
    /** Soft-revoke the exception immediately. */
    isRevoked: z.boolean().optional()
  })
  .superRefine((data, ctx) => {
    const from = data.effectiveFromBs?.trim();
    const until = data.effectiveUntilBs?.trim();
    if (from && until && until < from) {
      ctx.addIssue({
        code: "custom",
        message: "Effective until must be on or after effective from",
        path: ["effectiveUntilBs"]
      });
    }
  });

export type LibraryIssueLimitConfigUpdateInput = z.infer<
  typeof libraryIssueLimitConfigUpdateSchema
>;
export type LibraryIssueLimitExceptionInput = z.infer<
  typeof libraryIssueLimitExceptionSchema
>;
export type LibraryIssueLimitExceptionUpdateInput = z.infer<
  typeof libraryIssueLimitExceptionUpdateSchema
>;

export { LIBRARY_ISSUE_LIMIT_YEAR_LEVELS };
