import type { NextFunction, Request, Response } from "express";
import {
  APPROVE_ADMIN_ONLY_MESSAGE,
  canAccessExaminationCollege,
  canAccessExaminationCtevt,
  canAccessModule,
  canApproveRecords,
  canEditOrDeleteRecords,
  canWriteExaminationCollege,
  canWriteExaminationCtevt,
  canWriteModule,
  EDIT_DELETE_ADMIN_ONLY_MESSAGE,
  hasModuleAction,
  inferActionFromApiPath,
  isInstitutionAdmin,
  isSystemAdministrator,
  MODULE_ACCESS_DENIED_MESSAGE,
  MODULE_ACCESS_DISABLED_MESSAGE,
  normalizeModuleAccessMode,
  normalizeUserRole,
  type ModuleAccessMode
} from "@phit-erp/shared";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import { isAssignedFieldCoordinator } from "../utils/fieldDutyService.js";
import { wantsAdminWorkspaceScope } from "../utils/workspaceScope.js";
import {
  getUserModuleAccessMap,
  getUserModuleActionsMap,
  getUserSecondaryRoles,
  isModuleAccessBypassPath,
  isSharedAcademicsReadPath,
  resolveModuleForRequest,
  resolveRequestPath
} from "../utils/moduleAccessService.js";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const RECORD_EDIT_DELETE_METHODS = new Set(["PUT", "DELETE"]);

const isOperationalStatusPath = (path: string): boolean =>
  /\/login-access(\/|$)/i.test(path) ||
  /\/status(\/|$)/i.test(path) ||
  /\/inventory-access(\/|$)/i.test(path);

const operationalDepartmentEditRole = (
  role: string,
  moduleKey: string | null
): boolean => {
  if (role === "LIBRARY_STAFF" && moduleKey === "library") return true;
  if (role === "LABORATORY_STAFF" && moduleKey === "laboratory") return true;
  if (
    (role === "ACCOUNTANT" || role === "CASHIER") &&
    (moduleKey === "accounts" || moduleKey === "fees")
  ) {
    return true;
  }
  return false;
};

/**
 * Approve / publish / unlock-as-approver paths. Staff with Module Access WRITE
 * may still see the buttons; only Administrator may complete these actions.
 */
const isRecordApprovalRequest = (method: string, path: string): boolean => {
  if (READ_METHODS.has(method.toUpperCase())) return false;
  const p = (path.split("?")[0] ?? path).toLowerCase();
  return (
    /\/(?:approve|unapprove|reject|unlock|lock|review|publish|unpublish)(?:\/|$)/.test(p) ||
    /\/leaves\/[^/]+\/status(?:\/|$)/.test(p) ||
    /\/stock-requests\/[^/]+\/status(?:\/|$)/.test(p) ||
    /\/edit-review(?:\/|$)/.test(p)
  );
};

const actorCanApproveRecords = (role: string, secondary: readonly string[]): boolean =>
  [role, ...secondary].some((entry) => canApproveRecords(entry));

const denyGrantedApproval = async (
  req: Request,
  role: string,
  path: string,
  secondary?: readonly string[]
): Promise<ApiError | null> => {
  if (!isRecordApprovalRequest(req.method, path)) return null;
  if (canApproveRecords(role)) return null;
  const extra = secondary ?? (await getUserSecondaryRoles(req.user!.userId));
  if (actorCanApproveRecords(role, extra)) return null;
  return new ApiError(403, APPROVE_ADMIN_ONLY_MESSAGE);
};

/** Granted VP / Principal / staff may create and operate, not edit or delete. */
const shouldBlockGrantedEditDelete = (
  req: Request,
  role: string,
  isTeacherRole: boolean,
  moduleKey: string | null
): boolean => {
  if (!RECORD_EDIT_DELETE_METHODS.has(req.method)) return false;
  if (canEditOrDeleteRecords(role)) return false;
  if (isOperationalStatusPath(req.originalUrl || req.path || "")) return false;
  if (operationalDepartmentEditRole(role, moduleKey)) return false;
  if (
    isTeacherRole &&
    !wantsAdminWorkspaceScope(req) &&
    moduleKey &&
    TEACHER_MY_WORK_MODULE_KEYS.has(moduleKey)
  ) {
    return false;
  }
  return true;
};

