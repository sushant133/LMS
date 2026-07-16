import type { GradeSymbol, UserRole } from "./types.js";

/** Official PHIT LMS branding */
export const APP_BRAND_NAME = "PHIT LMS";
export const APP_BRAND_SHORT = "PHIT";

/** Primary UI theme color (navy blue) */
export const BRAND_COLOR_PRIMARY = "#0c2d6b";
export const BRAND_COLOR_PRIMARY_HOVER = "#0a2559";
export const BRAND_COLOR_LIGHT = "#eef3fb";
export const INSTITUTION_NAME = "Public Himal Institute of Technology";
export const INSTITUTION_NAME_NP = "पब्लिक हिमाल इन्स्टिच्युट अफ टेक्नोलोजी";

/**
 * College branding assets:
 * - Favicon: frontend/public/favicon.svg (browser tab icon)
 * - College logo UI: frontend/public/college-logo.png (header, login, marksheets)
 * - College logo PDF: backend/assets/college-logo.png (server-side receipt & marksheet generation)
 */
export const FAVICON_URL = "/favicon.svg";
export const COLLEGE_LOGO_URL = "/college-logo.png";

/** Known school codes for PHIT — matches existing database records without modification */
export const INSTITUTION_SCHOOL_CODES = ["DEMOERP", "PHIT", "DEMO"] as const;

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: "System Administrator",
  COLLEGE_ADMIN: "Administrator",
  COLLEGE_VIEWER: "College Administrator",
  TEACHER: "Teacher",
  STUDENT: "Student",
  PARENT: "Parent",
  LIBRARY_STAFF: "Library Staff",
  LABORATORY_STAFF: "Laboratory Staff",
  ACCOUNTANT: "Accountant",
  CASHIER: "Cashier",
  AUDITOR: "Auditor",
  PRINCIPAL: "Principal",
  COLLEGE_STAFF: "College Staff"
};

/** @deprecated Legacy role stored on older accounts — normalized to COLLEGE_ADMIN */
export const LEGACY_USER_ROLE_ALIASES: Record<string, UserRole> = {
  SCHOOL_ADMIN: "COLLEGE_ADMIN"
};

export const normalizeUserRole = (role: string): UserRole =>
  (LEGACY_USER_ROLE_ALIASES[role] ?? role) as UserRole;

/** Roles with full institution write access (Administrator + System Administrator). */
export const INSTITUTION_ADMIN_ROLES: UserRole[] = ["SUPER_ADMIN", "COLLEGE_ADMIN"];

/** Roles with institution-wide read access including read-only College Administrators. */
export const INSTITUTION_ACCESS_ROLES: UserRole[] = ["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER"];

export const isInstitutionAdmin = (role: string): boolean =>
  INSTITUTION_ADMIN_ROLES.includes(normalizeUserRole(role));

export const isCollegeViewer = (role: string): boolean => normalizeUserRole(role) === "COLLEGE_VIEWER";

export const hasInstitutionAccess = (role: string): boolean =>
  INSTITUTION_ACCESS_ROLES.includes(normalizeUserRole(role));

export const canManageInstitution = (role: string): boolean => isInstitutionAdmin(role);

export const isSystemAdministrator = (role: string): boolean => normalizeUserRole(role) === "SUPER_ADMIN";

export const READ_ONLY_ACCESS_MESSAGE = "You have read-only access.";

export const getInstitutionPermissions = (role: string) => {
  const normalized = normalizeUserRole(role);

  if (normalized === "COLLEGE_VIEWER") {
    return {
      canRead: true,
      canWrite: false,
      canManageUsers: false,
      canExport: true
    };
  }

  if (isInstitutionAdmin(normalized)) {
    return {
      canRead: true,
      canWrite: true,
      canManageUsers: true,
      canExport: true
    };
  }

  return {
    canRead: false,
    canWrite: false,
    canManageUsers: false,
    canExport: false
  };
};

export const USER_ROLES: UserRole[] = [
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
  "COLLEGE_VIEWER",
  "TEACHER",
  "STUDENT",
  "PARENT",
  "LIBRARY_STAFF",
  "LABORATORY_STAFF",
  "ACCOUNTANT",
  "CASHIER",
  "AUDITOR",
  "PRINCIPAL",
  "COLLEGE_STAFF"
];

