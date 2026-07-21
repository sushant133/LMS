import { z } from "zod";

/**
 * Canonical ERP modules (departments) for Module Access Control.
 * Add new modules here — they appear automatically in the admin permission matrix.
 */
export const ERP_MODULE_KEYS = [
  "dashboard",
  "profile",
  "students",
  "teachers",
  "staff",
  "parents",
  "attendance",
  "daily-attendance",
  "teacher-attendance",
  "staff-attendance",
  "field-duty",
  "academics",
  "subject-assignment",
  "academic-management",
  "academic-calendar",
  "timetable",
  "examinations",
  "results",
  "homework",
  "notices",
  "banners",
  "library",
  "laboratory",
  "inventory",
  "accounts",
  "fees",
  "transport",
  "hr",
  "hostel",
  "reports",
  "settings",
  "user-management",
  "complaints"
] as const;

export type ErpModuleKey = (typeof ERP_MODULE_KEYS)[number];

/**
 * Access mode per department:
 * - NONE: no access (module hidden; API denied)
 * - READ_ONLY: view only
 * - WRITE: full module actions (subject to granular actions when set)
 */
export type ModuleAccessMode = "NONE" | "READ_ONLY" | "WRITE";

/** Granular actions assignable within a department. */
export const MODULE_PERMISSION_ACTIONS = [
  "view",
  "create",
  "edit",
  "delete",
  "approve",
  "verify",
  "publish",
  "print",
  "export",
  "manage",
  "configure"
] as const;

export type ModulePermissionAction = (typeof MODULE_PERMISSION_ACTIONS)[number];

export const MODULE_PERMISSION_ACTION_LABELS: Record<ModulePermissionAction, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  approve: "Approve",
  verify: "Verify",
  publish: "Publish",
  print: "Print",
  export: "Export",
  manage: "Manage",
  configure: "Configure"
};

/** Default actions implied by access mode when no granular list is stored. */
export const ACTIONS_FOR_MODE: Record<ModuleAccessMode, ModulePermissionAction[]> = {
  NONE: [],
  READ_ONLY: ["view", "print", "export"],
  WRITE: [...MODULE_PERMISSION_ACTIONS]
};

export interface ErpModuleDefinition {
  key: ErpModuleKey;
  label: string;
  description: string;
  /** API path prefixes under /api that belong to this module. */
  apiPrefixes: string[];
  /** Frontend route prefixes (for UI guards). */
  routePrefixes: string[];
  /** Suggested granular actions for this department (admin UI). */
  availableActions?: ModulePermissionAction[];
}

