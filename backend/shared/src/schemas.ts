import { z } from "zod";
import {

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
  STUDENT_ACADEMIC_STATUSES,
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

/** Institution settings contact address — street / tole is optional */
export const settingsAddressSchema = addressSchema.extend({
  streetAddress: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((value) => value ?? "")
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

/** Student address — all parts optional so create form can leave them blank. */
export const optionalStudentAddressSchema = z.object({
  province: z.string().optional().or(z.literal("")).default(""),
  district: z.string().optional().or(z.literal("")).default(""),
  municipality: z.string().optional().or(z.literal("")).default(""),
  ward: z.string().optional().or(z.literal("")).default(""),
  streetAddress: z.string().optional().or(z.literal("")).default("")
});

/** BS date optional on student create (empty allowed). */
const optionalBsDateSchema = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .transform((value) => value ?? "")
  .refine((value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value), {
    message: "Date must be in BS format YYYY-MM-DD"
  });

/**
 * Student create/update — all profile fields are optional at the form level.
 * Backend fills safe defaults where the database still needs a value.
 */
export const studentSchema = z.object({
  fullName: z.string().trim().optional().or(z.literal("")).default(""),
  email: z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    z
      .string()
      .optional()
      .or(z.literal(""))
      .transform((value) => value ?? "")
      .refine((value) => value === "" || isValidPortalLoginId(value), {
        message: "Enter a valid login ID"
      })
  ),
  phone: z.string().optional().or(z.literal("")).default(""),
  password: optionalPortalPasswordSchema,
  admissionNumber: z.string().optional().or(z.literal("")).default(""),
  rollNumber: z.coerce.number().min(0).optional().default(0),
  classId: optionalObjectIdSchema,
  sectionId: optionalObjectIdSchema,
  batchId: optionalObjectIdSchema,
  yearId: optionalObjectIdSchema,
  admissionDateBs: optionalBsDateSchema.default(""),
  dateOfBirthBs: optionalBsDateSchema.default(""),
  gender: z.string().optional().or(z.literal("")).default(""),
  bloodGroup: z.enum(BLOOD_GROUPS).optional(),
  disabilityCategory: z.enum(DISABILITY_CATEGORIES).optional(),
  ethnicityCategory: z.enum(ETHNICITY_CATEGORIES).optional(),
  address: optionalStudentAddressSchema.default({
    province: "",
    district: "",
    municipality: "",
    ward: "",
    streetAddress: ""
  }),
  fatherName: z.string().optional().or(z.literal("")).default(""),
  fatherPhone: z.string().optional().or(z.literal("")).default(""),
  motherName: z.string().optional().or(z.literal("")).default(""),
  motherPhone: z.string().optional().or(z.literal("")).default(""),
  guardianName: z.string().optional().or(z.literal("")).default(""),
  guardianPhone: z.string().optional().or(z.literal("")).default(""),
  /** Full fee amount when not on scholarship (also used as outstanding due). */
  feesDueNpr: moneySchema.default(0),
  /** When true, student is on scholarship — no fee amount; UI shows "Scholarship". */
  hasScholarship: z.boolean().optional().default(false),
  remarks: z.string().optional().or(z.literal("")).default(""),
  academicStatus: z.enum(STUDENT_ACADEMIC_STATUSES).optional().default("ACTIVE"),
  // Phase 0 foundation fields (optional for backward compatibility)
  photoUrl: z.string().optional().or(z.literal("")),
  documents: z
    .array(
      z.object({
        _id: z.string().optional(),
        type: z.string(),
        name: z.string(),
        // File fields optional so PENDING placeholders can be stored without a file
        url: z.string().optional().default(""),
        originalName: z.string().optional().default(""),
        mimeType: z.string().optional(),
        size: z.number().min(0).optional().default(0),
        status: z.enum(["UPLOADED", "VERIFIED", "REJECTED", "PENDING"]).default("UPLOADED"),
        uploadedAt: z.string().optional().default(""),
        uploadedBy: z.string().optional().default(""),
        uploadedByName: z.string().optional(),
        notes: z.string().optional()
      })
    )
    .optional()
});

/**
 * Teacher create/update schema (HR fields primary).
 * Assignment multi-selects remain optional/empty-default for migration-period
 * PENDING teachers and backwards-compatible clients. Subject Assignment is
 * the source of truth once teachers are ACCEPTED/NA.
 */
const hrDocumentSchema = z.object({
  _id: z.string().optional(),
  type: z.string(),
  name: z.string(),
  url: z.string().optional().default(""),
  originalName: z.string().optional().default(""),
  mimeType: z.string().optional(),
  size: z.number().min(0).optional().default(0),
  status: z.enum(["UPLOADED", "VERIFIED", "REJECTED", "PENDING"]).default("UPLOADED"),
  uploadedAt: z.string().optional().default(""),
  uploadedBy: z.string().optional().default(""),
  uploadedByName: z.string().optional(),
  notes: z.string().optional()
});

export const teacherSchema = z.object({
  fullName: z.string().min(2),
  email: portalLoginIdSchema,
  phone: z.string().optional().or(z.literal("")),
  password: optionalPortalPasswordSchema,
  teacherCode: z.string().min(1),
  qualification: z.string().min(2),
  /** Position title — defaults to "Teacher" on the server when empty. */
  designation: z.string().optional().or(z.literal("")),
  joinedDateBs: bsDateSchema,
  address: addressSchema,
  subjects: z.array(objectIdSchema).default([]),
  assignedClassIds: z.array(objectIdSchema).default([]),
  assignedSectionIds: z.array(objectIdSchema).default([]),
  assignedBatchIds: z.array(objectIdSchema).default([]),
  assignedYearIds: z.array(objectIdSchema).default([]),
  basicSalaryNpr: moneySchema,
  photoUrl: z.string().optional().or(z.literal("")),
  documents: z.array(hrDocumentSchema).optional()
});

const optionalNonNegNumber = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) return undefined;
  if (typeof value === "number" && Number.isNaN(value)) return undefined;
  return value;
}, z.coerce.number().min(0).max(60).optional());

