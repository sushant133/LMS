import type { BannerTargetRole, UserRole } from "@phit-erp/shared";

const BANNER_TARGET_USER_ROLES: Record<BannerTargetRole, UserRole[]> = {
  STUDENT: ["STUDENT"],
  TEACHER: ["TEACHER"],
  PARENT: ["PARENT"],
  ACCOUNTANT: ["ACCOUNTANT"],
  LIBRARY_STAFF: ["LIBRARY_STAFF"],
  LABORATORY_STAFF: ["LABORATORY_STAFF"],
  TRANSPORT_STAFF: ["COLLEGE_ADMIN", "SUPER_ADMIN"],
  HR_PAYROLL: ["COLLEGE_ADMIN", "SUPER_ADMIN"],
  COLLEGE_ADMIN: ["COLLEGE_ADMIN", "SUPER_ADMIN"]
};

export const userMatchesBannerTarget = (userRole: UserRole | undefined, targetRoles: BannerTargetRole[]): boolean => {
  if (!userRole) {
    return false;
  }

  return targetRoles.some((target) => BANNER_TARGET_USER_ROLES[target]?.includes(userRole));
};

export const getBannerDisplayStatus = (
  isActive: boolean,
  startAt: Date,
  endAt: Date,
  now = new Date()
): "ACTIVE" | "SCHEDULED" | "EXPIRED" | "INACTIVE" => {
  if (!isActive) {
    return "INACTIVE";
  }
  if (now < startAt) {
    return "SCHEDULED";
  }
  if (now > endAt) {
    return "EXPIRED";
  }
  return "ACTIVE";
};

export const isBannerCurrentlyDisplayable = (isActive: boolean, startAt: Date, endAt: Date, now = new Date()): boolean =>
  isActive && now >= startAt && now <= endAt;