export const ERP_MODULES: ErpModuleDefinition[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    description: "Home dashboards and overview widgets",
    apiPrefixes: ["/dashboard"],
    routePrefixes: ["/dashboard"],
    availableActions: ["view"]
  },
  {
    key: "profile",
    label: "Profile",
    description: "Own profile and password (self-service)",
    apiPrefixes: [],
    routePrefixes: ["/profile", "/my-profile"],
    availableActions: ["view", "edit"]
  },
  {
    key: "students",
    label: "Student Management",
    description: "Student records, admission, documents",
    apiPrefixes: ["/students"],
    routePrefixes: ["/students"],
    availableActions: ["view", "create", "edit", "delete", "export", "print", "manage"]
  },
  {
    key: "teachers",
    label: "Teacher Management",
    description: "Teacher profiles and teaching staff",
    apiPrefixes: ["/teachers"],
    routePrefixes: ["/teachers", "/college-staff"],
    availableActions: ["view", "create", "edit", "delete", "export", "manage"]
  },
  {
    key: "staff",
    label: "Staff Management",
    description: "Non-teaching college staff directory",
    apiPrefixes: ["/college-staff"],
    routePrefixes: ["/college-staff"],
    availableActions: ["view", "create", "edit", "delete", "export", "manage"]
  },
  {
    key: "parents",
    label: "Parent Management",
    description: "Parent accounts and student links",
    apiPrefixes: ["/parents"],
    routePrefixes: ["/parent-links"],
    availableActions: ["view", "create", "edit", "delete", "manage"]
  },
  {
    key: "attendance",
    label: "Attendance",
    description: "Period / subject attendance marking",
    apiPrefixes: ["/attendance"],
    routePrefixes: ["/attendance", "/attendance-view"],
    availableActions: ["view", "create", "edit", "approve", "export"]
  },
  {
    key: "daily-attendance",
    label: "Daily Attendance",
    description: "Daily class attendance",
    apiPrefixes: ["/daily-attendance"],
    routePrefixes: ["/daily-attendance", "/attendance"],
    availableActions: ["view", "create", "edit", "approve", "export"]
  },
  {
    key: "teacher-attendance",
    label: "Teacher Attendance",
    description:
      "Daily attendance for teaching staff (teachers and dual-role leaders with teaching duties)",
    apiPrefixes: ["/employee-attendance"],
    routePrefixes: ["/attendance"],
    availableActions: ["view", "create", "edit", "delete", "approve", "export", "print"]
  },
  {
    key: "staff-attendance",
    label: "Staff Attendance",
    description: "Daily attendance for non-teaching college staff (uses existing staff records)",
    apiPrefixes: ["/employee-attendance"],
    routePrefixes: ["/attendance"],
    availableActions: ["view", "create", "edit", "delete", "approve", "export", "print"]
  },
  {
    key: "field-duty",
    label: "Field Management",
    description:
      "Community/PHC and Hospital field postings — assignment, coordinator attendance, monitoring",
    apiPrefixes: ["/field-duty"],
    routePrefixes: ["/field-management", "/attendance"],
    availableActions: ["view", "create", "edit", "delete", "approve", "export", "print"]
  },
  {
    key: "academics",
    label: "Academic Management",
    description: "Classes, sections, batches, years, subjects, promotions",
    apiPrefixes: ["/academics", "/academic-promotion"],
    routePrefixes: ["/academics"],
    availableActions: ["view", "create", "edit", "delete", "manage", "export"]
  },
  {
    key: "subject-assignment",
    label: "Subject Assignments",
    description: "Teacher–subject workload assignment",
    apiPrefixes: ["/academics/subject-assignments"],
    routePrefixes: ["/academics/subject-assignments"],
    availableActions: ["view", "create", "edit", "delete", "manage"]
  },
  {
    key: "academic-management",
    label: "Session / Lesson / Log Book",
    description: "Session Plan, Lesson Plan, Log Book approvals",
    apiPrefixes: ["/academic-management"],
    routePrefixes: ["/academic-management"],
    availableActions: ["view", "create", "edit", "delete", "approve", "export", "print"]
  },
  {
    key: "academic-calendar",
    label: "Academic Calendar",
    description: "Events, holidays, and academic calendar",
    apiPrefixes: ["/academic-calendar"],
    routePrefixes: ["/academic-calendar"],
    availableActions: ["view", "create", "edit", "delete", "publish", "export"]
  },
  {
    key: "timetable",
    label: "Timetable",
    description: "Class and teacher timetables",
    apiPrefixes: ["/timetable"],
    routePrefixes: ["/timetable"],
    availableActions: ["view", "create", "edit", "delete", "publish", "export"]
  },
  {
    key: "examinations",
    label: "Examination & Results",
    description: "Exams, routines, marks, results, mark sheets",
    apiPrefixes: ["/exams"],
    routePrefixes: ["/exams", "/examination", "/exams-view", "/results", "/print-results"],
    availableActions: [
      "view",
      "create",
      "edit",
      "delete",
      "verify",
      "approve",
      "publish",
      "print",
      "export",
      "manage"
    ]
  },
  {
    key: "results",
    label: "Results",
    description: "Result review, publication, and print",
    apiPrefixes: ["/exams"],
    routePrefixes: ["/results", "/print-results"],
    availableActions: ["view", "verify", "approve", "publish", "print", "export"]
  },
  {
    key: "homework",
    label: "Homework / Classroom",
    description: "Homework and classroom posts",
    apiPrefixes: ["/homework"],
    routePrefixes: ["/homework", "/classroom", "/homework-view"],
    availableActions: ["view", "create", "edit", "delete"]
  },
  {
    key: "notices",
    label: "Notices",
    description: "Notice board management",
    apiPrefixes: ["/notices"],
    routePrefixes: ["/notices"],
    availableActions: ["view", "create", "edit", "delete", "publish"]
  },
  {
    key: "banners",
    label: "Banner Management",
    description: "Dashboard banners and announcements",
    apiPrefixes: ["/banners"],
    routePrefixes: ["/banners", "/notices"],
    availableActions: ["view", "create", "edit", "delete", "publish"]
  },
  {
    key: "library",
    label: "Library",
    description: "Library catalog, issues, and returns",
    apiPrefixes: ["/library"],
    routePrefixes: ["/library", "/my-library"],
    availableActions: ["view", "create", "edit", "delete", "manage", "export"]
  },
  {
    key: "laboratory",
    label: "Laboratory",
    description: "Lab equipment and inventory",
    apiPrefixes: ["/laboratory"],
    routePrefixes: ["/laboratory"],
    availableActions: ["view", "create", "edit", "delete", "manage", "export"]
  },
  {
    key: "inventory",
    label: "Inventory",
    description: "Stock/inventory operations (library & lab stock)",
    apiPrefixes: [],
    routePrefixes: [],
    availableActions: ["view", "create", "edit", "delete", "manage"]
  },
  {
    key: "accounts",
    label: "Accounting",
    description: "Accounting, journals, ledgers, approvals",
    apiPrefixes: ["/accounting"],
    routePrefixes: ["/accounting"],
    availableActions: ["view", "create", "edit", "delete", "approve", "export", "configure"]
  },
  {
    key: "fees",
    label: "Fee Management",
    description: "Fee collection and structures",
    apiPrefixes: ["/fees"],
    routePrefixes: ["/fees", "/my-fees"],
    availableActions: ["view", "create", "edit", "delete", "approve", "export", "print"]
  },
  {
    key: "transport",
    label: "Transport",
    description: "Transport routes and vehicles",
    apiPrefixes: ["/transport"],
    routePrefixes: ["/transport"],
    availableActions: ["view", "create", "edit", "delete", "manage"]
  },
  {
    key: "hr",
    label: "Human Resources",
    description: "HR, leave, and payroll",
    apiPrefixes: ["/hr"],
    routePrefixes: ["/hr"],
    availableActions: ["view", "create", "edit", "delete", "approve", "export"]
  },
  {
    key: "hostel",
    label: "Hostel",
    description: "Hostel management (future module)",
    apiPrefixes: [],
    routePrefixes: ["/hostel"],
    availableActions: ["view", "create", "edit", "delete", "manage"]
  },
  {
    key: "reports",
    label: "Reports & Analytics",
    description: "Exports and reporting",
    apiPrefixes: ["/exports"],
    routePrefixes: ["/reports"],
    availableActions: ["view", "export", "print"]
  },
  {
    key: "settings",
    label: "Settings",
    description: "Institution settings",
    apiPrefixes: ["/settings"],
    routePrefixes: ["/settings"],
    availableActions: ["view", "edit", "configure"]
  },
  {
    key: "user-management",
    label: "User Management",
    description: "User accounts and permission management",
    apiPrefixes: ["/users", "/admin"],
    routePrefixes: ["/admin-management", "/college-administrators"],
    availableActions: ["view", "create", "edit", "delete", "manage", "configure"]
  },
  {
    key: "complaints",
    label: "Complaints",
    description: "Complaint management",
    apiPrefixes: ["/complaints"],
    routePrefixes: ["/complaints", "/complains"],
    availableActions: ["view", "create", "edit", "delete", "approve", "manage"]
  }
];

