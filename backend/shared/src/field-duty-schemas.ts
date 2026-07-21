import { z } from "zod";
import { FIELD_POSTING_TYPES } from "./field-duty-types.js";

const objectId = z.string().min(1);

export const fieldDutyStudentStatusSchema = z.enum([
  "PRESENT",
  "ABSENT",
  "LATE",
  "LEAVE",
  "EMERGENCY_DUTY"
]);

export const fieldDutyShiftSchema = z.enum([
  "MORNING",
  "DAY",
  "EVENING",
  "NIGHT",
  "FULL_DAY"
]);

export const fieldDutyRosterModeSchema = z.enum([
  "AUTO_BATCH_YEAR",
  "MANUAL",
  "MULTI_SHIFT",
  "DAILY"
]);

export const fieldDutyStudentShiftSchema = z.object({
  studentId: z.string().min(1),
  shift: fieldDutyShiftSchema
});

/** Accept known types or any non-empty custom type string for future scalability. */
export const fieldPostingTypeSchema = z
  .string()
  .min(1)
  .transform((v) => v.trim().toUpperCase().replace(/\s+/g, "_"))
  .refine((v) => v.length >= 2, "Posting type is required");

export const fieldDutyScheduleSchema = z.object({
  academicYearBs: z.string().min(1),
  faculty: z.string().optional().or(z.literal("")),
  semesterBs: z.string().optional().or(z.literal("")),
  batchId: objectId,
  yearId: objectId,
  sectionId: z.string().optional().or(z.literal("")),
  /** Configurable: COMMUNITY, PHC, HOSPITAL, or custom. */
  postingType: fieldPostingTypeSchema.default("HOSPITAL"),
  /**
   * Hospital / PHC / Community name.
   * Accepts siteName or legacy hospitalName.
   */
  siteName: z.string().optional().or(z.literal("")),
  hospitalName: z.string().optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  department: z.string().optional().or(z.literal("")),
  ward: z.string().optional().or(z.literal("")),
  /** Primary coordinator — existing College Staff only. */
  supervisorStaffId: objectId,
  /** Optional additional coordinators (College Staff). */
  assistantCoordinatorStaffIds: z.array(objectId).optional().default([]),
  clinicalInstructorName: z.string().optional().or(z.literal("")),
  hospitalSupervisorName: z.string().optional().or(z.literal("")),
  startDateBs: z.string().min(1),
  endDateBs: z.string().min(1),
  shift: fieldDutyShiftSchema.default("DAY"),
  remarks: z.string().optional().or(z.literal("")),
  status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]).default("ACTIVE"),
  rosterMode: fieldDutyRosterModeSchema.default("DAILY"),
  assignedStudentIds: z.array(objectId).optional().default([]),
  /** Required when rosterMode is MULTI_SHIFT — map each student to a shift. */
  studentShifts: z.array(fieldDutyStudentShiftSchema).optional().default([])
}).superRefine((data, ctx) => {
  const site = (data.siteName || data.hospitalName || "").trim();
  if (!site) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Hospital / PHC / Community name is required",
      path: ["siteName"]
    });
  }
  if (data.rosterMode === "MANUAL" && (!data.assignedStudentIds || data.assignedStudentIds.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Select at least one student for manual roster",
      path: ["assignedStudentIds"]
    });
  }
  if (data.rosterMode === "MULTI_SHIFT") {
    if (!data.studentShifts || data.studentShifts.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Assign at least one student to a shift for multi-shift roster",
        path: ["studentShifts"]
      });
    } else {
      const seen = new Set<string>();
      for (const row of data.studentShifts) {
        if (seen.has(row.studentId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Each student can only be assigned to one shift",
            path: ["studentShifts"]
          });
          break;
        }
        seen.add(row.studentId);
      }
    }
  }
});

/** Partial update schema without create-time site/roster requirements. */
export const fieldDutyScheduleUpdateSchema = fieldDutyScheduleSchema.partial().superRefine((data, ctx) => {
  if (data.siteName !== undefined || data.hospitalName !== undefined) {
    const site = (data.siteName || data.hospitalName || "").trim();
    if (!site) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Hospital / PHC / Community name is required",
        path: ["siteName"]
      });
    }
  }
  if (data.rosterMode === "MANUAL" && data.assignedStudentIds !== undefined && data.assignedStudentIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Select at least one student for manual roster",
      path: ["assignedStudentIds"]
    });
  }
  if (data.rosterMode === "MULTI_SHIFT" && data.studentShifts !== undefined) {
    if (data.studentShifts.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Assign at least one student to a shift for multi-shift roster",
        path: ["studentShifts"]
      });
    }
  }
});

export const fieldDutyAssignStudentsSchema = z.object({
  rosterMode: fieldDutyRosterModeSchema,
  assignedStudentIds: z.array(objectId).default([]),
  studentShifts: z.array(fieldDutyStudentShiftSchema).optional().default([])
}).superRefine((data, ctx) => {
  if (data.rosterMode === "MANUAL" && data.assignedStudentIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Select at least one student for manual roster",
      path: ["assignedStudentIds"]
    });
  }
  if (data.rosterMode === "MULTI_SHIFT" && data.studentShifts.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Assign at least one student to a shift",
      path: ["studentShifts"]
    });
  }
});

export const fieldDutyAssignCoordinatorsSchema = z.object({
  supervisorStaffId: objectId,
  assistantCoordinatorStaffIds: z.array(objectId).optional().default([])
});

export const fieldDutyAttendanceEntrySchema = z.object({
  studentId: objectId,
  status: fieldDutyStudentStatusSchema,
  remarks: z.string().optional().or(z.literal(""))
});

export const fieldDutyAttendanceSubmitSchema = z.object({
  scheduleId: objectId,
  dateBs: z.string().min(1),
  /**
   * Required for MULTI_SHIFT postings (attendance is per shift).
   * Optional for single-shift postings (falls back to posting.shift).
   */
  shift: fieldDutyShiftSchema.optional(),
  entries: z.array(fieldDutyAttendanceEntrySchema).min(1),
  notes: z.string().optional().or(z.literal(""))
});

export const fieldDutyAttendanceUpdateSchema = z.object({
  entries: z.array(fieldDutyAttendanceEntrySchema).min(1),
  notes: z.string().optional().or(z.literal(""))
});

export const fieldDutyUnlockSchema = z.object({
  reason: z.string().min(2)
});

export const fieldDutyEditRequestSchema = z.object({
  reason: z.string().min(2)
});

export const fieldDutyEditRequestReviewSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  reviewNotes: z.string().optional().or(z.literal(""))
});

export const fieldAttendanceSettingsSchema = z.object({
  contributeToOverall: z.boolean().optional(),
  countLateAsPresent: z.boolean().optional()
});

export type FieldDutyScheduleInput = z.infer<typeof fieldDutyScheduleSchema>;
export type FieldDutyAttendanceSubmitInput = z.infer<typeof fieldDutyAttendanceSubmitSchema>;
export type FieldDutyAttendanceUpdateInput = z.infer<typeof fieldDutyAttendanceUpdateSchema>;
export type FieldDutyAssignStudentsInput = z.infer<typeof fieldDutyAssignStudentsSchema>;
export type FieldDutyAssignCoordinatorsInput = z.infer<typeof fieldDutyAssignCoordinatorsSchema>;

/** Helper for UI dropdowns. */
export const FIELD_POSTING_TYPE_OPTIONS = FIELD_POSTING_TYPES.map((key) => ({
  value: key,
  label: key
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ")
}));
