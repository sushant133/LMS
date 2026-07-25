import {
  normalizeParentPortalAccess,
  type ParentPortalAccessMap,
  type ParentPortalAccessResponse,
  PARENT_PORTAL_MODULE_META
} from "@phit-erp/shared";
import { Setting } from "../models/Setting.js";
import { User } from "../models/User.js";

const mapFromUserField = (raw: unknown): ParentPortalAccessMap | null => {
  if (!raw || typeof raw !== "object") return null;
  // Mongoose Map → plain object
  if (raw instanceof Map) {
    return normalizeParentPortalAccess(Object.fromEntries(raw.entries()));
  }
  return normalizeParentPortalAccess(raw as Record<string, boolean>);
};

export const getParentPortalAccessForSchool = async (
  schoolId: string
): Promise<ParentPortalAccessMap> => {
  const settings = await Setting.findOne({ schoolId })
    .select("parentPortalAccess")
    .lean();
  const raw = (settings as { parentPortalAccess?: Record<string, boolean> } | null)
    ?.parentPortalAccess;
  return normalizeParentPortalAccess(raw);
};

export const setParentPortalAccessForSchool = async (
  schoolId: string,
  modules: Partial<Record<string, boolean>>
): Promise<ParentPortalAccessMap> => {
  const normalized = normalizeParentPortalAccess(modules);
  const settings = await Setting.findOneAndUpdate(
    { schoolId },
    { $set: { parentPortalAccess: normalized } },
    { new: true }
  );
  if (!settings) {
    return normalized;
  }
  return normalizeParentPortalAccess(
    (settings.toObject() as { parentPortalAccess?: Record<string, boolean> })
      .parentPortalAccess
  );
};

/**
 * Effective access for a parent user:
 * - custom parentPortalAccess on User when set
 * - otherwise school defaults
 */
export const getEffectiveParentPortalAccess = async (
  schoolId: string,
  parentUserId: string
): Promise<{
  modules: ParentPortalAccessMap;
  schoolDefaults: ParentPortalAccessMap;
  useSchoolDefaults: boolean;
  customModules: ParentPortalAccessMap | null;
}> => {
  const schoolDefaults = await getParentPortalAccessForSchool(schoolId);
  const parent = await User.findOne({
    _id: parentUserId,
    role: "PARENT",
    schoolId
  })
    .select("parentPortalAccess")
    .lean();

  if (!parent) {
    return {
      modules: schoolDefaults,
      schoolDefaults,
      useSchoolDefaults: true,
      customModules: null
    };
  }

  const raw = (parent as { parentPortalAccess?: unknown }).parentPortalAccess;
  const hasCustom =
    raw !== undefined && raw !== null && typeof raw === "object";

  if (!hasCustom) {
    return {
      modules: schoolDefaults,
      schoolDefaults,
      useSchoolDefaults: true,
      customModules: null
    };
  }

  const customModules = mapFromUserField(raw)!;
  return {
    modules: customModules,
    schoolDefaults,
    useSchoolDefaults: false,
    customModules
  };
};

export const setParentUserPortalAccess = async (
  schoolId: string,
  parentUserId: string,
  options: {
    /** When true, clear custom access and fall back to school defaults */
    useSchoolDefaults?: boolean;
    modules?: Partial<Record<string, boolean>>;
  }
): Promise<{
  modules: ParentPortalAccessMap;
  schoolDefaults: ParentPortalAccessMap;
  useSchoolDefaults: boolean;
  customModules: ParentPortalAccessMap | null;
}> => {
  const parent = await User.findOne({
    _id: parentUserId,
    role: "PARENT",
    schoolId
  });
  if (!parent) {
    throw new Error("PARENT_NOT_FOUND");
  }

  if (options.useSchoolDefaults) {
    parent.parentPortalAccess = null;
    parent.markModified("parentPortalAccess");
    await parent.save();
    return getEffectiveParentPortalAccess(schoolId, parentUserId);
  }

  if (!options.modules || typeof options.modules !== "object") {
    throw new Error("MODULES_REQUIRED");
  }

  const normalized = normalizeParentPortalAccess(options.modules);
  parent.parentPortalAccess = normalized;
  parent.markModified("parentPortalAccess");
  await parent.save();
  return getEffectiveParentPortalAccess(schoolId, parentUserId);
};

export const toParentPortalAccessResponse = (
  modules: ParentPortalAccessMap,
  extras?: {
    parentUserId?: string;
    parentName?: string;
    parentEmail?: string;
    useSchoolDefaults?: boolean;
    schoolDefaults?: ParentPortalAccessMap;
    customModules?: ParentPortalAccessMap | null;
  }
): ParentPortalAccessResponse & {
  parentUserId?: string;
  parentName?: string;
  parentEmail?: string;
  useSchoolDefaults?: boolean;
  schoolDefaults?: ParentPortalAccessMap;
  customModules?: ParentPortalAccessMap | null;
} => ({
  modules,
  meta: PARENT_PORTAL_MODULE_META.map((item) => ({
    key: item.key,
    label: item.label,
    description: item.description,
    routePrefixes: [...item.routePrefixes],
    enabled: modules[item.key] !== false
  })),
  ...extras
});
