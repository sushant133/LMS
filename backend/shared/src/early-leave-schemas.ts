import { z } from "zod";
import { academicYearSchema, objectIdSchema, optionalObjectIdSchema } from "./schemas.js";
import { EARLY_LEAVE_PERIOD_KINDS } from "./early-leave-types.js";

const timeHm = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "Time must be HH:MM")
  .optional()
  .or(z.literal(""));

export const studentEarlyLeaveSchema = z
  .object({
    studentId: objectIdSchema,
    dateBs: z.string().min(8, "Date (BS) is required"),
    periodKind: z.enum(EARLY_LEAVE_PERIOD_KINDS).default("AFTER_PERIOD"),
    leftAfterPeriod: z.coerce.number().int().min(1).max(12).optional().nullable(),
    periodLabel: z.string().trim().min(1, "Period / leave point is required").max(120),
    reason: z.string().trim().min(1, "Reason is required").max(300),
    approvedBy: z.string().trim().max(120).optional().or(z.literal("")),
    remarks: z.string().trim().max(500).optional().or(z.literal("")),
    leftAtTime: timeHm,
    batchId: optionalObjectIdSchema,
    yearId: optionalObjectIdSchema,
    classId: optionalObjectIdSchema,
    sectionId: optionalObjectIdSchema,
    academicYearBs: academicYearSchema.optional().or(z.literal(""))
  })
  .superRefine((data, ctx) => {
    if (data.periodKind === "AFTER_PERIOD") {
      if (data.leftAfterPeriod == null || data.leftAfterPeriod < 1) {
        ctx.addIssue({
          code: "custom",
          message: "Select the period after which the student left (1–12)",
          path: ["leftAfterPeriod"]
        });
      }
    }
  });

export const studentEarlyLeaveUpdateSchema = studentEarlyLeaveSchema.partial().extend({
  studentId: objectIdSchema.optional()
});

export type StudentEarlyLeaveInput = z.infer<typeof studentEarlyLeaveSchema>;
export type StudentEarlyLeaveUpdateInput = z.infer<typeof studentEarlyLeaveUpdateSchema>;