export const MODULE_ACCESS_DISABLED_MESSAGE =
  "Access to modify this module has been disabled by the Administrator.";

export const MODULE_ACCESS_DENIED_MESSAGE =
  "You do not have access to this department. Contact the Administrator.";

export type ModuleAccessMap = Partial<Record<ErpModuleKey, ModuleAccessMode>>;

/** Optional granular actions per module (subset of MODULE_PERMISSION_ACTIONS). */
export type ModuleActionsMap = Partial<Record<ErpModuleKey, ModulePermissionAction[]>>;

export const isErpModuleKey = (value: string): value is ErpModuleKey =>
  (ERP_MODULE_KEYS as readonly string[]).includes(value);

export const isModulePermissionAction = (value: string): value is ModulePermissionAction =>
  (MODULE_PERMISSION_ACTIONS as readonly string[]).includes(value);

/**
 * Zod 4 `z.record(z.enum(keys), …)` requires every enum key.
 * Permission maps are partial — use string keys + filter known modules.
 */
const moduleAccessModeSchema = z.enum(["NONE", "READ_ONLY", "WRITE"]);
const modulePermissionActionSchema = z.enum(MODULE_PERMISSION_ACTIONS);

export const moduleAccessMapSchema = z
  .record(z.string(), moduleAccessModeSchema)
  .transform((value) => {
    const out: ModuleAccessMap = {};
    for (const [key, mode] of Object.entries(value)) {
      if (isErpModuleKey(key)) {
        out[key] = mode;
      }
    }
    return out;
  });