/**
 * Non-teaching staff categories only. Teachers are managed exclusively via the Teacher module.
 */
export const COLLEGE_STAFF_CATEGORIES = [
  "ACCOUNTANT",
  "LIBRARIAN",
  "LABORATORY_STAFF",
  "SECURITY_GUARD",
  "HOUSEKEEPING",
  "RECEPTIONIST",
  "OFFICE_ASSISTANT",
  "TRANSPORT",
  "IT_STAFF",
  "OTHER"
] as const;

export const COLLEGE_STAFF_CATEGORY_LABELS: Record<(typeof COLLEGE_STAFF_CATEGORIES)[number], string> = {
  ACCOUNTANT: "Accountants / Finance Staff",
  LIBRARIAN: "Librarians / Library Staff",
  LABORATORY_STAFF: "Laboratory Staff / Lab In-Charge",
  SECURITY_GUARD: "Security Guards",
  HOUSEKEEPING: "Sweepers / Housekeeping",
  RECEPTIONIST: "Receptionists",
  OFFICE_ASSISTANT: "Office Assistants",
  TRANSPORT: "Drivers / Transport Staff",
  IT_STAFF: "IT Staff",
  OTHER: "Other Staff"
};

/** Maps college staff category → ERP UserRole for login / RBAC. Never TEACHER. */
export const COLLEGE_STAFF_CATEGORY_ROLES: Record<(typeof COLLEGE_STAFF_CATEGORIES)[number], UserRole> = {
  ACCOUNTANT: "ACCOUNTANT",
  LIBRARIAN: "LIBRARY_STAFF",
  LABORATORY_STAFF: "LABORATORY_STAFF",
  SECURITY_GUARD: "COLLEGE_STAFF",
  HOUSEKEEPING: "COLLEGE_STAFF",
  RECEPTIONIST: "COLLEGE_STAFF",
  OFFICE_ASSISTANT: "COLLEGE_STAFF",
  TRANSPORT: "COLLEGE_STAFF",
  IT_STAFF: "COLLEGE_STAFF",
  OTHER: "COLLEGE_STAFF"
};

export const COLLEGE_STAFF_REPORT_TYPES = [
  "DIRECTORY",
  "ROLE_WISE",
  "DEPARTMENT_WISE",
  "ACTIVE",
  "INACTIVE",
  "LOGIN_ACCOUNTS",
  "EMAIL_DELIVERY"
] as const;

export const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"] as const;

export const PUBLIC_REGISTER_ROLES: UserRole[] = ["PARENT"];

export const COMPLAINT_CATEGORIES = [
  "TEACHER",
  "STAFF",
  "STUDENT",
  "STUDY",
  "FACILITY",
  "ADMINISTRATION",
  "OTHER"
] as const;

export const COMPLAINT_CATEGORY_LABELS: Record<(typeof COMPLAINT_CATEGORIES)[number], string> = {
  TEACHER: "Teacher",
  STAFF: "Staff",
  STUDENT: "Student",
  STUDY: "Study / Academics",
  FACILITY: "Facility / Infrastructure",
  ADMINISTRATION: "Administration",
  OTHER: "Other"
};

export const COMPLAINT_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "RESOLVED", "CLOSED"] as const;

export const COMPLAINT_STATUS_LABELS: Record<(typeof COMPLAINT_STATUSES)[number], string> = {
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under Review",
  RESOLVED: "Resolved",
  CLOSED: "Closed"
};

export const COMPLAINANT_ROLES: UserRole[] = [
  "STUDENT",
  "TEACHER",
  "COLLEGE_STAFF",
  "LIBRARY_STAFF",
  "LABORATORY_STAFF",
  "ACCOUNTANT",
  "CASHIER",
  "AUDITOR",
  "PRINCIPAL"
];