const optionalMoney = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) return 0;
  if (typeof value === "number" && Number.isNaN(value)) return 0;
  return value;
}, moneySchema.default(0));

export const collegeStaffSchema = z
  .object({
    fullName: z.string().min(2),
    /** Login ID — always required for ERP account creation. */
    email: z.string().email("Valid email is required as login ID"),
    phone: z.string().min(7),
    password: optionalPortalPasswordSchema,
    /** Always true for new staff; kept for backward-compatible partial updates. */
    enableLogin: z.boolean().default(true),
    staffId: z.string().trim().min(1, "Employee ID is required"),
    photoUrl: z.string().optional().or(z.literal("")),
    gender: z.string().min(1),
    dateOfBirthBs: bsDateSchema.optional().or(z.literal("")),
    address: addressSchema,
    emergencyContactName: z.string().trim().max(120).optional().or(z.literal("")),
    emergencyContactPhone: z.string().trim().max(30).optional().or(z.literal("")),
    joinedDateBs: bsDateSchema,
    designation: z.string().min(1, "Designation is required"),
    department: z.string().trim().max(120).optional().or(z.literal("")),
    category: z.enum(COLLEGE_STAFF_CATEGORIES),
    customRoleLabel: z.string().trim().max(120).optional().or(z.literal("")),
    qualification: z.string().trim().max(200).optional().or(z.literal("")),
    experienceYears: optionalNonNegNumber,
    employmentType: z.enum(EMPLOYMENT_TYPES).default("FULL_TIME"),
    basicSalaryNpr: optionalMoney,
    remarks: z.string().trim().max(2000).optional().or(z.literal("")),
    status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
    documents: z.array(hrDocumentSchema).optional()
  })
  .superRefine((value, ctx) => {
    if (value.category === "OTHER" && !value.customRoleLabel?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "Custom role label is required for Other Staff",
        path: ["customRoleLabel"]
      });
    }
  });

export const collegeStaffPasswordResetSchema = z.object({
  password: optionalPortalPasswordSchema
});

export const collegeStaffReportQuerySchema = z.object({
  reportType: z.enum([
    "DIRECTORY",
    "ROLE_WISE",
    "DEPARTMENT_WISE",
    "ACTIVE",
    "INACTIVE",
    "LOGIN_ACCOUNTS",
    "EMAIL_DELIVERY"
  ]),
  category: z.enum(COLLEGE_STAFF_CATEGORIES).optional(),
  format: z.enum(["json", "csv"]).default("json")
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
  level: z.coerce.number().min(1).max(12),
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
      status: z.enum(["PRESENT", "ABSENT", "LEAVE", "LATE", "MEDICAL_LEAVE"])
    })
  ),
  confirmSyncOverride: z.boolean().optional()
});

