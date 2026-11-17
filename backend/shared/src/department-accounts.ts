import { z } from "zod";
import {
  ATTENDANCE_MANAGEMENT_MODULE_KEYS,
  EXAMINATION_MANAGEMENT_MODULE_KEYS,
  isAcademicStructurePath,
  isAttendanceManagementPath,
  isExaminationManagementPath,
  isStaffDirectoryPath,
  resolveModuleFromApiPath,
  resolveModuleFromRoutePath,
  STAFF_DIRECTORY_MODULE_KEYS,
  type ErpModuleKey,
  type ModuleAccessMap,
  type ModuleAccessMode
} from "./module-access.js";
import { portalLoginIdSchema, portalPasswordSchema } from "./schemas.js";

/**
 * Department Accounts — single shared logins created by the Administrator from
 * Settings (not linked to any staff record, no Module Access configuration).
 *
 * Each account is an Administrator (COLLEGE_ADMIN) login confined to one
 * department, so every existing admin screen and API behaves exactly as it
 * does for the Administrator — only inside that department. Accounting and
 * Examination work at staff level (see `isDepartmentAdminOnlyRequest`).
 */
export const DEPARTMENT_ACCOUNT_TYPES = ["ACCOUNTING", "EXAMINATION", "ACADEMICS"] as const;

export type DepartmentAccountType = (typeof DEPARTMENT_ACCOUNT_TYPES)[number];

export const DEPARTMENT_ACCOUNT_LABELS: Record<DepartmentAccountType, string> = {
  ACCOUNTING: "Accounting",
  EXAMINATION: "Examination Management",
  ACADEMICS: "Academics"
};

export const DEPARTMENT_ACCOUNT_DESCRIPTIONS: Record<DepartmentAccountType, string> = {
  ACCOUNTING:
    "Accounting, fee management, finance archive, HR payroll, and the academic calendar. Staff-level: delete, approve and setup stay with the Administrator.",
  EXAMINATION:
    "College exams, marks, results, marksheets, CTEVT exam fees, the academic calendar, and view-only Library (due books and overdue fines). Staff-level: exam sessions, delete, approve and publish stay with the Administrator.",
  ACADEMICS:
    "Student attendance, academic management, timetable, field management and reports — plus view-only access to students, the academic calendar, library, laboratory and inventory."
};

export const isDepartmentAccountType = (value: unknown): value is DepartmentAccountType =>
  typeof value === "string" && (DEPARTMENT_ACCOUNT_TYPES as readonly string[]).includes(value);

const W: ModuleAccessMode = "WRITE";
const R: ModuleAccessMode = "READ_ONLY";

/**
 * Fixed module map per department. Not editable by the admin — the department
 * type alone decides what the account can open.
 * READ_ONLY entries are reference data the department's screens need
 * (student / batch pickers).
 */
export const DEPARTMENT_ACCOUNT_MODULES: Record<DepartmentAccountType, ModuleAccessMap> = {
  ACCOUNTING: {
    dashboard: W,
    profile: W,
    accounts: W,
    fees: W,
    "finance-management": W,
    hr: W,
    // No notices: the notice board is for college staff
    "academic-calendar": R,
    students: R,
    academics: R,
    // Payroll: salary sheet deducts leave/absence from teacher & staff attendance
    teachers: R,
    staff: R,
    "teacher-attendance": R,
    "staff-attendance": R
  },
  EXAMINATION: {
    dashboard: W,
    profile: W,
    examinations: W,
    "examinations-college": W,
    "examinations-ctevt": W,
    results: W,
    // View only: due books and overdue fines (exam clearance checks)
    library: R,
    // No notices: the notice board is for college staff
    "academic-calendar": R,
    students: R,
    academics: R
  },
  ACADEMICS: {
    dashboard: W,
    profile: W,
    // Student Attendance only — teacher / staff attendance are not granted
    attendance: W,
    "daily-attendance": W,
    "field-duty": W,
    // All Academic Management tools except Syllabus Completion (ACADEMICS_BLOCKED_API_PATTERNS)
    "academic-management": W,
    homework: W,
    timetable: W,
    reports: W,
    // View only (in the menu, no add / edit / delete / import)
    students: R,
    "academic-calendar": R,
    library: R,
    laboratory: R,
    inventory: R,
    // Reference data only. Their screens are blocked (ACADEMICS_BLOCKED_ROUTE_PREFIXES),
    // but timetable, attendance, library, lab, field duty and academic management
    // pickers read these lists.
    academics: R,
    teachers: R,
    staff: R,
    "subject-assignment": R
    // Removed: notices, banners, complaints, parents, academic-structure,
    // teacher-attendance, staff-attendance, transport, hostel
  }
};