export const TENANT_STAFF_ROLES: UserRole[] = [
  "COLLEGE_ADMIN",
  "COLLEGE_VIEWER",
  "TEACHER",
  "STUDENT",
  "PARENT",
  "LIBRARY_STAFF",
  "LABORATORY_STAFF",
  "ACCOUNTANT",
  "CASHIER",
  "AUDITOR",
  "PRINCIPAL",
  "COLLEGE_STAFF"
];

export const LIBRARY_MANAGER_ROLES: UserRole[] = ["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "LIBRARY_STAFF"];

export const LABORATORY_MANAGER_ROLES: UserRole[] = [
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
  "COLLEGE_VIEWER",
  "LABORATORY_STAFF",
  "TEACHER"
];

export const ACCOUNTING_MANAGER_ROLES: UserRole[] = ["SUPER_ADMIN", "COLLEGE_ADMIN", "ACCOUNTANT"];

/** Cashier — fee collection and receipt operations only */
export const ACCOUNTING_CASHIER_ROLES: UserRole[] = ["CASHIER"];

/** Auditor — read-only access to all financial records */
export const ACCOUNTING_AUDITOR_ROLES: UserRole[] = ["AUDITOR"];

/** All roles with any accounting module access */
export const ACCOUNTING_ACCESS_ROLES: UserRole[] = [
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
  "COLLEGE_VIEWER",
  "ACCOUNTANT",
  "CASHIER",
  "AUDITOR",
  "PRINCIPAL"
];

/** Roles that can approve high-value financial reversals and voids */
export const ACCOUNTING_APPROVER_ROLES: UserRole[] = ["SUPER_ADMIN", "COLLEGE_ADMIN", "PRINCIPAL"];

/** Roles that can mutate financial records (not auditor) */
export const ACCOUNTING_WRITE_ROLES: UserRole[] = ["SUPER_ADMIN", "COLLEGE_ADMIN", "ACCOUNTANT", "CASHIER"];

export const BANNER_TARGET_ROLES = [
  "STUDENT",
  "TEACHER",
  "PARENT",
  "ACCOUNTANT",
  "LIBRARY_STAFF",
  "LABORATORY_STAFF",
  "TRANSPORT_STAFF",
  "HR_PAYROLL",
  "COLLEGE_ADMIN"
] as const;

export const BANNER_TARGET_ROLE_LABELS: Record<(typeof BANNER_TARGET_ROLES)[number], string> = {
  STUDENT: "Students",
  TEACHER: "Teachers",
  PARENT: "Parents",
  ACCOUNTANT: "Accounting",
  LIBRARY_STAFF: "Library Staff",
  LABORATORY_STAFF: "Laboratory Staff",
  TRANSPORT_STAFF: "Transport Staff",
  HR_PAYROLL: "HR & Payroll",
  COLLEGE_ADMIN: "College Administrator"
};

export const BANNER_PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;

export const BANNER_PRIORITY_ORDER: Record<(typeof BANNER_PRIORITIES)[number], number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2
};

export const FEE_TYPES = [
  "ADMISSION",
  "REGISTRATION",
  "TUITION",
  "MONTHLY",
  "EXAM",
  "PRACTICAL",
  "LIBRARY",
  "LAB",
  "TRANSPORT",
  "HOSTEL",
  "FINE",
  "SCHOLARSHIP",
  "MISC",
  "REFUND",
  "OTHER",
  "ANNUAL"
] as const;

export const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "CHEQUE", "FONEPAY", "ONLINE", "OTHER"] as const;

export const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank Deposit",
  CHEQUE: "Cheque",
  FONEPAY: "Fonepay",
  ONLINE: "Online",
  OTHER: "Other"
};

export const FEE_STRUCTURE_STATUSES = ["ACTIVE", "ARCHIVED"] as const;

export const EXPENSE_CATEGORIES = [
  "Office Expenses",
  "Electricity",
  "Water",
  "Internet",
  "Furniture",
  "Maintenance",
  "Library",
  "Laboratory",
  "Sports",
  "Transport",
  "Events",
  "Miscellaneous"
] as const;

export const PURCHASE_CATEGORIES = [
  "Books",
  "Computers",
  "Laboratory Equipment",
  "Furniture",
  "Stationery",
  "Sports Equipment",
  "Other Assets"
] as const;

