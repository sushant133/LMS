import { z } from "zod";
import { SUBJECT_ASSIGNMENT_STATUSES, SUBJECT_ASSIGNMENT_TYPES } from "./constants.js";
import { academicYearSchema, bsDateSchema, objectIdSchema, optionalObjectIdSchema } from "./schemas.js";

const assignmentTypeSchema = z.enum(SUBJECT_ASSIGNMENT_TYPES);
const assignmentStatusSchema = z.enum(SUBJECT_ASSIGNMENT_STATUSES);

const refineAssignmentTypeFields = (
  value: {
    assignmentType: (typeof SUBJECT_ASSIGNMENT_TYPES)[number];
    unitFrom?: number | null;
    unitTo?: number | null;
    assignedPercentage?: number | null;
  },
  ctx: z.RefinementCtx
): void => {
  if (value.assignmentType === "UNIT") {
    if (value.unitFrom == null || value.unitTo == null) {
      ctx.addIssue({ code: "custom", message: "unitFrom and unitTo are required for UNIT assignments", path: ["unitFrom"] });
      return;
    }
    if (value.unitFrom > value.unitTo) {
      ctx.addIssue({ code: "custom", message: "unitFrom must be ≤ unitTo", path: ["unitTo"] });
    }
    if (value.assignedPercentage != null) {
      ctx.addIssue({
        code: "custom",
        message: "assignedPercentage must be empty for UNIT assignments",
        path: ["assignedPercentage"]
      });
    }
  } else if (value.assignmentType === "PERCENTAGE") {
    if (value.assignedPercentage == null) {
      ctx.addIssue({
        code: "custom",
        message: "assignedPercentage is required for PERCENTAGE assignments",
        path: ["assignedPercentage"]
      });
    } else if (value.assignedPercentage < 1 || value.assignedPercentage > 99) {
      ctx.addIssue({
        code: "custom",
        message: "assignedPercentage must be 1–99 (use FULL for 100%)",
        path: ["assignedPercentage"]
      });
    }
    if (value.unitFrom != null || value.unitTo != null) {
      ctx.addIssue({ code: "custom", message: "unit range must be empty for PERCENTAGE assignments", path: ["unitFrom"] });
    }
  } else {
    // FULL
    if (value.unitFrom != null || value.unitTo != null) {
      ctx.addIssue({ code: "custom", message: "unit range must be empty for FULL assignments", path: ["unitFrom"] });
    }
    if (value.assignedPercentage != null) {
      ctx.addIssue({
        code: "custom",
        message: "assignedPercentage must be empty for FULL assignments",
        path: ["assignedPercentage"]
      });
    }
  }
};

export const subjectAssignmentCreateSchema = z
  .object({
    academicYearBs: academicYearSchema,
    faculty: z.string().trim().optional().nullable(),
    semesterBs: z.string().trim().optional().nullable(),
    classId: optionalObjectIdSchema,
    sectionId: optionalObjectIdSchema,
    batchId: optionalObjectIdSchema,
    yearId: optionalObjectIdSchema,
    subjectId: objectIdSchema,
    teacherId: objectIdSchema,
    assignmentType: assignmentTypeSchema,
    unitFrom: z.coerce.number().int().positive().optional().nullable(),
    unitTo: z.coerce.number().int().positive().optional().nullable(),
    assignedPercentage: z.coerce.number().int().min(1).max(99).optional().nullable(),
    effectiveFromBs: bsDateSchema,
    effectiveToBs: bsDateSchema.optional().nullable(),
    remarks: z.string().trim().max(2000).optional().or(z.literal(""))
  })
  .superRefine(refineAssignmentTypeFields);

export const subjectAssignmentBulkRowSchema = z
  .object({
    teacherId: objectIdSchema,
    assignmentType: assignmentTypeSchema,
    unitFrom: z.coerce.number().int().positive().optional().nullable(),
    unitTo: z.coerce.number().int().positive().optional().nullable(),
    assignedPercentage: z.coerce.number().int().min(1).max(99).optional().nullable(),
    remarks: z.string().trim().max(2000).optional().or(z.literal(""))
  })
  .superRefine(refineAssignmentTypeFields);

