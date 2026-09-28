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
 * does for the Administrator — only inside that department.
 */
export const DEPARTMENT_ACCOUNT_TYPES = ["ACCOUNTING", "EXAMINATION", "ACADEMICS"] as const;

export type DepartmentAccountType = (typeof DEPARTMENT_ACCOUNT_TYPES)[number];

export const DEPARTMENT_ACCOUNT_LABELS: Record<DepartmentAccountType, string> = {
  ACCOUNTING: "Accounting",
  EXAMINATION: "Examination Management",
  ACADEMICS: "Academics"
};

export const DEPARTMENT_ACCOUNT_DESCRIPTIONS: Record<DepartmentAccountType, string> = {
  ACCOUNTING: "Accounting, fee management, finance archive, HR payroll, and the academic calendar.",
  EXAMINATION: "College exams, routines, marks, results, marksheets, CTEVT exam fees, and the academic calendar.",
  ACADEMICS:
    "Everything academic — students, staff, attendance, academic structure, plans, timetable, library, lab, notices — except Accounting and Examination."
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
    // No notices: the notice board is for college staff
    "academic-calendar": R,
    students: R,
    academics: R
  },
  ACADEMICS: {
    dashboard: W,
    profile: W,
    students: W,
    teachers: W,
    staff: W,
    parents: W,
    attendance: W,
    "daily-attendance": W,
    "teacher-attendance": W,
    "staff-attendance": W,
    "field-duty": W,
    "academic-structure": W,
    academics: W,
    "subject-assignment": W,
    "academic-management": W,
    "academic-calendar": W,
    timetable: W,
    homework: W,
    notices: W,
    banners: W,
    library: W,
    laboratory: W,
    inventory: W,
    transport: W,
    hostel: W,
    reports: W,
    complaints: W
  }
};

/**
 * Read-only modules every department still sees in its menu. Everything else
 * READ_ONLY is reference data for pickers and stays out of the sidebar.
 */
const DEPARTMENT_NAV_READ_MODULES: readonly ErpModuleKey[] = ["academic-calendar"];

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
  if (DEPARTMENT_ALWAYS_ROUTE_PREFIXES.some((prefix) => matchesPrefix(path, prefix))) return true;

  const keys = routeModuleKeys(path);
  if (!keys) return false;
  const modules = DEPARTMENT_ACCOUNT_MODULES[type];
  return keys.some((key) => {
    const mode = modules[key];
    if (mode === "WRITE") return true;
    if (mode !== "READ_ONLY") return false;
    return purpose === "route" || DEPARTMENT_NAV_READ_MODULES.includes(key);
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
