import { z } from "zod";

/**
 * Canonical ERP modules for per-user Module Access Control.
 * New modules should be added here so they appear automatically in the admin UI.
 */
export const ERP_MODULE_KEYS = [
  "dashboard",
  "profile",
  "attendance",
  "daily-attendance",
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
  "library",
  "laboratory",
  "accounts",
  "fees",
  "transport",
  "hr",
  "reports",
  "settings",
  "complaints",
  "inventory"
] as const;

export type ErpModuleKey = (typeof ERP_MODULE_KEYS)[number];

/** WRITE = full actions; READ_ONLY = view only (module "disabled" for modifications). */
export type ModuleAccessMode = "WRITE" | "READ_ONLY";

export interface ErpModuleDefinition {
  key: ErpModuleKey;
  label: string;
  description: string;
  /** API path prefixes under /api that belong to this module. */
  apiPrefixes: string[];
  /** Frontend route prefixes (for UI guards). */
  routePrefixes: string[];
}

export const ERP_MODULES: ErpModuleDefinition[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    description: "Home dashboards and overview widgets",
    apiPrefixes: ["/dashboard"],
    routePrefixes: ["/dashboard"]
  },
  {
    key: "profile",
    label: "Profile",
    description: "Own profile and password (self-service always allowed for password)",
    apiPrefixes: [],
    routePrefixes: ["/profile", "/my-profile"]
  },
  {
    key: "attendance",
    label: "Attendance",
    description: "Period / subject attendance marking",
    apiPrefixes: ["/attendance"],
    routePrefixes: ["/attendance"]
  },
  {
    key: "daily-attendance",
    label: "Daily Attendance",
    description: "Daily class attendance",
    apiPrefixes: ["/daily-attendance"],
    routePrefixes: ["/daily-attendance"]
  },
  {
    key: "field-duty",
    label: "Field / Hospital Duty",
    description: "Hospital and field duty attendance",
    apiPrefixes: ["/field-duty"],
    routePrefixes: ["/attendance"]
  },
  {
    key: "academics",
    label: "Academics",
    description: "Classes, sections, batches, years, subjects",
    apiPrefixes: ["/academics", "/academic-promotion"],
    routePrefixes: ["/academics"]
  },
  {
    key: "subject-assignment",
    label: "Subject Assignment",
    description: "Teacher–subject workload assignment",
    apiPrefixes: ["/academics/subject-assignments"],
    routePrefixes: ["/academics/subject-assignments"]
  },
  {
    key: "academic-management",
    label: "Academic Management",
    description: "Session Plan, Lesson Plan, Log Book",
    apiPrefixes: ["/academic-management"],
    routePrefixes: ["/academic-management"]
  },
  {
    key: "academic-calendar",
    label: "Academic Calendar",
    description: "Events and academic calendar",
    apiPrefixes: ["/academic-calendar"],
    routePrefixes: ["/academic-calendar"]
  },
  {
    key: "timetable",
    label: "Timetable",
    description: "Class and teacher timetables",
    apiPrefixes: ["/timetable"],
    routePrefixes: ["/timetable"]
  },
  {
    key: "examinations",
    label: "Examination",
    description: "Exams, routines, marks entry",
    apiPrefixes: ["/exams"],
    routePrefixes: ["/exams", "/examination"]
  },
  {
    key: "results",
    label: "Results",
    description: "Result review and print",
    apiPrefixes: ["/exams"],
    routePrefixes: ["/results", "/print-results"]
  },
  {
    key: "homework",
    label: "Homework / Classroom",
    description: "Homework and classroom posts",
    apiPrefixes: ["/homework"],
    routePrefixes: ["/homework", "/classroom"]
  },
  {
    key: "notices",
    label: "Notices",
    description: "Notices and banners",
    apiPrefixes: ["/notices", "/banners"],
    routePrefixes: ["/notices", "/banners"]
  },
  {
    key: "library",
    label: "Library",
    description: "Library catalog, issues, and returns",
    apiPrefixes: ["/library"],
    routePrefixes: ["/library"]
  },
  {
    key: "laboratory",
    label: "Laboratory",
    description: "Lab equipment and inventory",
    apiPrefixes: ["/laboratory"],
    routePrefixes: ["/laboratory"]
  },
  {
    key: "accounts",
    label: "Accounts",
    description: "Accounting, journals, ledgers",
    apiPrefixes: ["/accounting"],
    routePrefixes: ["/accounting"]
  },
  {
    key: "fees",
    label: "Fees",
    description: "Fee collection and structures",
    apiPrefixes: ["/fees"],
    routePrefixes: ["/fees"]
  },
  {
    key: "transport",
    label: "Transport",
    description: "Transport routes and vehicles",
    apiPrefixes: ["/transport"],
    routePrefixes: ["/transport"]
  },
  {
    key: "hr",
    label: "HR",
    description: "Human resources and leave",
    apiPrefixes: ["/hr"],
    routePrefixes: ["/hr"]
  },
  {
    key: "reports",
    label: "Reports",
    description: "Exports and reporting",
    apiPrefixes: ["/exports"],
    routePrefixes: ["/reports"]
  },
  {
    key: "settings",
    label: "Settings",
    description: "Institution settings",
    apiPrefixes: ["/settings"],
    routePrefixes: ["/settings"]
  },
  {
    key: "complaints",
    label: "Complaints",
    description: "Complaint management",
    apiPrefixes: ["/complaints"],
    routePrefixes: ["/complaints"]
  },
  {
    key: "inventory",
    label: "Inventory",
    description: "Stock/inventory operations (library & lab stock actions)",
    apiPrefixes: [],
    routePrefixes: []
  }
];

export const MODULE_ACCESS_DISABLED_MESSAGE =
  "Access to modify this module has been disabled by the Administrator.";

export type ModuleAccessMap = Partial<Record<ErpModuleKey, ModuleAccessMode>>;

export const moduleAccessMapSchema = z.record(
  z.enum(ERP_MODULE_KEYS),
  z.enum(["WRITE", "READ_ONLY"])
);

export const updateModuleAccessSchema = z.object({
  moduleAccess: moduleAccessMapSchema
});

export type UpdateModuleAccessInput = z.infer<typeof updateModuleAccessSchema>;

export const isErpModuleKey = (value: string): value is ErpModuleKey =>
  (ERP_MODULE_KEYS as readonly string[]).includes(value);

/** Default when not stored: full write (enabled). */
export const defaultModuleAccessMode = (): ModuleAccessMode => "WRITE";

export const resolveModuleAccessMode = (
  map: ModuleAccessMap | null | undefined,
  moduleKey: ErpModuleKey
): ModuleAccessMode => {
  const mode = map?.[moduleKey];
  return mode === "READ_ONLY" ? "READ_ONLY" : "WRITE";
};

export const canWriteModule = (
  map: ModuleAccessMap | null | undefined,
  moduleKey: ErpModuleKey
): boolean => resolveModuleAccessMode(map, moduleKey) === "WRITE";

/** Build full map with defaults for every known module. */
export const expandModuleAccessMap = (
  map?: ModuleAccessMap | null
): Record<ErpModuleKey, ModuleAccessMode> => {
  const result = {} as Record<ErpModuleKey, ModuleAccessMode>;
  for (const key of ERP_MODULE_KEYS) {
    result[key] = resolveModuleAccessMode(map, key);
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
