import { z } from "zod";

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

export const fieldDutyScheduleSchema = z.object({
  academicYearBs: z.string().min(1),
  faculty: z.string().optional().or(z.literal("")),
  batchId: objectId,
  yearId: objectId,
  sectionId: z.string().optional().or(z.literal("")),
  hospitalName: z.string().min(1),
  department: z.string().min(1),
  ward: z.string().optional().or(z.literal("")),
  /** Field supervisor is college staff (not a teacher). */
  supervisorStaffId: objectId,
  clinicalInstructorName: z.string().optional().or(z.literal("")),
  hospitalSupervisorName: z.string().optional().or(z.literal("")),
  startDateBs: z.string().min(1),
  endDateBs: z.string().min(1),
  shift: fieldDutyShiftSchema.default("DAY"),
  remarks: z.string().optional().or(z.literal("")),
  status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]).default("ACTIVE")
});

export const fieldDutyAttendanceEntrySchema = z.object({
  studentId: objectId,
  status: fieldDutyStudentStatusSchema,
  remarks: z.string().optional().or(z.literal(""))
});

export const fieldDutyAttendanceSubmitSchema = z.object({
  scheduleId: objectId,
  dateBs: z.string().min(1),
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

export type FieldDutyScheduleInput = z.infer<typeof fieldDutyScheduleSchema>;
export type FieldDutyAttendanceSubmitInput = z.infer<typeof fieldDutyAttendanceSubmitSchema>;
export type FieldDutyAttendanceUpdateInput = z.infer<typeof fieldDutyAttendanceUpdateSchema>;
