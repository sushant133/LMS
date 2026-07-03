import { z } from "zod";
import {
  BLOOD_GROUPS,
  CLASS_LEVELS,
  DISABILITY_CATEGORIES,
  ETHNICITY_CATEGORIES,
  PUBLIC_REGISTER_ROLES,
  USER_ROLES
} from "./constants.js";

export const objectIdSchema = z.string().trim().regex(/^[a-f\d]{24}$/i, "Invalid identifier");

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

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(6)
});

export const registerSchema = z.object({
  schoolId: objectIdSchema,
  fullName: z.string().min(2),
  email: z.email(),
  password: z.string().min(6),
  phone: z.string().optional().or(z.literal("")),
  role: z.enum(PUBLIC_REGISTER_ROLES).default("PARENT")
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
  email: z.email(),
  phone: z.string().optional().or(z.literal("")),
  admissionNumber: z.string().min(1),
  rollNumber: z.coerce.number().min(1),
  classId: objectIdSchema,
  sectionId: objectIdSchema,
  admissionDateBs: bsDateSchema,
  dateOfBirthBs: bsDateSchema,
  gender: z.string().min(1),
  bloodGroup: z.enum(BLOOD_GROUPS).optional(),
  disabilityCategory: z.enum(DISABILITY_CATEGORIES).optional(),
  ethnicityCategory: z.enum(ETHNICITY_CATEGORIES).optional(),
  address: addressSchema,
  fatherName: z.string().min(2),
  motherName: z.string().min(2),
  guardianName: z.string().min(2),
  guardianPhone: z.string().min(7),
  feesDueNpr: moneySchema,
  remarks: z.string().optional(),
  // Phase 0 foundation fields (optional for backward compatibility)
  photoUrl: z.string().url().optional().or(z.literal("")),
  documents: z.array(z.object({
    type: z.string(),
    url: z.string(),
    originalName: z.string(),
    uploadedAt: z.string(),
    notes: z.string().optional()
  })).optional()
});

export const teacherSchema = z.object({
  fullName: z.string().min(2),
  email: z.email(),
  phone: z.string().optional().or(z.literal("")),
  teacherCode: z.string().min(1),
  qualification: z.string().min(2),
  joinedDateBs: bsDateSchema,
  address: addressSchema,
  subjects: z.array(objectIdSchema).default([]),
  assignedClassIds: z.array(objectIdSchema).default([]),
  assignedSectionIds: z.array(objectIdSchema).default([]),
  basicSalaryNpr: moneySchema
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

export const subjectSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  classIds: z.array(objectIdSchema).default([]),
  teacherIds: z.array(objectIdSchema).default([]),
  fullMarks: z.coerce.number().min(1),
  passMarks: z.coerce.number().min(0)
});

export const attendanceSchema = z.object({
  classId: objectIdSchema,
  sectionId: objectIdSchema,
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
  classIds: z.array(objectIdSchema).default([])
});

export const resultSchema = z.object({
  examId: objectIdSchema,
  studentId: objectIdSchema,
  classId: objectIdSchema,
  sectionId: objectIdSchema,
  marks: z.array(
    z.object({
      subjectId: objectIdSchema,
      obtainedMarks: z.coerce.number().min(0)
    })
  ),
  publishedAtBs: bsDateSchema.optional().or(z.literal(""))
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
export type ActiveSchoolInput = z.infer<typeof activeSchoolSchema>;
export type SchoolInput = z.infer<typeof schoolSchema>;
export type CreateSchoolInput = z.infer<typeof createSchoolSchema>;
export type UpdateSchoolInput = z.infer<typeof updateSchoolSchema>;
export type StudentInput = z.infer<typeof studentSchema>;
export type TeacherInput = z.infer<typeof teacherSchema>;
export type ClassInput = z.infer<typeof classSchema>;
export type SectionInput = z.infer<typeof sectionSchema>;
export type SubjectInput = z.infer<typeof subjectSchema>;
export type AttendanceInput = z.infer<typeof attendanceSchema>;
export type ExamInput = z.infer<typeof examSchema>;
export type ResultInput = z.infer<typeof resultSchema>;
export type FeeStructureInput = z.infer<typeof feeStructureSchema>;
export type FeeCollectionInput = z.infer<typeof feeCollectionSchema>;
export type NoticeInput = z.infer<typeof noticeSchema>;
export type InfrastructureInput = z.infer<typeof infrastructureSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
