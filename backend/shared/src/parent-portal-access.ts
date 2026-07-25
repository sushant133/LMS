/**
 * School-level switches for what parents can see in portal / My Work.
 * Configured by Admin under Parent Management — independent of staff Module Access.
 */

export const PARENT_PORTAL_MODULE_KEYS = [
  "overview",
  "attendance",
  "fees",
  "homework",
  "results",
  "timetable",
  "field-attendance",
  "notices",
  "notifications",
  "complaints",
  "library"
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
    label: "Parent portal overview",
    description: "Linked children summary cards on the Parent Portal home.",
    routePrefixes: ["/parent-portal"]
  },
  {
    key: "attendance",
    label: "Attendance",
    description: "Classroom / subject attendance summary for linked children.",
    routePrefixes: ["/attendance"]
  },
  {
    key: "fees",
    label: "Fees & payments",
    description: "Fee dues, payments, scholarship, and security deposit info.",
    routePrefixes: ["/my-fees"]
  },
  {
    key: "homework",
    label: "Homework / assignments",
    description: "Upcoming and pending assignments visible to parents.",
    routePrefixes: ["/homework-view", "/homework"]
  },
  {
    key: "results",
    label: "Exams & results",
    description: "Exam schedules and published results for linked children.",
    routePrefixes: ["/exams"]
  },
  {
    key: "timetable",
    label: "Timetable",
    description: "Class / batch weekly timetable.",
    routePrefixes: ["/timetable"]
  },
  {
    key: "field-attendance",
    label: "Field attendance",
    description: "Field posting and field attendance for linked students.",
    routePrefixes: ["/field-management"]
  },
  {
    key: "notices",
    label: "Notices",
    description: "College notice board visible to parents.",
    routePrefixes: ["/notices"]
  },
  {
    key: "notifications",
    label: "Notifications",
    description: "In-app notification center alerts for the parent account.",
    routePrefixes: ["/notifications"]
  },
  {
    key: "complaints",
    label: "Complaints",
    description: "Allow parents to view/submit complaints.",
    routePrefixes: ["/complains", "/complaints"]
  },
  {
    key: "library",
    label: "Library",
    description: "Library borrowing information for linked children (when available).",
    routePrefixes: ["/my-library"]
  }
];

/** All modules enabled — backward-compatible default. */
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
