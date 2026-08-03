import { z } from "zod";
import { bsDateSchema, objectIdSchema, optionalObjectIdSchema } from "./schemas.js";

const bsMonthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "Month must be YYYY-MM (BS)");

export const fieldHospitalSchema = z.object({
  name: z.string().trim().min(2).max(200),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  contact: z.string().trim().max(100).optional().or(z.literal("")),
  coordinatorStaffId: optionalObjectIdSchema,
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  remarks: z.string().trim().max(1000).optional().or(z.literal("")),
});

export const fieldHospitalUpdateSchema = fieldHospitalSchema.partial();

export const hospitalDepartmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  shortCode: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform((v) => v.toUpperCase()),
  sortOrder: z.number().int().min(0).max(9999).optional().default(100),
  isActive: z.boolean().optional().default(true),
});

export const hospitalDepartmentUpdateSchema = hospitalDepartmentSchema.partial();

export const dutyShiftSchema = z.object({
  name: z.string().trim().min(1).max(80),
  shortCode: z
    .string()
    .trim()
    .min(1)
    .max(12)
    .transform((v) => v.toUpperCase()),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Use HH:mm"),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Use HH:mm"),
  dutyHours: z.number().min(0).max(24),
  sortOrder: z.number().int().min(0).max(9999).optional().default(100),
  isActive: z.boolean().optional().default(true),
  color: z.string().trim().max(32).optional().or(z.literal("")),
});

export const dutyShiftUpdateSchema = dutyShiftSchema.partial();

export const rosterDutyCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform((v) => v.trim()),
  label: z.string().trim().min(1).max(80),
  sortOrder: z.number().int().min(0).max(9999).optional().default(100),
  isActive: z.boolean().optional().default(true),
  isLeave: z.boolean().optional().default(false),
  isOff: z.boolean().optional().default(false),
  color: z.string().trim().max(32).optional().or(z.literal("")),
});

export const rosterDutyCodeUpdateSchema = rosterDutyCodeSchema.partial();

export const hospitalRosterCellSchema = z.object({
  studentId: objectIdSchema,
  /** Day index within the roster period (1 = start date). Max 93 days. */
  day: z.number().int().min(1).max(93),
  shiftId: optionalObjectIdSchema,
  departmentId: optionalObjectIdSchema,
  code: z.string().trim().max(20).optional().or(z.literal("")),
  remarks: z.string().trim().max(200).optional().or(z.literal("")),
});

const hospitalRosterBaseFields = {
  name: z.string().trim().min(2).max(200),
  academicYearBs: z.string().trim().min(4).max(20),
  program: z.string().trim().max(80).optional().or(z.literal("")),
  batchId: objectIdSchema,
  yearId: objectIdSchema,
  sectionId: optionalObjectIdSchema,
  hospitalId: objectIdSchema,
  /** Preferred: inclusive From date (BS YYYY-MM-DD). */
  startDateBs: bsDateSchema.optional().or(z.literal("")),
  /** Preferred: inclusive To date (BS YYYY-MM-DD). */
  endDateBs: bsDateSchema.optional().or(z.literal("")),
  /** Legacy: BS month YYYY-MM (used when start/end not provided). */
  monthBs: bsMonthSchema.optional(),
  /** Inclusive days in period; computed from start/end when omitted. */
  daysInMonth: z.number().int().min(1).max(93).optional(),
  coordinatorStaffId: optionalObjectIdSchema,
  remarks: z.string().trim().max(1000).optional().or(z.literal("")),
  /** If empty, backend loads all active students for batch+year. */
  studentIds: z.array(objectIdSchema).optional().default([]),
};

export const hospitalRosterSchema = z
  .object(hospitalRosterBaseFields)
  .superRefine((data, ctx) => {
    const hasRange =
      Boolean(data.startDateBs?.trim()) && Boolean(data.endDateBs?.trim());
    const hasMonth = Boolean(data.monthBs?.trim());
    if (!hasRange && !hasMonth) {
      ctx.addIssue({
        code: "custom",
        message: "Provide From–To dates (startDateBs & endDateBs) or a month (monthBs)",
        path: ["startDateBs"],
      });
    }
  });

/** Partial updates — do not require period fields on every PATCH. */
export const hospitalRosterUpdateSchema = z
  .object(hospitalRosterBaseFields)
  .partial()
  .extend({
    preparedByName: z.string().trim().max(120).optional().or(z.literal("")),
    approvedByName: z.string().trim().max(120).optional().or(z.literal("")),
    status: z.enum(["DRAFT", "PUBLISHED", "LOCKED"]).optional(),
  });

export const hospitalRosterCellsUpdateSchema = z.object({
  cells: z.array(hospitalRosterCellSchema),
  /** Replace entire cells array when true (default). Merge when false. */
  replace: z.boolean().optional().default(true),
});

export const hospitalRosterStudentsUpdateSchema = z.object({
  studentIds: z.array(objectIdSchema).min(0),
});

export type FieldHospitalInput = z.infer<typeof fieldHospitalSchema>;
export type HospitalDepartmentInput = z.infer<typeof hospitalDepartmentSchema>;
export type DutyShiftInput = z.infer<typeof dutyShiftSchema>;
export type RosterDutyCodeInput = z.infer<typeof rosterDutyCodeSchema>;
export type HospitalRosterInput = z.infer<typeof hospitalRosterSchema>;
export type HospitalRosterUpdateInput = z.infer<typeof hospitalRosterUpdateSchema>;
export type HospitalRosterCellsUpdateInput = z.infer<
  typeof hospitalRosterCellsUpdateSchema
>;
