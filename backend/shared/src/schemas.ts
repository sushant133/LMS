import { z } from "zod";
import {
  BANNER_PRIORITIES,
  BANNER_TARGET_ROLES,
  BLOOD_GROUPS,
  CLASS_LEVELS,
  COLLEGE_STAFF_CATEGORIES,
  DISABILITY_CATEGORIES,
  EMPLOYMENT_TYPES,
  ETHNICITY_CATEGORIES,
  EXAM_ATTENDANCE_STATUSES,
  EXAM_STATUSES,
  RESULT_SUBMISSION_STATUSES,
  INSTITUTION_TYPES,
  PUBLIC_REGISTER_ROLES,
  USER_ROLES
} from "./constants.js";

export const objectIdSchema = z.string().trim().regex(/^[a-f\d]{24}$/i, "Invalid identifier");

/** Accepts empty form values and normalizes them to undefined for optional MongoDB refs. */
export const optionalObjectIdSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  objectIdSchema.optional()
);

export const bsDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in BS format YYYY-MM-DD");

export const academicYearSchema = z
  .string()
  .trim()
  .regex(/^\d{4}\/\d{4}$/, "Academic year must be in BS format YYYY/YYYY");

export const moneySchema = z.coerce.number().min(0, "Amount cannot be negative");

export const addressSchema = z.object({
  province: z.string().min(1),
  district: z.string().min(1),
  municipality: z.string().min(1),
  ward: z.string().min(1),
  streetAddress: z.string().min(1)
});

const isValidPortalLoginId = (value: string): boolean => {
  if (z.email().safeParse(value).success) {
    return true;
  }

  return /^[a-z0-9][a-z0-9._-]{2,63}$/.test(value);
};

/** Email or simple username used as the portal login ID (stored on the user account). */
export const portalLoginIdSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z
    .string()
    .min(3, "Login ID must be at least 3 characters")
    .max(100, "Login ID is too long")
    .refine(isValidPortalLoginId, {
      message: "Enter a valid login ID"
    })
);

export const portalPasswordSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : value),
  z.string().min(6, "Password must be at least 6 characters")
);

export const optionalPortalPasswordSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : typeof value === "string" ? value.trim() : value),
  z.string().min(6, "Password must be at least 6 characters").optional()
);

export const loginSchema = z.object({
  email: portalLoginIdSchema,
  password: portalPasswordSchema
});

export const registerSchema = z.object({
  schoolId: objectIdSchema,
  fullName: z.string().min(2),
  email: portalLoginIdSchema,
  password: portalPasswordSchema,
  phone: z.string().optional().or(z.literal("")),
  role: z.enum(PUBLIC_REGISTER_ROLES).default("PARENT")
});

/** Public parent self-registration — requires student admission number; admin must approve */
export const parentSelfRegisterSchema = z.object({
  schoolId: objectIdSchema,
  fullName: z.string().min(2, "Full name is required"),
  email: portalLoginIdSchema,
  password: portalPasswordSchema,
  phone: z.string().min(7, "Phone number is required"),
  studentRegistrationNumber: z
    .string()
    .min(1, "Student registration number is required")
    .transform((value) => value.trim().toUpperCase()),
  relationship: z.enum(["FATHER", "MOTHER", "GUARDIAN", "OTHER"])
});

export const activeSchoolSchema = z.object({
  schoolId: objectIdSchema
});

export const schoolSchema = z.object({
  name: z.string().min(2),
  nameNp: z.string().min(2),
  code: z.string().min(2).max(20),
  email: z.email(),
  phone: z.string().min(7),
  principalName: z.string().min(2),
  academicYearBs: academicYearSchema,
  institutionType: z.enum(INSTITUTION_TYPES).default("SCHOOL"),
  address: addressSchema,
  isActive: z.boolean().default(true)
});

export const createSchoolSchema = schoolSchema.extend({
  adminFullName: z.string().min(2),
  adminEmail: z.email(),
  adminPhone: z.string().min(7)
});

export const updateSchoolSchema = schoolSchema;

