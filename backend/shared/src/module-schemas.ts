import { z } from "zod";
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_STATUSES,
  LIBRARY_YEAR_LEVELS,
  USER_ROLES
} from "./constants.js";
import {
  academicYearSchema,
  bsDateSchema,
  moneySchema,
  objectIdSchema,
  optionalObjectIdSchema,
  optionalPortalPasswordSchema,
  portalLoginIdSchema
} from "./schemas.js";

export const dayOfWeekSchema = z.coerce.number().int().min(0).max(6);

export const timetableSlotSchema = z.object({
  classId: optionalObjectIdSchema,
  sectionId: optionalObjectIdSchema,
  batchId: optionalObjectIdSchema,
  yearId: optionalObjectIdSchema,
  dayOfWeek: dayOfWeekSchema,
  periodNumber: z.coerce.number().int().min(1).max(12),
  subjectId: objectIdSchema,
  teacherId: objectIdSchema,
  /** Optional link to SubjectAssignment for multi-teacher subjects */
  subjectAssignmentId: optionalObjectIdSchema,
  room: z.string().optional().or(z.literal("")),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  academicYearBs: academicYearSchema
});

export const assignmentAttachmentSchema = z.object({
  url: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().optional().or(z.literal("")),
  kind: z.enum(["FILE", "IMAGE", "PDF", "VIDEO", "LINK"]).optional()
});