export const moduleActionsMapSchema = z
  .record(z.string(), z.array(modulePermissionActionSchema))
  .transform((value) => {
    const out: ModuleActionsMap = {};
    for (const [key, actions] of Object.entries(value)) {
      if (isErpModuleKey(key)) {
        out[key] = actions;
      }
    }
    return out;
  });

export const PERMISSION_PRESETS = ["FULL_ACCESS", "READ_ONLY", "NO_ACCESS", "CUSTOM"] as const;
export type PermissionPreset = (typeof PERMISSION_PRESETS)[number];

export const updateModuleAccessSchema = z.object({
  moduleAccess: moduleAccessMapSchema,
  moduleActions: moduleActionsMapSchema.optional().default({}),
  /** Optional secondary ERP roles for multi-responsibility (e.g. TEACHER + lab). */
  secondaryRoles: z
    .array(
      z.enum([
        "TEACHER",
        "LIBRARY_STAFF",
        "LABORATORY_STAFF",
        "ACCOUNTANT",
        "CASHIER",
        "AUDITOR",
        "PRINCIPAL",
        "COLLEGE_STAFF",
        "COLLEGE_VIEWER"
      ])
    )
    .optional()
    .default([]),
  /** Leadership designation label — never grants permissions by itself. */
  designation: z
    .union([z.string().trim().max(120), z.null()])
    .optional()
    .transform((value) => (value === "" ? null : value ?? null)),
  reason: z
    .union([z.string().trim().max(500), z.null(), z.undefined()])
    .optional()
    .transform((value) => {
      if (value === null || value === undefined) return undefined;
      const trimmed = value.trim();
      return trimmed.length ? trimmed : undefined;
    })
});

export type UpdateModuleAccessInput = z.infer<typeof updateModuleAccessSchema>;

/**
 * Leadership / management designations (position titles only).
 * These NEVER grant ERP permissions automatically.
 */
export const LEADERSHIP_DESIGNATIONS = [
  "Principal",
  "Vice Principal",
  "Director",
  "Academic Director",
  "Examination Controller",
  "Program Coordinator",
  "Department Head",
  "Board Member",
  "Management Committee Member",
  "Dean",
  "Coordinator",
  "Other"
] as const;

export type LeadershipDesignation = (typeof LEADERSHIP_DESIGNATIONS)[number];