export const studentSchema = z.object({
  fullName: z.string().min(2),
  email: portalLoginIdSchema,
  phone: z.string().optional().or(z.literal("")),
  password: optionalPortalPasswordSchema,
  admissionNumber: z.string().min(1),
  rollNumber: z.coerce.number().min(1),
  classId: optionalObjectIdSchema,
  sectionId: optionalObjectIdSchema,
  batchId: optionalObjectIdSchema,
  yearId: optionalObjectIdSchema,
  admissionDateBs: bsDateSchema,
  dateOfBirthBs: bsDateSchema,
  gender: z.string().min(1),
  bloodGroup: z.enum(BLOOD_GROUPS).optional(),
  disabilityCategory: z.enum(DISABILITY_CATEGORIES).optional(),
  ethnicityCategory: z.enum(ETHNICITY_CATEGORIES).optional(),
  address: addressSchema,
  fatherName: z.string().min(2),
  fatherPhone: z.string().min(7).optional().or(z.literal("")),
  motherName: z.string().min(2),
  motherPhone: z.string().min(7).optional().or(z.literal("")),
  guardianName: z.string().min(2),
  guardianPhone: z.string().min(7),
  feesDueNpr: moneySchema,
  remarks: z.string().optional(),
  // Phase 0 foundation fields (optional for backward compatibility)
  photoUrl: z.string().optional().or(z.literal("")),
  documents: z
    .array(
      z.object({
        _id: z.string().optional(),
        type: z.string(),
        name: z.string(),
        url: z.string(),
        originalName: z.string(),
        mimeType: z.string().optional(),
        size: z.number().min(0),
        status: z.enum(["UPLOADED", "VERIFIED", "REJECTED", "PENDING"]).default("UPLOADED"),
        uploadedAt: z.string(),
        uploadedBy: z.string(),
        uploadedByName: z.string().optional(),
        notes: z.string().optional()
      })
    )
    .optional()
});

export const teacherSchema = z.object({
  fullName: z.string().min(2),
  email: portalLoginIdSchema,
  phone: z.string().optional().or(z.literal("")),
  password: optionalPortalPasswordSchema,
  teacherCode: z.string().min(1),
  qualification: z.string().min(2),
  joinedDateBs: bsDateSchema,
  address: addressSchema,
  subjects: z.array(objectIdSchema).default([]),
  assignedClassIds: z.array(objectIdSchema).default([]),
  assignedSectionIds: z.array(objectIdSchema).default([]),
  assignedBatchIds: z.array(objectIdSchema).default([]),
  assignedYearIds: z.array(objectIdSchema).default([]),
  basicSalaryNpr: moneySchema
});

export const collegeStaffSchema = z
  .object({
    fullName: z.string().min(2),
    email: z.string().optional().or(z.literal("")),
    phone: z.string().min(7),
    password: optionalPortalPasswordSchema,
    enableLogin: z.boolean().default(false),
    staffId: z.string().min(1),
    photoUrl: z.string().optional().or(z.literal("")),
    gender: z.string().min(1),
    dateOfBirthBs: bsDateSchema.optional().or(z.literal("")),
    address: addressSchema,
    joinedDateBs: bsDateSchema,
    designation: z.string().min(1),
    category: z.enum(COLLEGE_STAFF_CATEGORIES),
    employmentType: z.enum(EMPLOYMENT_TYPES).default("FULL_TIME"),
    basicSalaryNpr: moneySchema.default(0),
    status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE")
  })
  .superRefine((value, ctx) => {
    if (value.enableLogin && !value.email?.trim()) {
      ctx.addIssue({ code: "custom", message: "Email is required when login is enabled", path: ["email"] });
    }
  });

export const classSchema = z.object({
  name: z.string().min(1),
  level: z.enum(CLASS_LEVELS),
  academicYearBs: academicYearSchema,
  coordinatorId: objectIdSchema.optional().or(z.literal("")),
  isActive: z.boolean().default(true)
});

export const sectionSchema = z.object({
  name: z.string().min(1),
  classId: objectIdSchema,
  room: z.string().optional(),
  capacity: z.coerce.number().min(1),
  classTeacherId: objectIdSchema.optional().or(z.literal(""))
});

export const batchSchema = z.object({
  name: z.string().min(1),
  academicYearBs: academicYearSchema,
  isActive: z.boolean().default(true)
});

export const yearSchema = z.object({
  batchId: objectIdSchema,
  name: z.string().min(1),
  level: z.coerce.number().min(1).max(3),
  isActive: z.boolean().default(true)
});

export const academicSubjectSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  classIds: z.array(objectIdSchema).default([]),
  yearIds: z.array(objectIdSchema).default([])
});

export const masterSubjectSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  yearLevel: z.coerce.number().min(1).max(3),
  creditHours: z.coerce.number().min(0).optional(),
  theoryMarks: z.coerce.number().min(0),
  practicalMarks: z.coerce.number().min(0).optional(),
  internalMarks: z.coerce.number().min(0).optional(),
  passMarks: z.coerce.number().min(0),
  fullMarks: z.coerce.number().min(1),
  isActive: z.boolean().default(true)
});