export const INCOME_CATEGORIES = [
  "Donations",
  "Government Grants",
  "Admission Income",
  "Transport Income",
  "Hostel Income",
  "Miscellaneous Income"
] as const;

export const PAYMENT_STATUSES = ["PENDING", "PARTIAL", "PAID"] as const;

// Laboratory constants live in laboratory-constants.ts and are exported from package
// index only — do not re-export here (Vite star-export conflict).

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

export const INSTITUTION_TYPES = ["SCHOOL", "COLLEGE"] as const;

export const CLASS_LEVELS = ["ECD", "Class 1", "Class 2", "Class 3", "Class 4", "Class 5", "Class 6", "Class 7", "Class 8", "Class 9", "Class 10", "Class 11", "Class 12"] as const;

/**
 * Curriculum / program year names (HA 1st–3rd). Used for master subjects & syllabus.
 * Does not include "Ended" (student placement only).
 */
export const COLLEGE_PROGRAM_YEAR_NAMES = ["1st Year", "2nd Year", "3rd Year"] as const;

/**
 * All Year options stored on the Year model / student form.
 * "Ended" = student has finished the program years (not a curriculum year).
 */
export const COLLEGE_YEAR_NAMES = ["1st Year", "2nd Year", "3rd Year", "Ended"] as const;

/**
 * Library catalog year levels for HA college books.
 * "All Years" = shared / general books not tied to a single year.
 */
export const LIBRARY_YEAR_LEVELS = ["1st Year", "2nd Year", "3rd Year", "All Years"] as const;

/** Academic lifecycle status for college students. Only ACTIVE students are promoted. */
export const STUDENT_ACADEMIC_STATUSES = [
  "ACTIVE",
  "PENDING_NOT_PASSED",
  "PASSED_OUT",
  "ALUMNI",
  "WITHDRAWN",
  "CANCELLED",
  "SUSPENDED"
] as const;

export const STUDENT_ACADEMIC_STATUS_LABELS: Record<(typeof STUDENT_ACADEMIC_STATUSES)[number], string> = {
  ACTIVE: "Active",
  PENDING_NOT_PASSED: "Pending / Not Passed",
  PASSED_OUT: "Passed Out",
  ALUMNI: "Alumni",
  WITHDRAWN: "Withdrawn",
  CANCELLED: "Cancelled",
  SUSPENDED: "Suspended"
};

/** Statuses that block academic promotion. */
export const NON_PROMOTABLE_STUDENT_STATUSES = [
  "PENDING_NOT_PASSED",
  "PASSED_OUT",
  "ALUMNI",
  "WITHDRAWN",
  "CANCELLED",
  "SUSPENDED"
] as const;

export const ACADEMIC_PROMOTION_STATUSES = ["COMPLETED", "ROLLED_BACK"] as const;

export const ACADEMIC_PROMOTION_OUTCOMES = ["PROMOTED", "PASSED_OUT"] as const;

export const EXAM_STATUSES = ["DRAFT", "SCHEDULED", "ONGOING", "COMPLETED", "PUBLISHED"] as const;

export const RESULT_SUBMISSION_STATUSES = [
  "DRAFT",
  "SUBMITTED_FOR_REVIEW",
  "PENDING_ADMIN_REVIEW",
  "RETURNED_FOR_CORRECTION",
  "APPROVED",
  "PUBLISHED"
] as const;

export const EXAM_ATTENDANCE_STATUSES = ["PRESENT", "ABSENT", "EXEMPT"] as const;

export const EXAM_PASS_FAIL_STATUSES = ["PASS", "FAIL"] as const;

export const GRADE_SCALE: Array<{
  symbol: GradeSymbol;
  minPercentage: number;
  gpa: number;
}> = [
  { symbol: "A+", minPercentage: 90, gpa: 4.0 },
  { symbol: "A", minPercentage: 80, gpa: 3.6 },
  { symbol: "B+", minPercentage: 70, gpa: 3.2 },
  { symbol: "B", minPercentage: 60, gpa: 2.8 },
  { symbol: "C+", minPercentage: 50, gpa: 2.4 },
  { symbol: "C", minPercentage: 40, gpa: 2.0 },
  { symbol: "D", minPercentage: 35, gpa: 1.6 },
  { symbol: "E", minPercentage: 0, gpa: 0.8 }
];

