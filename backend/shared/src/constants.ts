import type { GradeSymbol, UserRole } from "./types.js";

export const USER_ROLES: UserRole[] = [
  "SUPER_ADMIN",
  "SCHOOL_ADMIN",
  "TEACHER",
  "STUDENT",
  "PARENT",
  "LIBRARY_STAFF",
  "LABORATORY_STAFF",
  "ACCOUNTANT"
];

export const PUBLIC_REGISTER_ROLES: UserRole[] = ["PARENT"];

export const TENANT_STAFF_ROLES: UserRole[] = [
  "SCHOOL_ADMIN",
  "TEACHER",
  "STUDENT",
  "PARENT",
  "LIBRARY_STAFF",
  "LABORATORY_STAFF",
  "ACCOUNTANT"
];

export const LIBRARY_MANAGER_ROLES: UserRole[] = ["SCHOOL_ADMIN", "LIBRARY_STAFF"];

export const LABORATORY_MANAGER_ROLES: UserRole[] = ["SCHOOL_ADMIN", "LABORATORY_STAFF"];

export const ACCOUNTING_MANAGER_ROLES: UserRole[] = ["SCHOOL_ADMIN", "ACCOUNTANT"];

export const FEE_TYPES = [
  "ADMISSION",
  "TUITION",
  "MONTHLY",
  "EXAM",
  "LIBRARY",
  "LAB",
  "TRANSPORT",
  "HOSTEL",
  "OTHER",
  "ANNUAL"
] as const;

export const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "CHEQUE", "ONLINE", "OTHER"] as const;

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

export const CLASS_LEVELS = ["ECD", "Class 1", "Class 2", "Class 3", "Class 4", "Class 5", "Class 6", "Class 7", "Class 8", "Class 9", "Class 10", "Class 11", "Class 12"] as const;

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