export const dailyAttendanceConfigSchema = z.object({
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  closeBeforeFirstPeriodEnds: z.boolean().default(true),
  allowMedicalLeave: z.boolean().default(true)
});

export const libraryInventoryAccessSchema = z.object({
  enabled: z.boolean()
});

export const dailyAttendanceSubmitSchema = z
  .object({
    classId: objectIdSchema.optional(),
    sectionId: objectIdSchema.optional(),
    batchId: objectIdSchema.optional(),
    yearId: objectIdSchema.optional(),
    dateBs: bsDateSchema,
    /** Required for teachers. Optional for admins marking groups without a first-period slot. */
    timetableSlotId: objectIdSchema.optional(),
    /** Used when marking without a timetable slot (admin manual register). */
    subjectId: optionalObjectIdSchema,
    entries: z
      .array(
        z.object({
          studentId: objectIdSchema,
          status: z.enum(["PRESENT", "ABSENT", "LEAVE", "LATE", "MEDICAL_LEAVE"]),
          remarks: z.string().max(500).optional()
        })
      )
      .min(1),
    notes: z.string().max(2000).optional(),
    adminOverride: z.boolean().optional(),
    assignedTeacherId: optionalObjectIdSchema
  })
  .superRefine((data, ctx) => {
    if (!data.timetableSlotId && !data.adminOverride) {
      ctx.addIssue({
        code: "custom",
        path: ["timetableSlotId"],
        message: "Timetable slot is required to mark daily attendance"
      });
    }
    if (!data.timetableSlotId && data.adminOverride && !data.assignedTeacherId) {
      ctx.addIssue({
        code: "custom",
        path: ["assignedTeacherId"],
        message: "Assign a teacher when marking attendance without a timetable slot"
      });
    }
  });

export const dailyAttendanceUpdateSchema = z.object({
  classId: objectIdSchema.optional(),
  sectionId: objectIdSchema.optional(),
  batchId: objectIdSchema.optional(),
  yearId: objectIdSchema.optional(),
  dateBs: bsDateSchema,
  timetableSlotId: objectIdSchema.optional(),
  subjectId: optionalObjectIdSchema,
  entries: z
    .array(
      z.object({
        studentId: objectIdSchema,
        status: z.enum(["PRESENT", "ABSENT", "LEAVE", "LATE", "MEDICAL_LEAVE"]),
        remarks: z.string().max(500).optional()
      })
    )
    .min(1),
  notes: z.string().max(2000).optional(),
  adminOverride: z.boolean().optional(),
  assignedTeacherId: optionalObjectIdSchema,
  teacherId: optionalObjectIdSchema,
  teacherReassignReason: z.string().max(500).optional()
});

export const dailyAttendanceUnlockSchema = z.object({
  reason: z.string().min(3).max(500)
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
}).superRefine((exam, ctx) => {
  // Lexicographic compare works for YYYY-MM-DD BS strings
  if (exam.startDateBs && exam.endDateBs && exam.startDateBs > exam.endDateBs) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Exam start date must be on or before end date",
      path: ["endDateBs"]
    });
  }
});