/**
 * View-only modules that still appear in a department's menu. Other
 * READ_ONLY entries are reference data for pickers and stay out of the sidebar.
 */
const DEPARTMENT_NAV_READ_MODULES: Record<DepartmentAccountType, readonly ErpModuleKey[]> = {
  ACCOUNTING: ["academic-calendar"],
  EXAMINATION: ["academic-calendar", "library"],
  ACADEMICS: ["academic-calendar", "students", "library", "laboratory", "inventory"]
};

/**
 * Screens a department may never open even though their module is granted as
 * reference data (READ_ONLY for pickers) or shares a URL with a granted module.
 */
const DEPARTMENT_BLOCKED_ROUTES_BY_TYPE: Record<DepartmentAccountType, readonly string[]> = {
  ACCOUNTING: [],
  EXAMINATION: [],
  ACADEMICS: [
    "/teachers",
    "/college-staff",
    "/academics",
    "/parent-links",
    "/notices",
    "/banners",
    "/complaints",
    "/complains",
    "/transport",
    "/hostel"
  ]
};

/**
 * APIs a department may never call even though the owning module is granted:
 * Syllabus Completion (inside Academic Management) and the teacher / staff
 * attendance registers (which share /attendance-register with students).
 */
const DEPARTMENT_BLOCKED_API_PATTERNS: Record<DepartmentAccountType, readonly RegExp[]> = {
  ACCOUNTING: [],
  // Exam Sessions tab is the Administrator's: routine editing and exam analytics.
  // (GET /exams/routines — the list Admit Card / Attendance Sheet read — is not matched.)
  // Creating / editing the exam session itself is refused in isDepartmentAdminOnlyRequest.
  EXAMINATION: [/^\/exams\/[^/]+\/routines(\/|$)/, /^\/exams\/[^/]+\/analytics(\/|$)/],
  ACADEMICS: [
    /^\/academic-management\/syllabus-oversight(\/|$)/,
    /^\/academic-management\/reports\/syllabus-completion(\/|$)/,
    /^\/attendance-register\/(teachers|staff)(\/|$)/,
    // Notice attachments live under the shared /uploads prefix
    /^\/uploads\/notices(\/|$)/
  ]
};

/**
 * Notification types each department receives. Department Accounts are
 * Administrator logins, so every "notify the administrators" fan-out reaches
 * them — this keeps only the ones about their own department.
 * Notices and academic calendar events go to every department.
 */
export const DEPARTMENT_NOTIFICATION_TYPES: Record<DepartmentAccountType, readonly string[]> = {
  ACCOUNTING: ["FEE", "PAYROLL", "NOTICE", "ACADEMIC_CALENDAR"],
  EXAMINATION: ["EXAM", "NOTICE", "ACADEMIC_CALENDAR"],
  ACADEMICS: [
    "ATTENDANCE",
    "HOMEWORK",
    "NOTICE",
    "TRANSPORT",
    "LIBRARY",
    "LABORATORY",
    "COMPLAINT",
    "ACADEMIC_MANAGEMENT",
    "ACADEMIC_CALENDAR",
    "ACADEMIC_PROMOTION",
    "TIMETABLE",
    // Daily summary (attendance, log book, lesson plans, library)
    "GENERAL"
  ]
};

export const isNotificationForDepartment = (
  type: DepartmentAccountType,
  notificationType: string | null | undefined
): boolean => DEPARTMENT_NOTIFICATION_TYPES[type].includes(notificationType || "GENERAL");

export const getDepartmentModuleAccess =(type: DepartmentAccountType): ModuleAccessMap => ({
  ...DEPARTMENT_ACCOUNT_MODULES[type]
});

/**
 * API prefixes that no ERP module owns but a department still needs.
 * Everything else outside the department's modules is refused.
 */
