import type { UserRole } from "@nepal-school-erp/shared";

declare global {
  namespace Express {
    interface UserPayload {
      userId: string;
      role: UserRole;
      email: string;
      schoolId?: string | null;
    }

    interface Request {
      user?: UserPayload;
      tenantSchoolId?: string;
    }
  }
}

export {};