export const subjectSchema = academicSubjectSchema.extend({
  teacherIds: z.array(objectIdSchema).default([]),
  creditHours: z.coerce.number().min(0).optional(),
  theoryMarks: z.coerce.number().min(0).optional(),
  practicalMarks: z.coerce.number().min(0).optional(),
  internalMarks: z.coerce.number().min(0).optional(),
  fullMarks: z.coerce.number().min(1).default(100),
  passMarks: z.coerce.number().min(0).default(35),
  isActive: z.boolean().default(true)
});

export const attendanceSchema = z.object({
  classId: objectIdSchema.optional(),
  sectionId: objectIdSchema.optional(),
  batchId: objectIdSchema.optional(),
  yearId: objectIdSchema.optional(),
  subjectId: objectIdSchema,
  dateBs: bsDateSchema,
  entries: z.array(
    z.object({
      studentId: objectIdSchema,
      status: z.enum(["PRESENT", "ABSENT", "LEAVE", "LATE"])
    })
  )
});

export const examSchema = z.object({
  name: z.string().min(1),
  academicYearBs: academicYearSchema,
  startDateBs: bsDateSchema,
  endDateBs: bsDateSchema,
  resultPublishDateBs: bsDateSchema.optional().or(z.literal("")),
  status: z.enum(EXAM_STATUSES).default("DRAFT"),
  classIds: z.array(objectIdSchema).default([]),
  batchIds: z.array(objectIdSchema).default([]),
  yearIds: z.array(objectIdSchema).default([])
});

export const examRoutineSchema = z.object({
  subjectId: objectIdSchema,
  examDateBs: bsDateSchema,
  day: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  durationMinutes: z.coerce.number().min(1),
  examHall: z.string().optional().or(z.literal("")),
  invigilator: z.string().optional().or(z.literal("")),
  remarks: z.string().optional().or(z.literal(""))
});

export const resultMarkSchema = z.object({
  subjectId: objectIdSchema,
  fullMarks: z.coerce.number().min(1),
  passMarks: z.coerce.number().min(0),
  theoryMarks: z.coerce.number().min(0).optional(),
  practicalMarks: z.coerce.number().min(0).optional(),
  internalMarks: z.coerce.number().min(0).optional(),
  attendanceStatus: z.enum(EXAM_ATTENDANCE_STATUSES).default("PRESENT"),
  teacherRemarks: z.string().optional().or(z.literal(""))
});

export const resultSchema = z.object({
  examId: objectIdSchema,
  studentId: objectIdSchema,
  classId: optionalObjectIdSchema,
  sectionId: optionalObjectIdSchema,
  batchId: optionalObjectIdSchema,
  yearId: optionalObjectIdSchema,
  marks: z.array(resultMarkSchema)
});

export const resultSubmissionScopeSchema = z.object({
  examId: objectIdSchema,
  subjectId: objectIdSchema,
  classId: optionalObjectIdSchema,
  sectionId: optionalObjectIdSchema,
  batchId: optionalObjectIdSchema,
  yearId: optionalObjectIdSchema
});

export const resultSubmissionReviewSchema = z.object({
  comments: z.string().optional().or(z.literal(""))
});

export const feeStructureSchema = z.object({
  title: z.string().min(1),
  classIds: z.array(objectIdSchema).default([]),
  feeType: z.enum(["ADMISSION", "TUITION", "MONTHLY", "EXAM", "LIBRARY", "LAB", "TRANSPORT", "HOSTEL", "OTHER", "ANNUAL"]),
  frequency: z.enum(["MONTHLY", "ANNUAL", "ONE_TIME"]),
  academicYearBs: academicYearSchema,
  amountNpr: moneySchema,
  isOptional: z.boolean().default(false)
});

export const feeCollectionSchema = z.object({
  studentId: objectIdSchema,
  feeStructureId: objectIdSchema,
  receiptNumber: z.string().min(1),
  paidDateBs: bsDateSchema,
  amountPaidNpr: moneySchema,
  discountNpr: moneySchema.default(0),
  scholarshipNpr: moneySchema.default(0),
  lateFeeNpr: moneySchema.default(0),
  notes: z.string().optional()
});

export const noticeSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  visibleTo: z.array(z.enum(USER_ROLES)).min(1),
  publishDateBs: bsDateSchema,
  expiresAtBs: bsDateSchema.optional().or(z.literal("")),
  subjectId: objectIdSchema.optional(),
  classId: objectIdSchema.optional(),
  sectionId: objectIdSchema.optional()
});

export const bannerSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  imageUrl: z.string().optional().or(z.literal("")),
  buttonText: z.string().optional().or(z.literal("")),
  buttonUrl: z.union([z.url(), z.literal("")]).optional(),
  backgroundColor: z.string().optional().or(z.literal("")),
  textColor: z.string().optional().or(z.literal("")),
  priority: z.enum(BANNER_PRIORITIES).default("MEDIUM"),
  startAt: z.string().min(1),
  endAt: z.string().min(1),
  isActive: z.boolean().default(true),
  showOnce: z.boolean().default(false),
  dismissible: z.boolean().default(true),
  targetRoles: z.array(z.enum(BANNER_TARGET_ROLES)).min(1)
});

