import type { DepartmentAccountType, UserRole } from "@phit-erp/shared";

declare global {
  namespace Express {
    interface UserPayload {
      userId: string;
      role: UserRole;
      email: string;
      schoolId?: string | null;
      /** Set only for Department Accounts (Settings → Department Accounts). */
      departmentAccount?: DepartmentAccountType | null;
    }

    interface Request {
      user?: UserPayload;
      tenantSchoolId?: string;
      /** "Student Attendance" Module Access grant, loaded once per request. */
      studentAttendanceGrant?: { read: boolean; write: boolean };
    }
  }
}

export {};
