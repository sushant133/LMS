import type { UserRole } from "@phit-erp/shared";
import type { Types } from "mongoose";

const DELETED_EMAIL_PATTERN = /^deleted\.[a-f\d]{24}\./i;

export const isSoftDeletedAdminEmail = (email: string): boolean => DELETED_EMAIL_PATTERN.test(email);

export const toDeletedAdminEmail = (userId: Types.ObjectId | string, email: string): string => {
  const id = userId.toString();
  if (isSoftDeletedAdminEmail(email)) {
    return email;
  }
  return `deleted.${id}.${email}`;
};

export const fromDeletedAdminEmail = (email: string): string => {
  const match = email.match(/^deleted\.[a-f\d]{24}\.(.+)$/i);
  return match?.[1] ?? email;
};

export const restoreDeletedAdminEmail = (email: string): string => fromDeletedAdminEmail(email);

export const buildAdminListFilter = (schoolId: Types.ObjectId, includeDeleted = false) => {
  const filter: Record<string, unknown> = {
    schoolId,
    role: "COLLEGE_ADMIN" as UserRole
  };

  if (!includeDeleted) {
    filter.email = { $not: DELETED_EMAIL_PATTERN };
  }

  return filter;
};