export const assignmentLinkSchema = z.object({
  title: z.string().min(1),
  url: z
    .string()
    .url()
    .refine(
      (value) => {
        try {
          const parsed = new URL(value);
          return parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "Link URL must use http or https" }
    )
});

export const assignmentSchema = z.object({
  type: z.enum(["HOMEWORK", "CAS", "NOTE"]),
  title: z.string().min(2),
  description: z.string().min(1),
  classId: optionalObjectIdSchema,
  sectionId: optionalObjectIdSchema,
  batchId: optionalObjectIdSchema,
  yearId: optionalObjectIdSchema,
  subjectId: objectIdSchema,
  topic: z.string().optional().or(z.literal("")),
  dueDateBs: bsDateSchema.optional().or(z.literal("")),
  maxMarks: z.coerce.number().min(0).optional(),
  rubric: z.string().optional().or(z.literal("")),
  visibleTo: z.array(z.enum(USER_ROLES)).min(1),
  allowSubmission: z.boolean().default(true),
  isPinned: z.boolean().default(false),
  attachments: z.array(assignmentAttachmentSchema).default([]),
  links: z.array(assignmentLinkSchema).default([])
});

export const assignmentCommentSchema = z.object({
  content: z.string().min(1).max(2000)
});

export const assignmentSubmissionSchema = z.object({
  assignmentId: objectIdSchema,
  studentId: objectIdSchema,
  content: z.string().optional().or(z.literal("")),
  attachmentUrl: z.string().optional().or(z.literal(""))
});

export const gradeSubmissionSchema = z.object({
  marks: z.coerce.number().min(0),
  feedback: z.string().optional().or(z.literal(""))
});

export const parentChildLinkSchema = z.object({
  parentUserId: objectIdSchema,
  studentId: objectIdSchema,
  relationship: z.enum(["FATHER", "MOTHER", "GUARDIAN", "OTHER"]),
  isPrimary: z.boolean().default(false)
});

export const parentFromStudentRelationshipSchema = z.enum(["FATHER", "MOTHER", "GUARDIAN"]);

export const createParentFromStudentSchema = z.object({
  studentId: objectIdSchema,
  relationship: parentFromStudentRelationshipSchema,
  email: portalLoginIdSchema.optional(),
  password: optionalPortalPasswordSchema,
  isPrimary: z.boolean().default(true)
});

export const sendNotificationSchema = z.object({
  recipientUserId: objectIdSchema.optional(),
  recipientPhone: z.string().optional(),
  title: z.string().min(2),
  message: z.string().min(2),
  channel: z.enum(["IN_APP", "SMS", "BOTH"]).default("IN_APP"),
  type: z
    .enum([
      "ATTENDANCE",
      "HOMEWORK",
      "FEE",
      "NOTICE",
      "TRANSPORT",
      "LIBRARY",
      "LABORATORY",
      "PAYROLL",
      "EXAM",
      "COMPLAINT",
      "ACADEMIC_MANAGEMENT",
      "ACADEMIC_CALENDAR",
      "ACADEMIC_PROMOTION",
      "GENERAL"
    ])
    .default("GENERAL")
});

/** One physical copy code entered by the librarian (not auto-generated). */
export const libraryBookCopyInputSchema = z.object({
  bookCode: z.string().trim().min(1, "Book code is required"),
  shelfLocation: z.string().optional().or(z.literal("")),
  condition: z.string().optional().or(z.literal("")),
  /** Publisher / publication for this physical copy. */
  publication: z.string().trim().optional().or(z.literal("")),
  /** Price of this copy in NPR (0 or empty = not set). */
  priceNpr: z.coerce.number().min(0, "Price cannot be negative").optional().default(0)
});

/**
 * Update fields for an existing physical copy.
 * ISSUED status is managed only via issue/return flows — inventory may set
 * AVAILABLE / LOST / DAMAGED / MAINTENANCE when the copy is not currently issued.
 */
export const libraryBookCopyUpdateSchema = z.object({
  bookCode: z.string().trim().min(1, "Book code is required").optional(),
  shelfLocation: z.string().optional().or(z.literal("")),
  condition: z.string().optional().or(z.literal("")),
  publication: z.string().trim().optional().or(z.literal("")),
  priceNpr: z.coerce.number().min(0, "Price cannot be negative").optional(),
  status: z.enum(["AVAILABLE", "LOST", "DAMAGED", "MAINTENANCE"]).optional()
});

export const libraryYearLevelSchema = z.enum(LIBRARY_YEAR_LEVELS);

export const libraryBookSchema = z
  .object({
    title: z.string().min(2),
    author: z.string().min(2),
    isbn: z.string().optional().or(z.literal("")),
    category: z.string().min(1),
    /** Academic year for HA catalog: 1st Year, 2nd Year, 3rd Year, or All Years. */
    yearLevel: libraryYearLevelSchema.default("All Years"),
    totalCopies: z.coerce.number().int().min(1),
    shelfLocation: z.string().optional().or(z.literal("")),
    /**
     * Physical copies with manual codes.
     * When provided on create, length must equal totalCopies and codes must be unique.
     */
    copies: z.array(libraryBookCopyInputSchema).optional()
  })
  .superRefine((value, ctx) => {
    if (!value.copies || value.copies.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a unique book code for every physical copy",
        path: ["copies"]
      });
      return;
    }
    if (value.copies.length !== value.totalCopies) {
      ctx.addIssue({
        code: "custom",
        message: `Provide exactly ${value.totalCopies} book code(s) (one per physical copy)`,
        path: ["copies"]
      });
    }
    const normalized = value.copies.map((c) => c.bookCode.trim().toUpperCase());
    const emptyIdx = normalized.findIndex((c) => !c);
    if (emptyIdx >= 0) {
      ctx.addIssue({
        code: "custom",
        message: "Book code cannot be empty",
        path: ["copies", emptyIdx, "bookCode"]
      });
    }
    const seen = new Set<string>();
    for (let i = 0; i < normalized.length; i++) {
      const code = normalized[i]!;
      if (seen.has(code)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate book code "${value.copies[i]!.bookCode}"`,
          path: ["copies", i, "bookCode"]
        });
      }
      seen.add(code);
    }
  });

/** Partial update of master fields only (copies managed separately when adding). */
export const libraryBookUpdateSchema = z.object({
  title: z.string().min(2).optional(),
  author: z.string().min(2).optional(),
  isbn: z.string().optional().or(z.literal("")),
  category: z.string().min(1).optional(),
  yearLevel: libraryYearLevelSchema.optional(),
  shelfLocation: z.string().optional().or(z.literal("")),
  /** Append new physical copies (each with a unique manual code). */
  addCopies: z.array(libraryBookCopyInputSchema).optional()
});

export const libraryIssueSchema = z
  .object({
    bookId: objectIdSchema,
    /** Preferred: issue a specific physical copy by id. */
    copyId: optionalObjectIdSchema,
    /** Alternative: issue by librarian book code (e.g. ANA003). */
    bookCode: z.string().trim().min(1).optional().or(z.literal("")),
    borrowerType: z.enum(["STUDENT", "TEACHER"]),
    studentId: optionalObjectIdSchema,
    teacherId: optionalObjectIdSchema,
    issuedDateBs: bsDateSchema,
    dueDateBs: bsDateSchema
  })
  .superRefine((value, ctx) => {
    if (value.borrowerType === "STUDENT" && !value.studentId) {
      ctx.addIssue({ code: "custom", message: "studentId is required for student borrowers", path: ["studentId"] });
    }
    if (value.borrowerType === "TEACHER" && !value.teacherId) {
      ctx.addIssue({ code: "custom", message: "teacherId is required for teacher borrowers", path: ["teacherId"] });
    }
    const code = value.bookCode?.trim();
    if (!value.copyId && !code) {
      ctx.addIssue({
        code: "custom",
        message: "Select a physical book copy (book code) to issue",
        path: ["copyId"]
      });
    }
  });

export const moduleStaffSchema = z.object({
  fullName: z.string().min(2),
  email: z.email(),
  phone: z.string().optional().or(z.literal("")),
  password: z.string().min(6).optional()
});

export const libraryReturnSchema = z.object({
  returnedDateBs: bsDateSchema,
  fineNpr: moneySchema.default(0)
});

export const transportStopSchema = z.object({
  name: z.string().min(1),
  pickupTime: z.string().optional().or(z.literal(""))
});

export const transportRouteSchema = z.object({
  name: z.string().min(2),
  vehicleNumber: z.string().min(2),
  driverName: z.string().min(2),
  driverPhone: z.string().min(7),
  stops: z.array(transportStopSchema).min(1),
  monthlyFeeNpr: moneySchema.default(0),
  isActive: z.boolean().default(true)
});

export const transportAssignmentSchema = z.object({
  routeId: objectIdSchema,
  studentId: objectIdSchema,
  pickupStop: z.string().min(1),
  dropStop: z.string().min(1),
  isActive: z.boolean().default(true)
});

export const leaveRequestSchema = z.object({
  teacherId: objectIdSchema,
  type: z.enum(["CASUAL", "SICK", "MATERNITY", "UNPAID", "OTHER"]),
  startDateBs: bsDateSchema,
  endDateBs: bsDateSchema,
  reason: z.string().min(2)
});

export const leaveStatusSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"])
});

// Laboratory schemas are exported only from laboratory-schemas.ts via package index
// (do not re-export here — star-export conflict in Vite/ESM).

export const payrollSchema = z.object({
  teacherId: objectIdSchema,
  monthBs: z.string().regex(/^\d{4}-\d{2}$/),
  basicSalaryNpr: moneySchema,
  allowancesNpr: moneySchema.default(0),
  deductionsNpr: moneySchema.default(0),
  status: z.enum(["DRAFT", "PROCESSED", "PAID"]).default("DRAFT"),
  paidDateBs: bsDateSchema.optional().or(z.literal(""))
});

export type TimetableSlotInput = z.infer<typeof timetableSlotSchema>;
export type AssignmentInput = z.infer<typeof assignmentSchema>;
export type AssignmentCommentInput = z.infer<typeof assignmentCommentSchema>;
export type AssignmentSubmissionInput = z.infer<typeof assignmentSubmissionSchema>;
export type ParentChildLinkInput = z.infer<typeof parentChildLinkSchema>;
export type CreateParentFromStudentInput = z.infer<typeof createParentFromStudentSchema>;
export type SendNotificationInput = z.infer<typeof sendNotificationSchema>;
export type LibraryBookInput = z.infer<typeof libraryBookSchema>;
export type LibraryBookUpdateInput = z.infer<typeof libraryBookUpdateSchema>;
export type LibraryBookCopyInput = z.infer<typeof libraryBookCopyInputSchema>;
export type LibraryBookCopyUpdateInput = z.infer<typeof libraryBookCopyUpdateSchema>;
export type LibraryIssueInput = z.infer<typeof libraryIssueSchema>;
export type ModuleStaffInput = z.infer<typeof moduleStaffSchema>;
export type TransportRouteInput = z.infer<typeof transportRouteSchema>;
export type TransportAssignmentInput = z.infer<typeof transportAssignmentSchema>;
export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>;
export type PayrollInput = z.infer<typeof payrollSchema>;

export const createComplaintSchema = z.object({
  subject: z.string().trim().min(3, "Subject must be at least 3 characters").max(200),
  category: z.enum(COMPLAINT_CATEGORIES),
  content: z.string().trim().min(10, "Please describe your complaint in at least 10 characters").max(5000),
  attachments: z.array(assignmentAttachmentSchema).max(5).default([])
});

export const updateComplaintStatusSchema = z.object({
  status: z.enum(COMPLAINT_STATUSES),
  adminResponse: z.string().trim().max(2000).optional().or(z.literal(""))
});

export type CreateComplaintInput = z.infer<typeof createComplaintSchema>;
export type UpdateComplaintStatusInput = z.infer<typeof updateComplaintStatusSchema>;