/**
 * Default when no permissions have been configured yet (legacy accounts).
 * Once an admin saves any moduleAccess map, missing modules resolve as NONE
 * so only explicitly granted departments appear for staff.
 */
export const defaultModuleAccessMode = (): ModuleAccessMode => "WRITE";

export const normalizeModuleAccessMode = (value: unknown): ModuleAccessMode => {
  if (value === "NONE" || value === "READ_ONLY" || value === "WRITE") return value;
  // Legacy unknown values: treat as WRITE
  return "WRITE";
};

const hasExplicitModuleAccess = (map: ModuleAccessMap | null | undefined): boolean => {
  if (!map) return false;
  return Object.keys(map).length > 0;
};

export const resolveModuleAccessMode = (
  map: ModuleAccessMap | null | undefined,
  moduleKey: ErpModuleKey
): ModuleAccessMode => {
  // No permissions configured yet → legacy full access (teachers/staff without admin matrix)
  if (!hasExplicitModuleAccess(map)) {
    return "WRITE";
  }
  const mode = map?.[moduleKey];
  // Explicit map: only granted modules (WRITE / READ_ONLY); everything else is hidden
  if (mode === undefined) return "NONE";
  return normalizeModuleAccessMode(mode);
};

export const canAccessModule = (
  map: ModuleAccessMap | null | undefined,
  moduleKey: ErpModuleKey
): boolean => resolveModuleAccessMode(map, moduleKey) !== "NONE";

export const canWriteModule = (
  map: ModuleAccessMap | null | undefined,
  moduleKey: ErpModuleKey
): boolean => resolveModuleAccessMode(map, moduleKey) === "WRITE";

export const canReadModule = (
  map: ModuleAccessMap | null | undefined,
  moduleKey: ErpModuleKey
): boolean => {
  const mode = resolveModuleAccessMode(map, moduleKey);
  return mode === "WRITE" || mode === "READ_ONLY";
};

/** Resolve effective actions for a module (granular list or mode defaults). */
export const resolveModuleActions = (
  map: ModuleAccessMap | null | undefined,
  actionsMap: ModuleActionsMap | null | undefined,
  moduleKey: ErpModuleKey
): ModulePermissionAction[] => {
  const mode = resolveModuleAccessMode(map, moduleKey);
  if (mode === "NONE") return [];

  const explicit = actionsMap?.[moduleKey];
  if (explicit && explicit.length > 0) {
    // READ_ONLY never allows write-like actions even if mis-stored
    if (mode === "READ_ONLY") {
      return explicit.filter((a) => a === "view" || a === "print" || a === "export");
    }
    return explicit;
  }

  return ACTIONS_FOR_MODE[mode];
};

export const hasModuleAction = (
  map: ModuleAccessMap | null | undefined,
  actionsMap: ModuleActionsMap | null | undefined,
  moduleKey: ErpModuleKey,
  action: ModulePermissionAction
): boolean => resolveModuleActions(map, actionsMap, moduleKey).includes(action);

/**
 * Build full mode map for every known module.
 * - Empty / unset map → all WRITE (legacy accounts with no admin matrix yet)
 * - Non-empty map → explicit values; any missing module → NONE (not granted)
 */
export const expandModuleAccessMap = (
  map?: ModuleAccessMap | null
): Record<ErpModuleKey, ModuleAccessMode> => {
  const result = {} as Record<ErpModuleKey, ModuleAccessMode>;
  const explicit = hasExplicitModuleAccess(map);
  for (const key of ERP_MODULE_KEYS) {
    if (!explicit) {
      result[key] = "WRITE";
      continue;
    }
    const mode = map?.[key];
    result[key] = mode === undefined ? "NONE" : normalizeModuleAccessMode(mode);
  }
  return result;
};