/**
 * Enforces per-user Module Access Control on all requests.
 * - NONE: block read and write
 * - READ_ONLY: allow GET; block mutating methods
 * - WRITE: allow, subject to granular actions when configured
 * Login and self-service profile/password remain available.
 * Must run after `protect` so `req.user` is set.
 */
/** Teaching modules that TEACHER role may always use (My Work), subject to teacher scope in controllers. */
const TEACHER_MY_WORK_MODULE_KEYS = new Set([
  "students",
  "academics",
  "subject-assignment",
  "attendance",
  "daily-attendance",
  "academic-management",
  "academic-calendar",
  "timetable",
  "examinations",
  "results",
  "homework",
  "notices",
  "complaints",
  "library",
  "laboratory",
  "dashboard",
  "profile"
]);

export const enforceModuleAccess = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) return next();
    // Super Admin + College Admin: unrestricted within their auth/tenant scope
    const role = normalizeUserRole(req.user.role);
    if (isSystemAdministrator(role) || isInstitutionAdmin(role)) return next();

    const originalPath = resolveRequestPath(
      req.method,
      req.originalUrl,
      req.baseUrl,
      req.url,
      req.path
    );

    // Shared academics lists + teacher self APIs — never blocked by module matrix
    if (isModuleAccessBypassPath(req.method, originalPath)) return next();
    if (READ_METHODS.has(req.method) && isSharedAcademicsReadPath(originalPath)) {
      return next();
    }

    /**
     * Teachers (primary role): always keep My Work APIs even if admin matrix was
     * saved incomplete. Controllers still enforce subject/batch assignment scope.
     */
    if (role === "TEACHER") {
      const teacherApiOk =
        /(?:^|\/)api\/(teacher|exams|academic-management|homework|timetable|attendance|daily-attendance|notices|results)(\/|$)/i.test(
          originalPath
        ) ||
        /(?:^|\/)(teacher|exams|academic-management|homework|timetable)(\/|$)/i.test(originalPath);
      if (teacherApiOk) {
        if (READ_METHODS.has(req.method)) return next();
        // Writes on teaching tools (marks, plans, log book, homework)
        if (
          /(?:^|\/)api\/(exams|academic-management|homework|attendance|daily-attendance)(\/|$)/i.test(
            originalPath
          )
        ) {
          const moduleKey = resolveModuleForRequest(req);
          const approvalDenied = await denyGrantedApproval(req, role, originalPath);
          if (approvalDenied) return next(approvalDenied);
          if (shouldBlockGrantedEditDelete(req, role, true, moduleKey)) {
            return next(new ApiError(403, EDIT_DELETE_ADMIN_ONLY_MESSAGE));
          }
          return next();
        }
      }
    }

    // Self-service: any linked teacher/staff may read own attendance + permission flags
    if (
      READ_METHODS.has(req.method) &&
      (/(?:^|\/)(?:api\/)?employee-attendance\/me$/i.test(originalPath) ||
        /(?:^|\/)(?:api\/)?employee-attendance\/permissions$/i.test(originalPath))
    ) {
      return next();
    }
    // Traditional Attendance Register (read-only) — allow if any attendance module granted.
    // Tab-level access is enforced inside attendanceRegisterController.
    if (
      READ_METHODS.has(req.method) &&
      /\/api\/attendance-register(\/|$)/.test(originalPath)
    ) {
      const accessMap = await getUserModuleAccessMap(req.user.userId);
      const allowed =
        canAccessModule(accessMap, "daily-attendance") ||
        canAccessModule(accessMap, "attendance") ||
        canAccessModule(accessMap, "teacher-attendance") ||
        canAccessModule(accessMap, "staff-attendance");
      if (allowed) return next();
      // Teachers / staff still reach controller for self-scoped registers
      const role = req.user.role;
      if (
        role === "TEACHER" ||
        role === "COLLEGE_STAFF" ||
        role === "STUDENT" ||
        role === "SUPER_ADMIN" ||
        role === "COLLEGE_ADMIN" ||
        role === "COLLEGE_VIEWER" ||
        role === "PRINCIPAL"
      ) {
        return next();
      }
      return next(new ApiError(403, MODULE_ACCESS_DENIED_MESSAGE));
    }

    // Teacher + Staff attendance share /api/employee-attendance — allow if either
    // category module (or legacy "attendance") is granted. Category-level checks
    // run inside the employee attendance controller.
    if (/\/api\/employee-attendance(\/|$)/.test(originalPath)) {
      const [accessMap] = await Promise.all([getUserModuleAccessMap(req.user.userId)]);
      const canTeacher =
        canAccessModule(accessMap, "teacher-attendance") ||
        canAccessModule(accessMap, "attendance");
      const canStaff =
        canAccessModule(accessMap, "staff-attendance") ||
        canAccessModule(accessMap, "attendance");
      // TEACHER / COLLEGE_STAFF roles may always open read-only self endpoints (handled above);
      // for admin sheets they need explicit module grants (or legacy empty matrix → WRITE).
      if (!canTeacher && !canStaff) {
        return next(new ApiError(403, MODULE_ACCESS_DENIED_MESSAGE));
      }
      if (!READ_METHODS.has(req.method)) {
        const canWrite =
          canWriteModule(accessMap, "teacher-attendance") ||
          canWriteModule(accessMap, "staff-attendance") ||
          canWriteModule(accessMap, "attendance");
        if (!canWrite) {
          return next(new ApiError(403, MODULE_ACCESS_DISABLED_MESSAGE));
        }
      }
      if (
        shouldBlockGrantedEditDelete(
          req,
          role,
          req.user.role === "TEACHER",
          canTeacher ? "teacher-attendance" : "staff-attendance"
        )
      ) {
        return next(new ApiError(403, EDIT_DELETE_ADMIN_ONLY_MESSAGE));
      }
      const approvalDenied = await denyGrantedApproval(req, role, originalPath);
      if (approvalDenied) return next(approvalDenied);
      return next();
    }

    /**
     * CTEVT fee endpoints (Examination Management → CTEVT).
     * Require examinations-ctevt; not covered by the generic students module alone.
     */
    if (
      /\/api\/students\/ctevt-(registration|exam)-fee(\/|$)/.test(originalPath)
    ) {
      const accessMap = await getUserModuleAccessMap(req.user.userId);
      if (!canAccessExaminationCtevt(accessMap)) {
        return next(new ApiError(403, MODULE_ACCESS_DENIED_MESSAGE));
      }
      if (!READ_METHODS.has(req.method) && !canWriteExaminationCtevt(accessMap)) {
        return next(new ApiError(403, MODULE_ACCESS_DISABLED_MESSAGE));
      }
      return next();
    }

    /**
     * Exam APIs: teaching "examinations", admin "examinations-college", or "results".
     * (Multiple modules share /exams prefixes.)
     */
    if (/\/api\/exams(\/|$)/.test(originalPath)) {
      const [accessMap, secondaryRoles] = await Promise.all([
        getUserModuleAccessMap(req.user.userId),
        (async () => {
          const { getUserSecondaryRoles } = await import("../utils/moduleAccessService.js");
          return getUserSecondaryRoles(req.user!.userId);
        })()
      ]);
      const isTeacherRole =
        req.user.role === "TEACHER" || secondaryRoles.includes("TEACHER");
      const canCollege = canAccessExaminationCollege(accessMap);
      const canTeaching =
        canAccessModule(accessMap, "examinations") ||
        (isTeacherRole && TEACHER_MY_WORK_MODULE_KEYS.has("examinations"));
      const canResults = canAccessModule(accessMap, "results");
      if (!canCollege && !canTeaching && !canResults) {
        return next(new ApiError(403, MODULE_ACCESS_DENIED_MESSAGE));
      }
      if (!READ_METHODS.has(req.method)) {
        const canWrite =
          canWriteExaminationCollege(accessMap) ||
          canWriteModule(accessMap, "examinations") ||
          (isTeacherRole && TEACHER_MY_WORK_MODULE_KEYS.has("examinations")) ||
          canWriteModule(accessMap, "results");
        if (!canWrite) {
          return next(new ApiError(403, MODULE_ACCESS_DISABLED_MESSAGE));
        }
      }
      if (
        shouldBlockGrantedEditDelete(
          req,
          req.user.role,
          isTeacherRole,
          canCollege ? "examinations-college" : "examinations"
        )
      ) {
        return next(new ApiError(403, EDIT_DELETE_ADMIN_ONLY_MESSAGE));
      }
      const approvalDenied = await denyGrantedApproval(
        req,
        req.user.role,
        originalPath,
        secondaryRoles
      );
      if (approvalDenied) return next(approvalDenied);
      return next();
    }

    /**
     * Field Management (/api/field-duty):
     * - Student/parent portals: allow (route authorize enforces role)
     * - Module "field-duty" grant: allow
     * - Assigned primary/assistant field coordinators: allow even without module matrix
     *   (schedule-level checks still apply in controllers)
     */
    if (/\/api\/field-duty(\/|$)/.test(originalPath)) {
      const role = req.user.role;
      if (role === "STUDENT" || role === "PARENT") {
        return next();
      }
      // Access probe must work so the client can show/hide nav before module grants exist
      if (READ_METHODS.has(req.method) && /\/api\/field-duty\/me\/access$/.test(originalPath)) {
        return next();
      }
      const accessMap = await getUserModuleAccessMap(req.user.userId);
      if (canAccessModule(accessMap, "field-duty")) {
        if (!READ_METHODS.has(req.method) && !canWriteModule(accessMap, "field-duty")) {
          // Coordinators still need to submit attendance when module is READ_ONLY
          const isCoord = await isAssignedFieldCoordinator(req);
          if (!isCoord) {
            return next(new ApiError(403, MODULE_ACCESS_DISABLED_MESSAGE));
          }
        }
        if (shouldBlockGrantedEditDelete(req, role, role === "TEACHER", "field-duty")) {
          return next(new ApiError(403, EDIT_DELETE_ADMIN_ONLY_MESSAGE));
        }
        const approvalDenied = await denyGrantedApproval(req, role, originalPath);
        if (approvalDenied) return next(approvalDenied);
        return next();
      }
      const isCoord = await isAssignedFieldCoordinator(req);
      if (isCoord) {
        if (shouldBlockGrantedEditDelete(req, role, role === "TEACHER", "field-duty")) {
          return next(new ApiError(403, EDIT_DELETE_ADMIN_ONLY_MESSAGE));
        }
        const approvalDenied = await denyGrantedApproval(req, role, originalPath);
        if (approvalDenied) return next(approvalDenied);
        return next();
      }
      return next(new ApiError(403, MODULE_ACCESS_DENIED_MESSAGE));
    }

    const moduleKey = resolveModuleForRequest(req);
    if (!moduleKey) return next();

    /**
     * Academic structure (batches, years, classes, sections, subjects) is shared
     * reference data used by Accounting, Exams, Field, Students, Attendance, etc.
     * Always allow GET for any authenticated user past protect().
     */
    if (READ_METHODS.has(req.method) && moduleKey === "academics") {
      return next();
    }

    const [accessMap, actionsMap, secondaryRoles] = await Promise.all([
      getUserModuleAccessMap(req.user.userId),
      getUserModuleActionsMap(req.user.userId),
      (async () => {
        const { getUserSecondaryRoles } = await import("../utils/moduleAccessService.js");
        return getUserSecondaryRoles(req.user!.userId);
      })()
    ]);

    const isTeacherRole =
      req.user.role === "TEACHER" || secondaryRoles.includes("TEACHER");
    const isLibraryStaffRole =
      req.user.role === "LIBRARY_STAFF" || secondaryRoles.includes("LIBRARY_STAFF");
    const isLabStaffRole =
      req.user.role === "LABORATORY_STAFF" ||
      secondaryRoles.includes("LABORATORY_STAFF");

    /**
     * Library staff need limited student/teacher rosters for Issue Book filters
     * (batch/year/class/section). Controllers already return a sanitized list.
     * Allow GET when they still have library module access.
     */
    if (
      isLibraryStaffRole &&
      READ_METHODS.has(req.method) &&
      (moduleKey === "students" || moduleKey === "teachers") &&
      canAccessModule(accessMap, "library")
    ) {
      return next();
    }

    /** Lab staff need teacher roster for equipment issue workflows. */
    if (
      isLabStaffRole &&
      READ_METHODS.has(req.method) &&
      moduleKey === "teachers" &&
      canAccessModule(accessMap, "laboratory")
    ) {
      return next();
    }

    /**
     * Accounting staff need student roster + academic batch/year (and class/section)
     * lists for Student Fee Records, Refund Records, pickers, and filters — even when
     * only the Accounting module is granted in the matrix. Controllers already scope
     * by tenant; this is read-only dependency access.
     */
    if (
      READ_METHODS.has(req.method) &&
      (moduleKey === "students" || moduleKey === "academics") &&
      canAccessModule(accessMap, "accounts")
    ) {
      return next();
    }

    /**
     * CTEVT fee desk needs student roster + batch/year lists (read-only)
     * even when only Examination — CTEVT is granted.
     */
    if (
      READ_METHODS.has(req.method) &&
      (moduleKey === "students" || moduleKey === "academics") &&
      canAccessExaminationCtevt(accessMap)
    ) {
      return next();
    }

    // Teachers always keep My Work APIs (students, attendance, exams, homework, …)
    // even if module-access matrix was saved with Hidden for admin departments.
    let mode: ModuleAccessMode = normalizeModuleAccessMode(accessMap[moduleKey]);
    if (
      isTeacherRole &&
      TEACHER_MY_WORK_MODULE_KEYS.has(moduleKey) &&
      (mode === "NONE" || accessMap[moduleKey] === undefined)
    ) {
      mode = "WRITE";
    }
    // Institution settings GET (academic year, name, holidays) is shared reference data.
    // Settings module is often Hidden for staff — PUT remains admin-only on the route.
    if (moduleKey === "settings" && READ_METHODS.has(req.method)) {
      return next();
    }

    if (mode === "NONE") {
      void recordAudit(req, {
        action: "module_access.blocked",
        entity: "MODULE_ACCESS",
        entityId: moduleKey,
        after: {
          method: req.method,
          path: req.originalUrl,
          moduleKey,
          mode: "NONE"
        }
      });
      return next(new ApiError(403, MODULE_ACCESS_DENIED_MESSAGE));
    }

    if (READ_METHODS.has(req.method)) {
      // Teacher My Work elevated to WRITE — always allow read
      if (isTeacherRole && TEACHER_MY_WORK_MODULE_KEYS.has(moduleKey) && mode === "WRITE") {
        return next();
      }
      // View allowed for READ_ONLY and WRITE
      if (!hasModuleAction(accessMap, actionsMap, moduleKey, "view")) {
        return next(new ApiError(403, MODULE_ACCESS_DENIED_MESSAGE));
      }
      return next();
    }

    // Mutating request
    if (mode === "READ_ONLY") {
      void recordAudit(req, {
        action: "module_access.blocked_write",
        entity: "MODULE_ACCESS",
        entityId: moduleKey,
        after: {
          method: req.method,
          path: req.originalUrl,
          moduleKey,
          mode: "READ_ONLY"
        }
      });
      return next(new ApiError(403, MODULE_ACCESS_DISABLED_MESSAGE));
    }

    // Teacher My Work WRITE — allow create (and own-record edit when not Administration)
    if (isTeacherRole && TEACHER_MY_WORK_MODULE_KEYS.has(moduleKey) && mode === "WRITE") {
      const approvalDenied = await denyGrantedApproval(
        req,
        role,
        originalPath,
        secondaryRoles
      );
      if (approvalDenied) return next(approvalDenied);
      if (shouldBlockGrantedEditDelete(req, role, true, moduleKey)) {
        return next(new ApiError(403, EDIT_DELETE_ADMIN_ONLY_MESSAGE));
      }
      return next();
    }

    const requiredAction = inferActionFromApiPath(req.method, req.originalUrl || req.path || "");
    if (!hasModuleAction(accessMap, actionsMap, moduleKey, requiredAction)) {
      // Fall back: WRITE mode without granular deny still allows create/edit/delete
      const hasAnyGranular = Boolean(actionsMap[moduleKey]?.length);
      if (hasAnyGranular) {
        void recordAudit(req, {
          action: "module_access.blocked_action",
          entity: "MODULE_ACCESS",
          entityId: moduleKey,
          after: {
            method: req.method,
            path: req.originalUrl,
            moduleKey,
            requiredAction
          }
        });
        return next(
          new ApiError(
            403,
            `You do not have "${requiredAction}" permission for this department. Contact the Administrator.`
          )
        );
      }
    }

    if (shouldBlockGrantedEditDelete(req, role, isTeacherRole, moduleKey)) {
      return next(new ApiError(403, EDIT_DELETE_ADMIN_ONLY_MESSAGE));
    }

    const approvalDenied = await denyGrantedApproval(
      req,
      role,
      originalPath,
      secondaryRoles
    );
    if (approvalDenied) return next(approvalDenied);

    return next();
  } catch (error) {
    return next(error);
  }
};
