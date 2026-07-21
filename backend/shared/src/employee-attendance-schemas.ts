import { z } from "zod";
import {
  EMPLOYEE_ATTENDANCE_CATEGORIES,
  EMPLOYEE_ATTENDANCE_SOURCES,
  EMPLOYEE_ATTENDANCE_STATUSES
} from "./employee-attendance-types.js";

const objectId = z.string().min(1);
const timeHm = z
  .string()
  .optional()
  .or(z.literal(""))
  .refine(
    (v) => !v || /^([01]\d|2[0-3]):[0-5]\d$/.test(v),
    "Use HH:mm format (e.g. 09:30)"
  );

export const employeeAttendanceCategorySchema = z.enum(EMPLOYEE_ATTENDANCE_CATEGORIES);
export const employeeAttendanceStatusSchema = z.enum(EMPLOYEE_ATTENDANCE_STATUSES);
export const employeeAttendanceSourceSchema = z.enum(EMPLOYEE_ATTENDANCE_SOURCES);

export const employeeAttendanceEntrySchema = z
  .object({
    teacherId: objectId.optional(),
    staffId: objectId.optional(),
    employeeUserId: objectId.optional(),
    employeeCode: z.string().min(1),
    fullName: z.string().min(1),
    department: z.string().optional().or(z.literal("")),
    designation: z.string().optional().or(z.literal("")),
    status: employeeAttendanceStatusSchema,
    checkInTime: timeHm,
    checkOutTime: timeHm,
    remarks: z.string().optional().or(z.literal("")),
    source: employeeAttendanceSourceSchema.optional().default("MANUAL"),
    deviceId: z.string().optional().or(z.literal("")),
    externalRef: z.string().optional().or(z.literal("")),
    geo: z
      .object({
        lat: z.number().optional(),
        lng: z.number().optional()
      })
      .optional()
  })
  .superRefine((data, ctx) => {
    if (!data.teacherId && !data.staffId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "teacherId or staffId is required",
        path: ["teacherId"]
      });
    }
  });

export const employeeAttendanceSubmitSchema = z.object({
  category: employeeAttendanceCategorySchema,
  dateBs: z.string().min(1),
  entries: z.array(employeeAttendanceEntrySchema).min(1),
  notes: z.string().optional().or(z.literal("")),
  /** When true, save as DRAFT without locking. Default false → LOCKED on submit. */
  asDraft: z.boolean().optional().default(false),
  sourceDefault: employeeAttendanceSourceSchema.optional().default("MANUAL")
});

export const employeeAttendanceUpdateSchema = z.object({
  entries: z.array(employeeAttendanceEntrySchema).min(1),
  notes: z.string().optional().or(z.literal(""))
});

export const employeeAttendanceUnlockSchema = z.object({
  reason: z.string().min(2)
});

export type EmployeeAttendanceSubmitInput = z.infer<typeof employeeAttendanceSubmitSchema>;
export type EmployeeAttendanceUpdateInput = z.infer<typeof employeeAttendanceUpdateSchema>;