export const DEFAULT_ACADEMIC_YEAR_BS = "2083/2084";

/**
 * Subject Assignment coverage types (who teaches what coverage).
 * Named SUBJECT_ASSIGNMENT_* to avoid clash with classroom ASSIGNMENT_TYPES (HOMEWORK/CAS/NOTE).
 */
export const SUBJECT_ASSIGNMENT_TYPES = ["FULL", "UNIT", "PERCENTAGE"] as const;
/** @deprecated Use SUBJECT_ASSIGNMENT_TYPES — alias for design-doc naming */
export const SA_ASSIGNMENT_TYPES = SUBJECT_ASSIGNMENT_TYPES;

/** Lifecycle of a SubjectAssignment row (scope uses ACTIVE only) */
export const SUBJECT_ASSIGNMENT_STATUSES = ["ACTIVE", "ENDED", "SUPERSEDED"] as const;

/** Per-teacher migration marker for dual-read scope resolution */
export const TEACHER_MIGRATION_STATUSES = ["NA", "PENDING", "NEEDS_REVIEW", "ACCEPTED"] as const;

/** Per-school (or env default) scope data source mode */
export const SCOPE_MODES = ["legacy", "dual", "assignment"] as const;

// Nepal IEMIS / Inclusive Education - Official 8 disability categories (approximate from CEHRD guidelines)
export const DISABILITY_CATEGORIES = [
  "None",
  "Physical",
  "Intellectual / Mental",
  "Hearing",
  "Visual / Low Vision",
  "Deaf-Blind (Combined Hearing-Visual)",
  "Speech and Language",
  "Multiple Disabilities",
  "Autism Spectrum / Other Developmental"
] as const;

// Common Nepal caste/ethnicity groupings for equity reporting (flexible for IEMIS)
export const ETHNICITY_CATEGORIES = [
  "Brahmin / Chhetri",
  "Dalit",
  "Janajati / Indigenous",
  "Madhesi",
  "Muslim",
  "Other",
  "Prefer not to say"
] as const;

// Document types for student/teacher records and admissions
export const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export const DAILY_ATTENDANCE_STATUSES = ["PRESENT", "ABSENT", "LEAVE", "LATE", "MEDICAL_LEAVE"] as const;

export const DAILY_ATTENDANCE_RECORD_STATUSES = ["DRAFT", "SUBMITTED", "LOCKED"] as const;

export const DEFAULT_DAILY_ATTENDANCE_CONFIG = {
  startTime: "06:00",
  endTime: "12:00",
  closeBeforeFirstPeriodEnds: true,
  allowMedicalLeave: true
} as const;

export const DEFAULT_LIBRARY_INVENTORY_ACCESS = {
  enabled: false
} as const;

export const ASSIGNMENT_TYPES = ["HOMEWORK", "CAS", "NOTE"] as const;

export const LEAVE_TYPES = ["CASUAL", "SICK", "MATERNITY", "UNPAID", "OTHER"] as const;

export const PARENT_RELATIONSHIPS = ["FATHER", "MOTHER", "GUARDIAN", "OTHER"] as const;

export const PARENT_LINK_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

export const DOCUMENT_TYPES = [
  "Photo",
  "BirthCertificate",
  "PreviousMarksheet",
  "TransferCertificate",
  "DisabilityCertificate",
  "ScholarshipProof",
  "GuardianID",
  "Other"
] as const;

