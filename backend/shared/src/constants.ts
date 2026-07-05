import type { GradeSymbol, UserRole } from "./types.js";

/** Official PHIT ERP branding */
export const APP_BRAND_NAME = "PHIT ERP";
export const APP_BRAND_SHORT = "PHIT";
export const INSTITUTION_NAME = "Public Himal Institute of Technology";
export const INSTITUTION_NAME_NP = "पब्लिक हिमाल इन्स्टिच्युट अफ टेक्नोलोजी";

/** Known school codes for PHIT — matches existing database records without modification */
export const INSTITUTION_SCHOOL_CODES = ["DEMOERP", "PHIT", "DEMO"] as const;

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: "System Administrator",
  COLLEGE_ADMIN: "College Administrator",
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

/** Roles with full institution operational access (College Admin + System Administrator). */
export const INSTITUTION_ADMIN_ROLES: UserRole[] = ["SUPER_ADMIN", "COLLEGE_ADMIN"];

export const isInstitutionAdmin = (role: string): boolean =>
  INSTITUTION_ADMIN_ROLES.includes(normalizeUserRole(role));

export const isSystemAdministrator = (role: string): boolean => normalizeUserRole(role) === "SUPER_ADMIN";

export const USER_ROLES: UserRole[] = [
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
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

export const COLLEGE_STAFF_CATEGORIES = [
  "SECURITY_GUARD",
  "HOUSEKEEPING",
  "RECEPTIONIST",
  "OFFICE_ASSISTANT",
  "TRANSPORT",
  "IT_STAFF",
  "OTHER"
] as const;

export const COLLEGE_STAFF_CATEGORY_LABELS: Record<(typeof COLLEGE_STAFF_CATEGORIES)[number], string> = {
  SECURITY_GUARD: "Security Guards",
  HOUSEKEEPING: "Sweepers / Housekeeping",
  RECEPTIONIST: "Receptionists",
  OFFICE_ASSISTANT: "Office Assistants",
  TRANSPORT: "Drivers / Transport Staff",
  IT_STAFF: "IT Staff",
  OTHER: "Other Staff"
};

export const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"] as const;

export const PUBLIC_REGISTER_ROLES: UserRole[] = ["PARENT"];

export const TENANT_STAFF_ROLES: UserRole[] = [
  "COLLEGE_ADMIN",
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

export const LIBRARY_MANAGER_ROLES: UserRole[] = ["SUPER_ADMIN", "COLLEGE_ADMIN", "LIBRARY_STAFF"];

export const LABORATORY_MANAGER_ROLES: UserRole[] = ["SUPER_ADMIN", "COLLEGE_ADMIN", "LABORATORY_STAFF"];

export const ACCOUNTING_MANAGER_ROLES: UserRole[] = ["SUPER_ADMIN", "COLLEGE_ADMIN", "ACCOUNTANT"];

/** Cashier — fee collection and receipt operations only */
export const ACCOUNTING_CASHIER_ROLES: UserRole[] = ["CASHIER"];

/** Auditor — read-only access to all financial records */
export const ACCOUNTING_AUDITOR_ROLES: UserRole[] = ["AUDITOR"];

/** All roles with any accounting module access */
export const ACCOUNTING_ACCESS_ROLES: UserRole[] = [
  "SUPER_ADMIN",
  "COLLEGE_ADMIN",
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

export const LABORATORY_TYPES = ["COMPUTER", "PHYSICS", "CHEMISTRY", "BIOLOGY", "OTHER"] as const;

export const DEFAULT_LAB_CATEGORIES: Record<(typeof LABORATORY_TYPES)[number], string[]> = {
  COMPUTER: [
    "Computers",
    "Laptops",
    "Monitors",
    "Keyboards",
    "Mouse",
    "Printers",
    "UPS",
    "Projectors",
    "Networking Devices",
    "Software/Licenses",
    "Other Equipment"
  ],
  PHYSICS: [
    "Measuring Instruments",
    "Electrical Equipment",
    "Optical Equipment",
    "Mechanical Equipment",
    "Safety Equipment",
    "Other Equipment"
  ],
  CHEMISTRY: [
    "Chemicals",
    "Glassware",
    "Laboratory Instruments",
    "Measuring Equipment",
    "Safety Equipment",
    "Other Equipment"
  ],
  BIOLOGY: [
    "Microscopes",
    "Slides",
    "Models & Specimens",
    "Dissection Kits",
    "Laboratory Instruments",
    "Safety Equipment",
    "Other Equipment"
  ],
  OTHER: ["Other Equipment"]
};

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

export const INSTITUTION_TYPES = ["SCHOOL", "COLLEGE"] as const;

export const CLASS_LEVELS = ["ECD", "Class 1", "Class 2", "Class 3", "Class 4", "Class 5", "Class 6", "Class 7", "Class 8", "Class 9", "Class 10", "Class 11", "Class 12"] as const;

export const COLLEGE_YEAR_NAMES = ["1st Year", "2nd Year", "3rd Year"] as const;

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
