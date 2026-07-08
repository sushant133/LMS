import { z } from "zod";
import { COMPLAINT_CATEGORIES, COMPLAINT_STATUSES, LABORATORY_TYPES, USER_ROLES } from "./constants.js";
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
  url: z.string().url()
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
    .enum(["ATTENDANCE", "HOMEWORK", "FEE", "NOTICE", "TRANSPORT", "LIBRARY", "LABORATORY", "PAYROLL", "GENERAL"])
    .default("GENERAL")
});

export const libraryBookSchema = z.object({
  title: z.string().min(2),
  author: z.string().min(2),
  isbn: z.string().optional().or(z.literal("")),
  category: z.string().min(1),
  totalCopies: z.coerce.number().int().min(1),
  shelfLocation: z.string().optional().or(z.literal(""))
});

export const libraryIssueSchema = z
  .object({
    bookId: objectIdSchema,
    borrowerType: z.enum(["STUDENT", "TEACHER"]),
    studentId: objectIdSchema.optional(),
    teacherId: objectIdSchema.optional(),
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

export const laboratorySchema = z
  .object({
    type: z.enum(LABORATORY_TYPES),
    customName: z.string().optional().or(z.literal("")),
    isActive: z.boolean().default(true)
  })
  .superRefine((value, ctx) => {
    if (value.type === "OTHER" && !value.customName?.trim()) {
      ctx.addIssue({ code: "custom", message: "Custom laboratory name is required", path: ["customName"] });
    }
  });

export const laboratoryCategorySchema = z.object({
  name: z.string().min(1)
});

export const laboratoryEquipmentSchema = z.object({
  laboratoryId: objectIdSchema,
  categoryId: objectIdSchema,
  name: z.string().min(2),
  itemCode: z.string().min(1),
  quantity: z.coerce.number().int().min(1),
  description: z.string().optional().or(z.literal(""))
});

export const laboratoryIssueSchema = z.object({
  equipmentId: objectIdSchema,
  teacherId: objectIdSchema,
  quantity: z.coerce.number().int().min(1).default(1),
  issuedDateBs: bsDateSchema,
  dueDateBs: bsDateSchema
});

export const laboratoryReturnSchema = z.object({
  returnedDateBs: bsDateSchema,
  quantity: z.coerce.number().int().min(1).optional()
});

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
export type LibraryIssueInput = z.infer<typeof libraryIssueSchema>;
export type ModuleStaffInput = z.infer<typeof moduleStaffSchema>;
export type LaboratoryInput = z.infer<typeof laboratorySchema>;
export type LaboratoryCategoryInput = z.infer<typeof laboratoryCategorySchema>;
export type LaboratoryEquipmentInput = z.infer<typeof laboratoryEquipmentSchema>;
export type LaboratoryIssueInput = z.infer<typeof laboratoryIssueSchema>;
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