/** Build full actions map using explicit values or mode defaults. */
export const expandModuleActionsMap = (
  map?: ModuleAccessMap | null,
  actionsMap?: ModuleActionsMap | null
): Record<ErpModuleKey, ModulePermissionAction[]> => {
  const result = {} as Record<ErpModuleKey, ModulePermissionAction[]>;
  for (const key of ERP_MODULE_KEYS) {
    result[key] = resolveModuleActions(map, actionsMap, key);
  }
  return result;
};

/** Preset builders for the admin UI. */
export const buildPresetModuleAccess = (
  preset: PermissionPreset
): Record<ErpModuleKey, ModuleAccessMode> => {
  const mode: ModuleAccessMode =
    preset === "FULL_ACCESS" ? "WRITE" : preset === "READ_ONLY" ? "READ_ONLY" : "NONE";
  // CUSTOM returns current-like full WRITE as a starting point; UI keeps custom edits
  if (preset === "CUSTOM") {
    return expandModuleAccessMap({});
  }
  const result = {} as Record<ErpModuleKey, ModuleAccessMode>;
  for (const key of ERP_MODULE_KEYS) {
    // Profile always readable for login self-service
    if (key === "profile") {
      result[key] = preset === "NO_ACCESS" ? "READ_ONLY" : mode === "NONE" ? "READ_ONLY" : mode;
      continue;
    }
    if (key === "dashboard" && preset === "NO_ACCESS") {
      result[key] = "READ_ONLY";
      continue;
    }
    result[key] = mode;
  }
  return result;
};

/**
 * Resolve ERP module from an API path (e.g. /api/academic-management/session-plans).
 * Longer prefixes win (subject-assignment before academics).
 */
export const resolveModuleFromApiPath = (apiPath: string): ErpModuleKey | null => {
  const path = apiPath.split("?")[0] ?? apiPath;
  const normalized = path.startsWith("/api") ? path.slice(4) || "/" : path;
  const withSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;

  const ranked = [...ERP_MODULES]
    .filter((m) => m.apiPrefixes.length > 0)
    .sort((a, b) => {
      const aMax = Math.max(...a.apiPrefixes.map((p) => p.length));
      const bMax = Math.max(...b.apiPrefixes.map((p) => p.length));
      return bMax - aMax;
    });

  for (const mod of ranked) {
    for (const prefix of mod.apiPrefixes) {
      if (withSlash === prefix || withSlash.startsWith(`${prefix}/`)) {
        return mod.key;
      }
    }
  }
  return null;
};

export const resolveModuleFromRoutePath = (routePath: string): ErpModuleKey | null => {
  const path = (routePath.split("?")[0] ?? routePath) || "/";
  const ranked = [...ERP_MODULES]
    .filter((m) => m.routePrefixes.length > 0)
    .sort((a, b) => {
      const aMax = Math.max(...a.routePrefixes.map((p) => p.length));
      const bMax = Math.max(...b.routePrefixes.map((p) => p.length));
      return bMax - aMax;
    });

  for (const mod of ranked) {
    for (const prefix of mod.routePrefixes) {
      if (path === prefix || path.startsWith(`${prefix}/`)) {
        return mod.key;
      }
    }
  }
  return null;
};

/** Map HTTP method to a coarse permission action for API guards. */
export const methodToPermissionAction = (
  method: string
): ModulePermissionAction | "view" => {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return "view";
  if (m === "POST") return "create";
  if (m === "PUT" || m === "PATCH") return "edit";
  if (m === "DELETE") return "delete";
  return "manage";
};

/** Infer whether a path is an approve/verify/publish style endpoint. */
export const inferActionFromApiPath = (
  method: string,
  apiPath: string
): ModulePermissionAction => {
  const path = (apiPath.split("?")[0] ?? apiPath).toLowerCase();
  if (/\/approve|\/reject|\/unlock|\/lock|\/review/.test(path)) return "approve";
  if (/\/verify/.test(path)) return "verify";
  if (/\/publish/.test(path)) return "publish";
  if (/\/export|\/download/.test(path)) return "export";
  if (/\/print/.test(path)) return "print";
  return methodToPermissionAction(method);
};