export const infrastructureSchema = z.object({
  classrooms: z.coerce.number().min(0).default(0),
  usableClassrooms: z.coerce.number().min(0).default(0),
  toiletsMale: z.coerce.number().min(0).default(0),
  toiletsFemale: z.coerce.number().min(0).default(0),
  toiletsDisabled: z.coerce.number().min(0).default(0),
  drinkingWater: z.boolean().default(false),
  electricity: z.boolean().default(false),
  internet: z.boolean().default(false),
  libraryBooks: z.coerce.number().min(0).default(0),
  hasScienceLab: z.boolean().default(false),
  hasComputerLab: z.boolean().default(false),
  hasPlayground: z.boolean().default(false),
  hasRamp: z.boolean().default(false),
  midDayMeal: z.boolean().default(false)
}).default(() => ({
  classrooms: 0,
  usableClassrooms: 0,
  toiletsMale: 0,
  toiletsFemale: 0,
  toiletsDisabled: 0,
  drinkingWater: false,
  electricity: false,
  internet: false,
  libraryBooks: 0,
  hasScienceLab: false,
  hasComputerLab: false,
  hasPlayground: false,
  hasRamp: false,
  midDayMeal: false
}));

export const adminAccountSchema = z.object({
  fullName: z.string().min(2),
  email: portalLoginIdSchema,
  phone: z.string().optional().or(z.literal("")),
  password: optionalPortalPasswordSchema
});

export const adminAccountUpdateSchema = adminAccountSchema.partial().extend({
  fullName: z.string().min(2).optional(),
  email: portalLoginIdSchema.optional()
});

export const adminPasswordResetSchema = z.object({
  password: portalPasswordSchema,
  mustChangePassword: z.boolean().default(true)
});

export const settingsSchema = z.object({
  schoolName: z.string().min(2),
  schoolNameNp: z.string().min(2),
  academicYearBs: academicYearSchema,
  principalName: z.string().min(2),
  contactEmail: z.email(),
  contactPhone: z.string().min(7),
  address: addressSchema,
  holidays: z.array(
    z.object({
      title: z.string().min(1),
      dateBs: bsDateSchema
    })
  ),
  infrastructure: infrastructureSchema
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ParentSelfRegisterInput = z.infer<typeof parentSelfRegisterSchema>;
export type ActiveSchoolInput = z.infer<typeof activeSchoolSchema>;
export type SchoolInput = z.infer<typeof schoolSchema>;
export type CreateSchoolInput = z.infer<typeof createSchoolSchema>;
export type UpdateSchoolInput = z.infer<typeof updateSchoolSchema>;
export type StudentInput = z.infer<typeof studentSchema>;
export type TeacherInput = z.infer<typeof teacherSchema>;
export type CollegeStaffInput = z.infer<typeof collegeStaffSchema>;
export type ClassInput = z.infer<typeof classSchema>;
export type SectionInput = z.infer<typeof sectionSchema>;
export type BatchInput = z.infer<typeof batchSchema>;
export type YearInput = z.infer<typeof yearSchema>;
export type AcademicSubjectInput = z.infer<typeof academicSubjectSchema>;
export type MasterSubjectInput = z.infer<typeof masterSubjectSchema>;
export type SubjectInput = z.infer<typeof subjectSchema>;
export type AttendanceInput = z.infer<typeof attendanceSchema>;
export type ExamInput = z.infer<typeof examSchema>;
export type ExamRoutineInput = z.infer<typeof examRoutineSchema>;
export type ResultMarkInput = z.infer<typeof resultMarkSchema>;
export type ResultInput = z.infer<typeof resultSchema>;
export type ResultSubmissionScopeInput = z.infer<typeof resultSubmissionScopeSchema>;
export type ResultSubmissionReviewInput = z.infer<typeof resultSubmissionReviewSchema>;
export type FeeStructureInput = z.infer<typeof feeStructureSchema>;
export type FeeCollectionInput = z.infer<typeof feeCollectionSchema>;
export type NoticeInput = z.infer<typeof noticeSchema>;
export type BannerInput = z.infer<typeof bannerSchema>;
export type InfrastructureInput = z.infer<typeof infrastructureSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type AdminAccountInput = z.infer<typeof adminAccountSchema>;
export type AdminAccountUpdateInput = z.infer<typeof adminAccountUpdateSchema>;
export type AdminPasswordResetInput = z.infer<typeof adminPasswordResetSchema>;
