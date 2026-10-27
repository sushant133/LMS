/**
 * "Student Attendance" Module Access grant.
 *
 * Lets an Administrator hand a staff member or teacher the whole-college
 * student attendance desk that otherwise only the Administrator has: daily
 * attendance for any class (mark, edit, unlock), history, reports, the
 * dashboard, early leave, and the student tab of the attendance register.
 *
 * Only an explicitly saved grant counts. An unsaved Module Access matrix means
 * legacy "full access" for every module, so it must not unlock this desk.
 */
import {
  canAccessModule,
  canManageInstitution,
  canWriteModule,
  hasConfiguredModuleAccess,
  hasInstitutionAccess,
  isInstitutionAdmin,
  isPortalRole,
  normalizeUserRole,
  type ModuleAccessMap
} from "@phit-erp/shared";
import type { Request } from "express";
import { ApiError } from "./apiError.js";
import { getUserModuleAccessMap } from "./moduleAccessService.js";

export type StudentAttendanceGrant = { read: boolean; write: boolean };

const NO_GRANT: StudentAttendanceGrant = { read: false, write: false };

/** Student attendance APIs the grant covers (not the HR employee registers). */
export const isStudentAttendanceApiPath = (path: string): boolean => {
  const p = path.split("?")[0] ?? path;
  return (
    /\/api\/daily-attendance(\/|$)/.test(p) ||
    /\/api\/attendance(\/|$)/.test(p) ||
    /\/api\/student-early-leave(\/|$)/.test(p) ||
    /\/api\/attendance-register(\/|$)/.test(p)
  );
};

/** Grant from an already-loaded access map (explicitly saved grants only). */
export const studentAttendanceGrantFromMap = (
  map: ModuleAccessMap | null | undefined
): StudentAttendanceGrant => {
  if (!hasConfiguredModuleAccess(map)) return NO_GRANT;
  return {
    read: canAccessModule(map, "student-attendance"),
    write: canWriteModule(map, "student-attendance")
  };
};

/** The signed-in user's grant, loaded once per request. */
export const loadStudentAttendanceGrant = async (
  req: Request
): Promise<StudentAttendanceGrant> => {
  if (req.studentAttendanceGrant) return req.studentAttendanceGrant;
  const user = req.user;
  if (!user || isPortalRole(normalizeUserRole(user.role))) {
    req.studentAttendanceGrant = NO_GRANT;
    return NO_GRANT;
  }
  const map = await getUserModuleAccessMap(user.userId);
  req.studentAttendanceGrant = studentAttendanceGrantFromMap(map);
  return req.studentAttendanceGrant;
};

/** Express middleware: load the grant before student attendance controllers run. */
export const attachStudentAttendanceGrant = (
  req: Request,
  _res: unknown,
  next: (error?: unknown) => void
): void => {
  loadStudentAttendanceGrant(req).then(() => next(), next);
};

const roleOf = (req: Request): string => req.user?.role ?? "";

/*
 * Synchronous checks for controllers. They read the grant loaded by
 * `attachStudentAttendanceGrant`; without it they behave exactly as the plain
 * role checks they replace.
 */

/** College-wide read: Administrator / College Viewer, or the grant. */
export const canReadAllStudentAttendance = (req: Request): boolean =>
  hasInstitutionAccess(roleOf(req)) || Boolean(req.studentAttendanceGrant?.read);

/** College-wide write (any class, without a timetable slot): Administrator, or a WRITE grant. */
export const canWriteAllStudentAttendance = (req: Request): boolean =>
  canManageInstitution(roleOf(req)) || Boolean(req.studentAttendanceGrant?.write);

/** Administrator-level actions (edit / unlock a submitted sheet). */
export const isStudentAttendanceAdmin = (req: Request): boolean =>
  isInstitutionAdmin(roleOf(req)) || Boolean(req.studentAttendanceGrant?.write);

/**
 * A teacher limited to their own classes. A teacher who also holds the grant
 * works college-wide instead.
 */
export const actsAsClassTeacher = (req: Request): boolean =>
  roleOf(req) === "TEACHER" && !req.studentAttendanceGrant?.read;

export const assertCanReadAllStudentAttendance = (
  req: Request,
  message = "You do not have permission to view this data"
): void => {
  if (!canReadAllStudentAttendance(req)) throw new ApiError(403, message);
};
