import type { UserRole } from "@phit-erp/shared";

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