const DEPARTMENT_SHARED_API_PREFIXES = ["/addresses", "/uploads"];
const DEPARTMENT_SHARED_READ_API_PREFIXES = ["/schools"];
const DEPARTMENT_EXTRA_API_PREFIXES: Record<DepartmentAccountType, string[]> = {
  ACCOUNTING: [],
  EXAMINATION: [],
  ACADEMICS: ["/character-certificates"]
};

const normalizeApiPath = (apiPath: string): string => {
  const path = (apiPath.split("?")[0] ?? apiPath).replace(/\/{2,}/g, "/");
  const stripped = path.startsWith("/api/") || path === "/api" ? path.slice(4) || "/" : path;
  return stripped.startsWith("/") ? stripped : `/${stripped}`;
};

const matchesPrefix = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(`${prefix}/`);

/**
 * Module that owns an API path for department scoping. Same as
 * `resolveModuleFromApiPath` except endpoints that live under another
 * module's URL but belong to a different department.
 */
export const resolveDepartmentModuleForApiPath = (apiPath: string): ErpModuleKey | null => {
  const path = normalizeApiPath(apiPath);
  // CTEVT registration / exam fees are Examination Management → CTEVT
  if (/^\/students\/ctevt-(registration|exam)-fee(\/|$)/.test(path)) return "examinations-ctevt";
  // Fee dues widget + reminders are Fee Management data
  if (matchesPrefix(path, "/dashboard/fee-dues")) return "fees";
  return resolveModuleFromApiPath(path);
};

/**
 * Screen sections (tabs inside a granted module) a department account does not
 * get. The API behind each is refused too (DEPARTMENT_BLOCKED_API_PATTERNS /
 * isDepartmentAdminOnlyRequest).
 */
export type DepartmentHiddenSection = "exam-sessions";

const DEPARTMENT_HIDDEN_SECTIONS: Record<DepartmentAccountType, readonly DepartmentHiddenSection[]> = {
  ACCOUNTING: [],
  EXAMINATION: ["exam-sessions"],
  ACADEMICS: []
};

/**
 * Administrator-only screen sections a department may still view (read only).
 * Examination: Library → Overdue Fines, to check students' dues.
 */
export type DepartmentViewSection = "library-fines";

const DEPARTMENT_VIEW_SECTIONS: Record<DepartmentAccountType, readonly DepartmentViewSection[]> = {
  ACCOUNTING: [],
  EXAMINATION: ["library-fines"],
  ACADEMICS: []
};

export const canDepartmentViewSection = (
  type: DepartmentAccountType | null | undefined,
  section: DepartmentViewSection
): boolean => Boolean(type && DEPARTMENT_VIEW_SECTIONS[type].includes(section));

export const isDepartmentSectionHidden = (
  type: DepartmentAccountType | null | undefined,
  section: DepartmentHiddenSection
): boolean => Boolean(type && DEPARTMENT_HIDDEN_SECTIONS[type].includes(section));

/**
 * True when a department account is refused this API even though the owning
 * module is granted (e.g. Academics → Syllabus Completion). The UI uses this
 * to hide the matching tabs.
 */
export const isDepartmentApiBlocked = (type: DepartmentAccountType, apiPath: string): boolean => {
  const path = normalizeApiPath(apiPath);
  return DEPARTMENT_BLOCKED_API_PATTERNS[type].some((pattern) => pattern.test(path));
};

/**
 * Decide whether a department account may call an API.
 * Self-service paths (auth, notifications, shared reference lists) are
 * allowed before this runs.
 */
export const canDepartmentAccessApi = (
  type: DepartmentAccountType,
  method: string,
  apiPath: string
): boolean => {
  const path = normalizeApiPath(apiPath);
  const isRead = ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());

  if (isDepartmentApiBlocked(type, path)) return false;
  if (DEPARTMENT_SHARED_API_PREFIXES.some((prefix) => matchesPrefix(path, prefix))) return true;
  if (isRead && DEPARTMENT_SHARED_READ_API_PREFIXES.some((prefix) => matchesPrefix(path, prefix))) {
    return true;
  }
  if (DEPARTMENT_EXTRA_API_PREFIXES[type].some((prefix) => matchesPrefix(path, prefix))) return true;

  const moduleKey = resolveDepartmentModuleForApiPath(path);
  if (!moduleKey) return false;
  const mode = DEPARTMENT_ACCOUNT_MODULES[type][moduleKey];
  if (mode === "WRITE") return true;
  if (mode === "READ_ONLY") return isRead;
  return false;
};

