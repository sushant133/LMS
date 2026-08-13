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
  SCHOOL_ADMIN: "COLLEGE_ADMIN",
  school_admin: "COLLEGE_ADMIN",
  Administrator: "COLLEGE_ADMIN",
  ADMINISTRATOR: "COLLEGE_ADMIN"
};

export const normalizeUserRole = (role: string): UserRole => {
  const raw = String(role ?? "").trim();
  if (!raw) return "COLLEGE_STAFF";
  // Prefer exact alias, then uppercase key (DB/role strings may vary in case)
  if (LEGACY_USER_ROLE_ALIASES[raw]) return LEGACY_USER_ROLE_ALIASES[raw]!;
  const upper = raw.toUpperCase();
  if (LEGACY_USER_ROLE_ALIASES[upper]) return LEGACY_USER_ROLE_ALIASES[upper]!;
  return upper as UserRole;
};

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

/**
 * @deprecated Global College Administrator ban was removed.
 * Writes are controlled by Module Access (NONE / READ_ONLY / WRITE per module).
 * Kept for older clients that still display this string on 403.
 */
export const READ_ONLY_ACCESS_MESSAGE =
  "This action is not allowed for your Module Access. Ask an administrator to grant Manage on the module.";

export const getInstitutionPermissions = (role: string) => {
  const normalized = normalizeUserRole(role);

  // College Administrator: institution-wide read; writes come from Module Access matrix.
  // canWrite here is legacy (auth payload only) — clients must use moduleAccess, not this flag.
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
  "ANNUAL",
  /** Admission caution / security deposit (liability — not fee income). */
  "SECURITY_DEPOSIT"
] as const;

export const PAYMENT_METHODS = [
  "CASH",
  "BANK_TRANSFER",
  "CHEQUE",
  "ESEWA",
  "KHALTI",
  "IMEPAY",
  "FONEPAY",
  "CONNECT_IPS",
  "ONLINE",
  "OTHER"
] as const;

export const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank Deposit",
  CHEQUE: "Cheque",
  ESEWA: "eSewa",
  KHALTI: "Khalti",
  IMEPAY: "IME Pay",
  FONEPAY: "Fonepay",
  CONNECT_IPS: "Connect IPS",
  ONLINE: "Online",
  OTHER: "Other"
};

/**
 * Payment methods where staff often receive cash/voucher in person —
 * show "Received by" and "Paid by / Depositor" fields.
 */
export const PAYMENT_METHODS_WITH_HANDOVER = [
  "CASH",
  "BANK_TRANSFER",
  "CHEQUE",
  "OTHER"
] as const;

export const FEE_STRUCTURE_STATUSES = ["ACTIVE", "ARCHIVED"] as const;

/** Daily expense register categories (Nepal college). Legacy labels kept for old records. */
export const EXPENSE_CATEGORIES = [
  "Electricity",
  "Water",
  "Internet",
  "Fuel",
  "Maintenance",
  "Office",
  "Office Expenses",
  "Printing",
  "Travel",
  "Community Field",
  "Hospital",
  "Library",
  "Laboratory",
  "Furniture",
  "Sports",
  "Transport",
  "Events",
  "Miscellaneous"
] as const;

/** Purchase register categories. Legacy labels kept for old records. */
export const PURCHASE_CATEGORIES = [
  "Laboratory Equipment",
  "Books",
  "Furniture",
  "Stationery",
  "Computer Equipment",
  "Computers",
  "Chemicals",
  "Medical Equipment",
  "Office Supplies",
  "Sports Equipment",
  "Other Assets",
  "Others"
] as const;

