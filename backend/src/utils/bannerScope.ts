import {
  BANNER_TARGET_ROLES,
  type BannerTargetRole,
  type UserRole
} from "@phit-erp/shared";

const BANNER_TARGET_USER_ROLES: Record<BannerTargetRole, UserRole[]> = {
  STUDENT: ["STUDENT"],
  TEACHER: ["TEACHER"],
  PARENT: ["PARENT"],
  ACCOUNTANT: ["ACCOUNTANT", "CASHIER", "AUDITOR"],
  LIBRARY_STAFF: ["LIBRARY_STAFF"],
  LABORATORY_STAFF: ["LABORATORY_STAFF"],
  TRANSPORT_STAFF: ["COLLEGE_STAFF"],
  HR_PAYROLL: ["COLLEGE_STAFF", "PRINCIPAL"],
  COLLEGE_ADMIN: ["COLLEGE_ADMIN", "SUPER_ADMIN", "COLLEGE_VIEWER", "PRINCIPAL"]
};

/** Legacy banners without visibleTo are treated as visible to everyone. */
export const normalizeBannerVisibleTo = (
  visibleTo: BannerTargetRole[] | string[] | null | undefined
): BannerTargetRole[] => {
  const allTargets: BannerTargetRole[] = BANNER_TARGET_ROLES.slice();
  if (!Array.isArray(visibleTo) || visibleTo.length === 0) {
    return allTargets;
  }
  const allowed = new Set<string>(BANNER_TARGET_ROLES as readonly string[]);
  const filtered: BannerTargetRole[] = [];
  for (const role of visibleTo) {
    if (allowed.has(role)) {
      filtered.push(role as BannerTargetRole);
    }
  }
  return filtered.length > 0 ? filtered : allTargets;
};

export const userMatchesBannerTarget = (
  userRole: UserRole | undefined,
  targetRoles: BannerTargetRole[] | string[] | null | undefined
): boolean => {
  if (!userRole) {
    return false;
  }

  // Super admin always sees institution banners when active.
  if (userRole === "SUPER_ADMIN") {
    return true;
  }

  const normalized = normalizeBannerVisibleTo(targetRoles);
  return normalized.some((target) => BANNER_TARGET_USER_ROLES[target]?.includes(userRole));
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