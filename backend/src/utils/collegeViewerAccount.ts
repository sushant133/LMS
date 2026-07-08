import type { UserRole } from "@phit-erp/shared";
import type { Types } from "mongoose";
import {
  fromDeletedAdminEmail,
  isSoftDeletedAdminEmail,
  restoreDeletedAdminEmail,
  toDeletedAdminEmail
} from "./adminAccount.js";

export { fromDeletedAdminEmail, isSoftDeletedAdminEmail, restoreDeletedAdminEmail, toDeletedAdminEmail };

export const buildCollegeViewerListFilter = (schoolId: Types.ObjectId, includeDeleted = false) => {
  const filter: Record<string, unknown> = {
    schoolId,
    role: "COLLEGE_VIEWER" as UserRole
  };

  if (!includeDeleted) {
    filter.email = { $not: /^deleted\.[a-f\d]{24}\./i };
  }

  return filter;
};