/** Non-fee income categories. Legacy labels kept for old records. */
export const INCOME_CATEGORIES = [
  "Donation",
  "Donations",
  "Certificate Fee",
  "Form Sales",
  "Fine",
  "Interest",
  "Miscellaneous Income",
  "Government Grants",
  "Admission Income",
  "Transport Income",
  "Hostel Income"
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
 * Library catalog shelf classification.
 *
 * Year levels cover the HA course books; the last three cover everything that
 * is not tied to a course year:
 *   "All Years"       — course book shared across every year
 *   "Reference Books" — dictionaries, atlases, handbooks (usually read in-library)
 *   "Other Books"     — novels, magazines, competition prep, donations
 */
/**
 * Year / Book type a library book is shelved under.
 *
 * Mixes study years, programme streams (ANM / MLT / Civil), and general
 * categories in one list because the library files books by whichever of those
 * applies — a programme-specific title is not tied to a single year.
 *
 * Values are stored verbatim on LibraryBook.yearLevel and are the model's enum,
 * so renaming an entry orphans existing books; add rather than rename.
 */
export const LIBRARY_YEAR_LEVELS = [
  "1st Year",
  "2nd Year",
  "3rd Year",
  "All Years",
  "ANM",
  "MLT",
  "Civil",
  "Reference Books",
  "Other Books"
] as const;

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
  PENDING_NOT_PASSED: "Back",
  PASSED_OUT: "Passed Out",
  ALUMNI: "Alumni",
  WITHDRAWN: "Dropped Out",
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

/**
 * CTEVT fee payment status (Examination Management → CTEVT → Registration / Exam).
 * Same values for registration fee and exam fee.
 */
export const CTEVT_FEE_STATUSES = ["PAID", "NOT_PAID"] as const;

/** @deprecated Use CTEVT_FEE_STATUSES */
export const CTEVT_REGISTRATION_FEE_STATUSES = CTEVT_FEE_STATUSES;

export const CTEVT_FEE_STATUS_LABELS: Record<
  (typeof CTEVT_FEE_STATUSES)[number],
  string
> = {
  PAID: "Paid",
  NOT_PAID: "Not Paid"
};

/** @deprecated Use CTEVT_FEE_STATUS_LABELS */
export const CTEVT_REGISTRATION_FEE_STATUS_LABELS = CTEVT_FEE_STATUS_LABELS;

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

/** Common Nepal caste/ethnicity groupings for equity reporting (flexible for IEMIS). */
export const ETHNICITY_CATEGORIES = [
  "Brahmin / Chhetri",
  "Dalit",
  "Janajati / Indigenous",
  "Madhesi",
  "Muslim",
  "Other",
  "Prefer not to say"
] as const;

/**
 * Main religions in Nepal (2021 census order + minor recognized groups).
 * Hinduism ~81%, Buddhism ~8%, Islam ~5%, Kirat ~3%, Christianity ~1.8%,
 * Prakriti, Bon, Sikhism, Jainism.
 */
export const RELIGIONS = [
  "Hinduism",
  "Buddhism",
  "Islam",
  "Kirat",
  "Christianity",
  "Prakriti",
  "Bon",
  "Sikhism",
  "Jainism",
  "Other",
  "Prefer not to say"
] as const;

/**
 * Castes / community identities commonly associated with each religion in Nepal.
 * "Caste" here includes jati and related community labels used on school forms
 * (hill/Madhesi Hindu castes, Buddhist ethnic groups, Muslim biradari, Kirat peoples).
 * Lists are practical for admission forms — not an exhaustive anthropological census.
 */
export const CASTES_BY_RELIGION = {
  Hinduism: [
    // Hill / Khas
    "Bahun (Brahmin)",
    "Chhetri",
    "Thakuri",
    "Sanyasi / Dasnami",
    // Newar
    "Newar",
    // Major Janajati communities (many practice Hinduism)
    "Magar",
    "Gurung",
    "Tamang",
    "Rai",
    "Limbu",
    "Tharu",
    "Sherpa",
    "Thakali",
    "Rajbanshi",
    // Madhesi / Terai
    "Yadav",
    "Teli",
    "Kalwar",
    "Kurmi",
    "Kushwaha / Koeri",
    "Kayastha",
    "Maithil Brahmin",
    "Baniya / Marwari",
    "Halwai",
    "Sonar",
    "Hajam / Thakur",
    "Kanu",
    "Mallah",
    "Dhanuk",
    // Hill Dalit
    "Kami",
    "Damai / Dholi",
    "Sarki",
    "Badi",
    "Gaine / Gandarbha",
    // Terai Dalit
    "Chamar / Harijan",
    "Musahar",
    "Dusadh / Paswan",
    "Dom",
    "Tatma",
    "Khatwe",
    "Other",
    "Prefer not to say"
  ],
  Buddhism: [
    "Tamang",
    "Gurung",
    "Sherpa",
    "Newar (Buddhist)",
    "Magar",
    "Thakali",
    "Hyolmo / Yolmo",
    "Lepcha",
    "Bhote / Tibetan",
    "Jirel",
    "Other",
    "Prefer not to say"
  ],
  Islam: [
    "Ansari",
    "Sheikh",
    "Pathan",
    "Sayyid",
    "Mughal",
    "Dhuniya",
    "Hajam",
    "Fakir",
    "Other",
    "Prefer not to say"
  ],
  Kirat: [
    "Rai",
    "Limbu",
    "Yakkha",
    "Sunwar / Sunuwar",
    "Dhimal",
    "Jirel",
    "Other",
    "Prefer not to say"
  ],
  Christianity: [
    // Converts retain diverse ethnic/caste origins; offer common communities + N/A
    "Not applicable",
    "Bahun (Brahmin)",
    "Chhetri",
    "Newar",
    "Magar",
    "Gurung",
    "Tamang",
    "Rai",
    "Limbu",
    "Tharu",
    "Dalit (general)",
    "Other",
    "Prefer not to say"
  ],
  Prakriti: [
    "Tharu",
    "Magar",
    "Rai",
    "Limbu",
    "Other",
    "Prefer not to say"
  ],
  Bon: [
    "Hyolmo / Yolmo",
    "Sherpa",
    "Bhote / Tibetan",
    "Other",
    "Prefer not to say"
  ],
  Sikhism: [
    "Sikh",
    "Other",
    "Prefer not to say"
  ],
  Jainism: [
    "Jain",
    "Other",
    "Prefer not to say"
  ],
  Other: [
    "Other",
    "Prefer not to say"
  ],
  "Prefer not to say": [
    "Prefer not to say",
    "Other"
  ]
} as const;

/** Flat unique list of all caste options (for type unions / loose validation). */
export const ALL_CASTES = Array.from(
  new Set(
    (Object.values(CASTES_BY_RELIGION) as readonly (readonly string[])[]).flat()
  )
) as readonly string[];

export function getCastesForReligion(
  religion: string | undefined | null
): readonly string[] {
  if (!religion || !(religion in CASTES_BY_RELIGION)) {
    return [];
  }
  return CASTES_BY_RELIGION[religion as keyof typeof CASTES_BY_RELIGION];
}

export function isValidCasteForReligion(
  religion: string | undefined | null,
  caste: string | undefined | null
): boolean {
  if (!caste) return true;
  if (!religion) return false;
  const options = getCastesForReligion(religion);
  return options.includes(caste);
}

// Document types for student/teacher records and admissions
export const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** Timetable session kinds (optional on slot; default THEORY for legacy rows). */
export const TIMETABLE_SESSION_TYPES = [
  "THEORY",
  "PRACTICAL",
  "SPORTS",
  "BREAK",
  "HOLIDAY",
  "EXAM",
  "SPECIAL",
  "ONLINE",
  "GUEST"
] as const;

export const TIMETABLE_ROOM_KINDS = ["CLASSROOM", "LABORATORY", "OTHER"] as const;

/**
 * Staff duty timetable kinds. Deliberately separate from TIMETABLE_SESSION_TYPES:
 * a non-teaching staff roster has no theory/practical distinction, and the two
 * lists would drift if shared.
 *
 * DUTY occupies a numbered period column; BREAK and DAY_OFF do not and take a
 * synthetic period key derived from their start time (see periodNumberFromStartTime).
 */
export const STAFF_TIMETABLE_SESSION_TYPES = ["DUTY", "BREAK", "DAY_OFF"] as const;

export const STAFF_TIMETABLE_SESSION_TYPE_LABELS: Record<
  (typeof STAFF_TIMETABLE_SESSION_TYPES)[number],
  string
> = {
  DUTY: "Duty",
  BREAK: "Break",
  DAY_OFF: "Day off"
};

/** Common break labels for Nepali college schedules. */
export const TIMETABLE_BREAK_LABELS = [
  "Tiffin Break",
  "Lunch Break",
  "Tea Break",
  "Assembly",
  "Prayer",
  "Custom"
] as const;

export const DAILY_ATTENDANCE_STATUSES = [
  "PRESENT",
  "ABSENT",
  "LEAVE",
  "LATE",
  "MEDICAL_LEAVE",
  "EARLY_LEAVE"
] as const;

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

/**
 * Global max size for document uploads across the LMS (student docs, HR docs,
 * library docs, complaints, academic attachments, results, etc.).
 * Photos / banners / ebooks / video assignments use separate limits.
 */
export const DOCUMENT_MAX_SIZE_BYTES = 600 * 1024;

/** @deprecated Use DOCUMENT_MAX_SIZE_BYTES — kept as alias for existing imports. */
export const STUDENT_DOCUMENT_MAX_SIZE_BYTES = DOCUMENT_MAX_SIZE_BYTES;

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

/**
 * Document categories for teachers and non-teaching college staff (CV, degree, etc.).
 * All optional — records can be created without files and documents uploaded later.
 */
export const HR_DOCUMENT_CATEGORIES = [
  { key: "PROFILE_PHOTOGRAPH", label: "Profile Photograph", required: false, allowMultiple: false, allowCustomName: false },
  { key: "CV", label: "CV / Resume", required: false, allowMultiple: false, allowCustomName: false },
  { key: "DEGREE", label: "Degree Certificate", required: false, allowMultiple: true, allowCustomName: false },
  { key: "CERTIFICATE", label: "Certificate", required: false, allowMultiple: true, allowCustomName: false },
  { key: "EXPERIENCE_LETTER", label: "Experience Letter", required: false, allowMultiple: true, allowCustomName: false },
  { key: "CITIZENSHIP_NATIONAL_ID", label: "Citizenship / National ID", required: false, allowMultiple: false, allowCustomName: false },
  { key: "APPOINTMENT_LETTER", label: "Appointment Letter", required: false, allowMultiple: false, allowCustomName: false },
  { key: "OTHER", label: "Other Documents", required: false, allowMultiple: true, allowCustomName: true }
] as const;

export const HR_DOCUMENT_STATUSES = STUDENT_DOCUMENT_STATUSES;
/** Align with backend teacher/staff document multer limit (PDF + Office + images). */
export const HR_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
] as const;
/** Same global document cap as DOCUMENT_MAX_SIZE_BYTES (600 KB). */
export const HR_DOCUMENT_MAX_SIZE_BYTES = DOCUMENT_MAX_SIZE_BYTES;

/** Default designation when a teacher is created without one. */
export const DEFAULT_TEACHER_DESIGNATION = "Teacher";

export const getHrDocumentCategoryLabel = (type: string): string =>
  HR_DOCUMENT_CATEGORIES.find((item) => item.key === type)?.label ?? type;