/**
 * Departments whose account works at staff level, like an Accountant or
 * exam-office staff: they view, create and edit, but deleting, approving and
 * setup stay with the Administrator.
 */
export const STAFF_LEVEL_DEPARTMENT_ACCOUNTS: readonly DepartmentAccountType[] = [
  "ACCOUNTING",
  "EXAMINATION"
];

export const isStaffLevelDepartmentAccount = (value: unknown): value is DepartmentAccountType =>
  isDepartmentAccountType(value) && STAFF_LEVEL_DEPARTMENT_ACCOUNTS.includes(value);

export const DEPARTMENT_ADMIN_ONLY_MESSAGE =
  "Only the Administrator can delete, approve, publish, lock or change setup. Contact the Administrator.";

/** Approve / reject / publish / lock / reverse style actions (last path segments). */
const DEPARTMENT_ADMIN_ACTION_PATTERN =
  /\/(?:approve|unapprove|reject|return|review|edit-review|publish|unpublish|lock|unlock|reverse|revoke|void|dispose|close|delete|reset-password)(?:\/|$)/i;

/** Leave / stock request status changes are approvals. */
const DEPARTMENT_ADMIN_STATUS_PATTERN = /\/(?:leaves|stock-requests)\/[^/]+\/status(?:\/|$)/i;

/** Setup screens Accountant staff cannot change (settings, chart of accounts, staff…). */
const ACCOUNTING_ADMIN_ONLY_WRITE_PREFIXES = [
  "/accounting/settings",
  "/accounting/structures",
  "/accounting/bank-accounts",
  "/accounting/chart-of-accounts",
  "/accounting/fiscal-years",
  "/accounting/depreciation",
  "/accounting/budgets",
  "/accounting/accountants",
  "/accounting/security-deposits",
  "/accounting/salaries",
  "/fees/structures",
  "/finance/categories",
  "/finance/staff-access"
];

/**
 * Academic Management actions only the Administrator may take. The Academics
 * account verifies and returns records to the teacher (`/verify`, `/return`,
 * `/unverify`, log book `/review`); approving, unapproving, rejecting,
 * unlocking, bulk approval and faculty setup are refused. Approved records are
 * also frozen for it in the controllers (assertDepartmentAccountCanChangeAcademic).
 */
const ACADEMICS_ADMIN_ONLY_API_PATTERNS: readonly RegExp[] = [
  /^\/academic-management\/[^/]+\/[^/]+\/(approve|unapprove|reject|unlock)(\/|$)/,
  /^\/academic-management\/approvals\/approve-all(\/|$)/,
  /^\/academic-management\/faculties(\/|$)/
];

/**
 * True when a staff-level department account may not make this request
 * because only the Administrator can: any delete, any approval-type action,
 * editing a posted fee payment, and Accounting setup.
 */
export const isDepartmentAdminOnlyRequest = (
  type: DepartmentAccountType,
  method: string,
  apiPath: string
): boolean => {
  const verb = method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(verb)) return false;
  const path = normalizeApiPath(apiPath);

  // Academics: Academic Management approvals and setup stay with the Administrator
  if (type === "ACADEMICS") {
    return ACADEMICS_ADMIN_ONLY_API_PATTERNS.some((pattern) => pattern.test(path));
  }
  // Examination: creating / editing exam sessions is the Administrator's (Exam Sessions tab)
  if (type === "EXAMINATION") {
    if (verb === "POST" && path === "/exams") return true;
    if ((verb === "PUT" || verb === "PATCH") && /^\/exams\/[^/]+$/.test(path)) return true;
  }
  if (!STAFF_LEVEL_DEPARTMENT_ACCOUNTS.includes(type)) return false;

  // Own uploads / address lookups are not department records
  if (DEPARTMENT_SHARED_API_PREFIXES.some((prefix) => matchesPrefix(path, prefix))) return false;
  if (verb === "DELETE") return true;
  if (DEPARTMENT_ADMIN_ACTION_PATTERN.test(path)) return true;
  if (DEPARTMENT_ADMIN_STATUS_PATTERN.test(path)) return true;

  if (type === "ACCOUNTING") {
    if (ACCOUNTING_ADMIN_ONLY_WRITE_PREFIXES.some((prefix) => matchesPrefix(path, prefix))) return true;
    // Editing a posted fee payment is a reversal of the books
    if (verb === "PUT" && /^\/accounting\/collections\/[^/]+$/.test(path)) return true;
  }
  return false;
};