export const subjectAssignmentBulkSchema = z.object({
  academicYearBs: academicYearSchema,
  faculty: z.string().trim().optional().nullable(),
  semesterBs: z.string().trim().optional().nullable(),
  classId: optionalObjectIdSchema,
  sectionId: optionalObjectIdSchema,
  batchId: optionalObjectIdSchema,
  yearId: optionalObjectIdSchema,
  subjectId: objectIdSchema,
  effectiveFromBs: bsDateSchema,
  teachers: z.array(subjectAssignmentBulkRowSchema).min(1).max(20)
});

export const subjectAssignmentUpdateSchema = z
  .object({
    faculty: z.string().trim().optional().nullable(),
    semesterBs: z.string().trim().optional().nullable(),
    assignmentType: assignmentTypeSchema.optional(),
    unitFrom: z.coerce.number().int().positive().optional().nullable(),
    unitTo: z.coerce.number().int().positive().optional().nullable(),
    assignedPercentage: z.coerce.number().int().min(1).max(99).optional().nullable(),
    effectiveFromBs: bsDateSchema.optional(),
    remarks: z.string().trim().max(2000).optional().or(z.literal(""))
  })
  .superRefine((value, ctx) => {
    if (!value.assignmentType) return;
    refineAssignmentTypeFields(
      {
        assignmentType: value.assignmentType,
        unitFrom: value.unitFrom,
        unitTo: value.unitTo,
        assignedPercentage: value.assignedPercentage
      },
      ctx
    );
  });

export const subjectAssignmentEndSchema = z.object({
  effectiveToBs: bsDateSchema,
  endReason: z.string().trim().min(1).max(1000).optional().or(z.literal(""))
});

export const subjectAssignmentReassignSchema = z
  .object({
    teacherId: objectIdSchema,
    assignmentType: assignmentTypeSchema.optional(),
    unitFrom: z.coerce.number().int().positive().optional().nullable(),
    unitTo: z.coerce.number().int().positive().optional().nullable(),
    assignedPercentage: z.coerce.number().int().min(1).max(99).optional().nullable(),
    effectiveFromBs: bsDateSchema,
    effectiveToBs: bsDateSchema.optional().nullable(),
    remarks: z.string().trim().max(2000).optional().or(z.literal("")),
    endReason: z.string().trim().max(1000).optional().or(z.literal(""))
  })
  .superRefine((value, ctx) => {
    if (!value.assignmentType) return;
    refineAssignmentTypeFields(
      {
        assignmentType: value.assignmentType,
        unitFrom: value.unitFrom,
        unitTo: value.unitTo,
        assignedPercentage: value.assignedPercentage
      },
      ctx
    );
  });

export const subjectAssignmentQuerySchema = z.object({
  academicYearBs: z.string().trim().optional(),
  status: z
    .string()
    .trim()
    .optional()
    .transform((value) => {
      if (!value) return undefined;
      return value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
    })
    .pipe(z.array(assignmentStatusSchema).optional()),
  subjectId: optionalObjectIdSchema,
  teacherId: optionalObjectIdSchema,
  classId: optionalObjectIdSchema,
  sectionId: optionalObjectIdSchema,
  batchId: optionalObjectIdSchema,
  yearId: optionalObjectIdSchema,
  faculty: z.string().trim().optional()
});

export const subjectAssignmentCopyYearSchema = z.object({
  fromAcademicYearBs: academicYearSchema,
  toAcademicYearBs: academicYearSchema,
  teacherIds: z.array(objectIdSchema).optional()
});

export const subjectAssignmentAcceptMigrationSchema = z.object({
  confirmEmpty: z.boolean().optional()
});

export type SubjectAssignmentCreateInput = z.infer<typeof subjectAssignmentCreateSchema>;
export type SubjectAssignmentBulkInput = z.infer<typeof subjectAssignmentBulkSchema>;
export type SubjectAssignmentUpdateInput = z.infer<typeof subjectAssignmentUpdateSchema>;
export type SubjectAssignmentEndInput = z.infer<typeof subjectAssignmentEndSchema>;
export type SubjectAssignmentReassignInput = z.infer<typeof subjectAssignmentReassignSchema>;
export type SubjectAssignmentQueryInput = z.infer<typeof subjectAssignmentQuerySchema>;
export type SubjectAssignmentCopyYearInput = z.infer<typeof subjectAssignmentCopyYearSchema>;