/** Predefined student document categories for admissions and profile management */
export const STUDENT_DOCUMENT_CATEGORIES = [
  { key: "STUDENT_PHOTOGRAPH", label: "Student Photograph", required: true, allowMultiple: false, allowCustomName: false },
  { key: "SEE_SLC_MARKSHEET", label: "SEE/SLC Marksheet", required: true, allowMultiple: false, allowCustomName: false },
  { key: "SEE_SLC_CHARACTER", label: "SEE/SLC Character Certificate", required: true, allowMultiple: false, allowCustomName: false },
  { key: "CITIZENSHIP_NATIONAL_ID", label: "Citizenship/National ID", required: true, allowMultiple: false, allowCustomName: false },
  { key: "PLUS2_MARKSHEET", label: "+2/Equivalent Marksheet", required: false, allowMultiple: false, allowCustomName: false },
  { key: "PLUS2_CHARACTER", label: "+2/Equivalent Character Certificate", required: false, allowMultiple: false, allowCustomName: false },
  { key: "MIGRATION_CERTIFICATE", label: "Migration Certificate", required: false, allowMultiple: false, allowCustomName: false },
  { key: "PROVISIONAL_CERTIFICATE", label: "Provisional Certificate", required: false, allowMultiple: false, allowCustomName: false },
  { key: "BIRTH_CERTIFICATE", label: "Birth Certificate", required: false, allowMultiple: false, allowCustomName: false },
  { key: "MEDICAL_FITNESS", label: "Medical Fitness Certificate", required: false, allowMultiple: false, allowCustomName: false },
  { key: "ADMISSION_FORM", label: "Admission Form", required: false, allowMultiple: false, allowCustomName: false },
  { key: "CTEVT_REGISTRATION", label: "CTEVT Registration Documents", required: false, allowMultiple: true, allowCustomName: false },
  { key: "SCHOLARSHIP", label: "Scholarship Documents", required: false, allowMultiple: true, allowCustomName: false },
  { key: "FEE_AGREEMENT", label: "Fee Agreement Documents", required: false, allowMultiple: true, allowCustomName: false },
  { key: "OTHER", label: "Other Documents", required: false, allowMultiple: true, allowCustomName: true }
] as const;

export const STUDENT_DOCUMENT_STATUSES = ["UPLOADED", "VERIFIED", "REJECTED", "PENDING"] as const;

export const STUDENT_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png"
] as const;

export const STUDENT_DOCUMENT_MAX_SIZE_BYTES = 500 * 1024;

/** Required document categories for admissions (must be submitted or left PENDING). */
export const getRequiredStudentDocumentCategories = () =>
  STUDENT_DOCUMENT_CATEGORIES.filter((item) => item.required);

export type PendingRequiredDocumentPlaceholder = {
  type: string;
  name: string;
  url: string;
  originalName: string;
  size: number;
  status: "PENDING";
  uploadedAt: string;
  uploadedBy: string;
};

/**
 * Merge existing student documents with PENDING placeholders for any required
 * categories that are missing. Student creation is allowed without files;
 * missing required docs stay PENDING until uploaded later.
 */
export const ensurePendingRequiredDocuments = <
  T extends { type: string; status?: string; url?: string }
>(
  documents: T[] = []
): Array<T | PendingRequiredDocumentPlaceholder> => {
  const result: Array<T | PendingRequiredDocumentPlaceholder> = [...documents];
  const presentTypes = new Set(result.map((doc) => doc.type));

  for (const category of getRequiredStudentDocumentCategories()) {
    if (presentTypes.has(category.key)) continue;
    const placeholder: PendingRequiredDocumentPlaceholder = {
      type: category.key,
      name: category.label,
      url: "",
      originalName: "",
      size: 0,
      status: "PENDING",
      uploadedAt: "",
      uploadedBy: ""
    };
    result.push(placeholder);
    presentTypes.add(category.key);
  }

  return result;
};

/** True when a document entry represents an unsubmitted required file. */
export const isPendingStudentDocument = (doc: {
  status?: string;
  url?: string;
}): boolean => doc.status === "PENDING" || !doc.url;

/** Count of required document categories still missing a real file. */
export const countPendingRequiredDocuments = (
  documents: Array<{ type: string; status?: string; url?: string }> = []
): number => {
  return getRequiredStudentDocumentCategories().filter((category) => {
    const ofType = documents.filter((doc) => doc.type === category.key);
    if (ofType.length === 0) return true;
    return ofType.every((doc) => isPendingStudentDocument(doc));
  }).length;
};
