/**
 * Parent portal module access — student-account-related sections only.
 * Configured by Admin / Super Admin under Parent Management.
 * Parents never get staff ERP modules; only visibility into linked children’s data.
 */

export const PARENT_PORTAL_MODULE_KEYS = [
  "overview",
  "attendance",
  "fees",
  "homework",
  "results",
  "timetable",
  "field-attendance",
  "library",
  "notices",
  "notifications"
] as const;

export type ParentPortalModuleKey = (typeof PARENT_PORTAL_MODULE_KEYS)[number];

export type ParentPortalAccessMap = Record<ParentPortalModuleKey, boolean>;

export const PARENT_PORTAL_MODULE_META: Array<{
  key: ParentPortalModuleKey;
  label: string;
  description: string;
  /** Frontend paths gated by this switch (prefix match). */
  routePrefixes: string[];
}> = [
  {
    key: "overview",
    label: "Student accounts overview",
    description:
      "Linked children’s student profiles and summary cards on the Parent Portal.",
    routePrefixes: ["/parent-portal"]
  },
  {
    key: "attendance",
    label: "Student attendance",
    description:
      "Daily attendance and subject-wise attendance for linked students (view + alerts).",
    routePrefixes: ["/attendance"]
  },
  {
    key: "fees",
    label: "Student fees & payments",
    description:
      "Fee dues, payments, scholarship, and security deposit for linked students.",
    routePrefixes: ["/my-fees"]
  },
  {
    key: "homework",
    label: "Student homework",
    description: "Assignments and homework for linked students.",
    routePrefixes: ["/homework-view", "/homework"]
  },
  {
    key: "results",
    label: "Student examination & results",
    description: "Exam schedules and published results for linked students.",
    routePrefixes: ["/exams"]
  },
  {
    key: "timetable",
    label: "Student timetable",
    description: "Class / batch weekly timetable for linked students.",
    routePrefixes: ["/timetable"]
  },
  {
    key: "field-attendance",
    label: "Student field attendance",
    description: "Field posting and field attendance for linked students.",
    routePrefixes: ["/field-management"]
  },
  {
    key: "library",
    label: "Student library",
    description: "Library borrowing for linked students (when available).",
    routePrefixes: ["/my-library"]
  },
  {
    key: "notices",
    label: "School notices",
    description: "College notices related to students and school activities.",
    routePrefixes: ["/notices"]
  },
  {
    key: "notifications",
    label: "Student alerts",
    description:
      "In-app alerts about linked students (fees, homework, attendance, etc.).",
    routePrefixes: ["/notifications"]
  }
];

/** All student-related modules enabled — backward-compatible default. */
export const defaultParentPortalAccess = (): ParentPortalAccessMap => {
  const map = {} as ParentPortalAccessMap;
  for (const key of PARENT_PORTAL_MODULE_KEYS) {
    map[key] = true;
  }
  return map;
};

export const normalizeParentPortalAccess = (
  input?: Partial<Record<string, boolean>> | null
): ParentPortalAccessMap => {
  const defaults = defaultParentPortalAccess();
  if (!input || typeof input !== "object") return defaults;
  for (const key of PARENT_PORTAL_MODULE_KEYS) {
    if (typeof input[key] === "boolean") {
      defaults[key] = input[key]!;
    }
  }
  return defaults;
};

export const isParentPortalModuleEnabled = (
  access: ParentPortalAccessMap | null | undefined,
  key: ParentPortalModuleKey
): boolean => {
  const map = normalizeParentPortalAccess(access);
  return map[key] !== false;
};

/** Resolve which parent portal module a path belongs to (if any). */
export const resolveParentPortalModuleFromPath = (
  pathname: string
): ParentPortalModuleKey | null => {
  const path = (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  // Prefer longest prefix match
  let best: { key: ParentPortalModuleKey; len: number } | null = null;
  for (const meta of PARENT_PORTAL_MODULE_META) {
    for (const prefix of meta.routePrefixes) {
      if (path === prefix || path.startsWith(`${prefix}/`)) {
        if (!best || prefix.length > best.len) {
          best = { key: meta.key, len: prefix.length };
        }
      }
    }
  }
  return best?.key ?? null;
};

export const canParentAccessPath = (
  access: ParentPortalAccessMap | null | undefined,
  pathname: string
): boolean => {
  const key = resolveParentPortalModuleFromPath(pathname);
  if (!key) return true;
  return isParentPortalModuleEnabled(access, key);
};

export interface ParentPortalAccessResponse {
  modules: ParentPortalAccessMap;
  meta: Array<{
    key: ParentPortalModuleKey;
    label: string;
    description: string;
    routePrefixes: string[];
    enabled: boolean;
  }>;
  /** Present when fetching/updating a specific parent */
  parentUserId?: string;
  parentName?: string;
  parentEmail?: string;
  /** true when parent has no personal override (uses school defaults) */
  useSchoolDefaults?: boolean;
  schoolDefaults?: ParentPortalAccessMap;
  customModules?: ParentPortalAccessMap | null;
}