export const examRoutineSchema = z.object({
  /** College: year this routine entry belongs to (1st / 2nd / 3rd). */
  yearId: optionalObjectIdSchema,
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

export const resultMarkSchema = z
  .object({
    subjectId: objectIdSchema,
    fullMarks: z.coerce.number().min(1),
    passMarks: z.coerce.number().min(0),
    theoryMarks: z.coerce.number().min(0).optional(),
    practicalMarks: z.coerce.number().min(0).optional(),
    internalMarks: z.coerce.number().min(0).optional(),
    attendanceStatus: z.enum(EXAM_ATTENDANCE_STATUSES).default("PRESENT"),
    teacherRemarks: z.string().optional().or(z.literal(""))
  })
  .superRefine((mark, ctx) => {
    if (mark.passMarks > mark.fullMarks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pass marks cannot exceed full marks",
        path: ["passMarks"]
      });
    }
    if (mark.attendanceStatus === "ABSENT") {
      return;
    }
    const obtained = (mark.theoryMarks ?? 0) + (mark.practicalMarks ?? 0) + (mark.internalMarks ?? 0);
    if (obtained > mark.fullMarks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Total obtained marks (${obtained}) cannot exceed full marks (${mark.fullMarks})`,
        path: ["theoryMarks"]
      });
    }
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
  imageUrl: z.string().min(1, "Banner image is required"),
  thumbnailUrl: z.string().optional(),
  isActive: z.boolean().default(true),
  fileSizeBytes: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  originalFileName: z.string().optional()
});

export const bannerImageReplaceSchema = z.object({
  imageUrl: z.string().min(1, "Banner image is required"),
  thumbnailUrl: z.string().optional(),
  fileSizeBytes: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  originalFileName: z.string().optional()
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

/**
 * Optional profile/staff photo URL.
 * Allow relative /uploads/… paths or http(s) URLs only — block javascript:/data: and other schemes.
 */
const optionalPhotoUrlSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? "" : value),
  z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        // Cloudinary secure_url can exceed 500 chars with long folders / transforms
        .max(2048)
        .refine(
          (url) => {
            if (url.startsWith("/uploads/")) {
              // Relative tenant upload path — no scheme, no path traversal
              return !url.includes("..") && !url.includes("\\") && !/[\u0000-\u001f]/.test(url);
            }
            try {
              const parsed = new URL(url);
              return parsed.protocol === "http:" || parsed.protocol === "https:";
            } catch {
              return false;
            }
          },
          { message: "Photo URL must be an http(s) URL or a /uploads/ path" }
        )
    ])
    .optional()
);

export const collegeAdministratorSchema = z.object({
  fullName: z.string().min(2),
  employeeId: z.string().min(1),
  designation: z.string().min(1),
  department: z.string().min(1),
  phone: z.string().min(7),
  email: portalLoginIdSchema,
  password: optionalPortalPasswordSchema,
  profilePhotoUrl: optionalPhotoUrlSchema
});

export const collegeAdministratorUpdateSchema = collegeAdministratorSchema.partial().extend({
  fullName: z.string().min(2).optional(),
  employeeId: z.string().min(1).optional(),
  designation: z.string().min(1).optional(),
  department: z.string().min(1).optional(),
  phone: z.string().min(7).optional(),
  email: portalLoginIdSchema.optional(),
  profilePhotoUrl: optionalPhotoUrlSchema
});

export const selfProfileUpdateSchema = z.object({
  fullName: z.string().min(2).optional(),
  phone: z.string().min(7).optional(),
  profilePhotoUrl: optionalPhotoUrlSchema
});

export const selfPasswordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: portalPasswordSchema
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
  address: settingsAddressSchema,
  holidays: z.array(
    z.object({
      title: z.string().min(1),
      dateBs: bsDateSchema
    })
  ),
  infrastructure: infrastructureSchema,
  dailyAttendance: dailyAttendanceConfigSchema.optional()
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
export type CollegeStaffPasswordResetInput = z.infer<typeof collegeStaffPasswordResetSchema>;
export type CollegeStaffReportQueryInput = z.infer<typeof collegeStaffReportQuerySchema>;
export type ClassInput = z.infer<typeof classSchema>;
export type SectionInput = z.infer<typeof sectionSchema>;
export type BatchInput = z.infer<typeof batchSchema>;
export type YearInput = z.infer<typeof yearSchema>;
export type AcademicSubjectInput = z.infer<typeof academicSubjectSchema>;
export type MasterSubjectInput = z.infer<typeof masterSubjectSchema>;
export type SubjectInput = z.infer<typeof subjectSchema>;
export type AttendanceInput = z.infer<typeof attendanceSchema>;
export type DailyAttendanceSubmitInput = z.infer<typeof dailyAttendanceSubmitSchema>;
export type DailyAttendanceUpdateInput = z.infer<typeof dailyAttendanceUpdateSchema>;
export type DailyAttendanceUnlockInput = z.infer<typeof dailyAttendanceUnlockSchema>;
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
export type CollegeAdministratorInput = z.infer<typeof collegeAdministratorSchema>;
export type CollegeAdministratorUpdateInput = z.infer<typeof collegeAdministratorUpdateSchema>;
export type SelfProfileUpdateInput = z.infer<typeof selfProfileUpdateSchema>;
export type SelfPasswordChangeInput = z.infer<typeof selfPasswordChangeSchema>;
export type AdminPasswordResetInput = z.infer<typeof adminPasswordResetSchema>;
// Subject assignment input types are exported from subject-assignment-schemas.ts