/** Frontend paths a department account may never open (institution administration). */
export const DEPARTMENT_BLOCKED_ROUTE_PREFIXES = [
  "/settings",
  "/admin-management",
  "/college-administrators",
  "/schools",
  "/colleges"
];

/** Frontend paths every department account keeps (landing + own notifications). */
const DEPARTMENT_ALWAYS_ROUTE_PREFIXES = ["/dashboard", "/notifications", "/profile"];

const routeModuleKeys = (pathname: string): ErpModuleKey[] | null => {
  if (isExaminationManagementPath(pathname)) return [...EXAMINATION_MANAGEMENT_MODULE_KEYS];
  if (isAcademicStructurePath(pathname)) return ["academic-structure"];
  if (isStaffDirectoryPath(pathname)) return [...STAFF_DIRECTORY_MODULE_KEYS];
  if (isAttendanceManagementPath(pathname)) return [...ATTENDANCE_MANAGEMENT_MODULE_KEYS];
  const moduleKey = resolveModuleFromRoutePath(pathname);
  return moduleKey ? [moduleKey] : null;
};

/**
 * May a department account open this screen?
 * - `nav`: sidebar — only the department's own (WRITE) modules
 * - `route`: direct links — also read-only reference screens (e.g. a student
 *   profile linked from a fee receipt); the API still refuses writes there.
 */
export const canDepartmentAccessRoute = (
  type: DepartmentAccountType,
  pathname: string,
  purpose: "route" | "nav" = "route"
): boolean => {
  const path = (pathname.split("?")[0] ?? pathname) || "/";
  if (DEPARTMENT_BLOCKED_ROUTE_PREFIXES.some((prefix) => matchesPrefix(path, prefix))) return false;
  if (DEPARTMENT_BLOCKED_ROUTES_BY_TYPE[type].some((prefix) => matchesPrefix(path, prefix))) return false;
  if (DEPARTMENT_ALWAYS_ROUTE_PREFIXES.some((prefix) => matchesPrefix(path, prefix))) return true;

  const keys = routeModuleKeys(path);
  if (!keys) return false;
  const modules = DEPARTMENT_ACCOUNT_MODULES[type];
  return keys.some((key) => {
    const mode = modules[key];
    if (mode === "WRITE") return true;
    if (mode !== "READ_ONLY") return false;
    return purpose === "route" || DEPARTMENT_NAV_READ_MODULES[type].includes(key);
  });
};

export const departmentAccountSchema = z.object({
  departmentType: z.enum(DEPARTMENT_ACCOUNT_TYPES),
  fullName: z.string().trim().min(2, "Account name must be at least 2 characters").max(120),
  email: portalLoginIdSchema,
  phone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined)),
  password: portalPasswordSchema,
  mustChangePassword: z.boolean().optional().default(false)
});

export const departmentAccountUpdateSchema = z.object({
  fullName: z.string().trim().min(2, "Account name must be at least 2 characters").max(120).optional(),
  email: portalLoginIdSchema.optional(),
  phone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .or(z.literal(""))
});

export const departmentAccountPasswordSchema = z.object({
  password: portalPasswordSchema,
  mustChangePassword: z.boolean().optional().default(false)
});

export type DepartmentAccountInput = z.infer<typeof departmentAccountSchema>;
export type DepartmentAccountUpdateInput = z.infer<typeof departmentAccountUpdateSchema>;
export type DepartmentAccountPasswordInput = z.infer<typeof departmentAccountPasswordSchema>;

export interface DepartmentAccountRecord {
  _id: string;
  departmentType: DepartmentAccountType;
  departmentLabel: string;
  fullName: string;
  email: string;
  phone?: string;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt?: string;
  updatedAt?: string;
}
