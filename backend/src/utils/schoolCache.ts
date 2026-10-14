import type { InstitutionType } from "@phit-erp/shared";
import { School } from "../models/School.js";
import { isValidObjectIdString } from "./tenant.js";
import { schoolCache, type CachedSchool } from "./schoolCacheStore.js";

export { invalidateSchoolCache, type CachedSchool } from "./schoolCacheStore.js";

/**
 * `tenantGuard` and `getInstitutionType` each re-read the same School document,
 * so every API request paid one or more extra MongoDB round trips (Atlas is
 * remote, so each one is tens to hundreds of ms) for data that almost never
 * changes. The School model's write hooks clear this cache, and the short TTL
 * bounds staleness across multiple Node processes.
 */
const SCHOOL_CACHE_TTL_MS = 60_000;

export const getCachedSchool = async (schoolId: string | undefined | null): Promise<CachedSchool | null> => {
  if (!schoolId || !isValidObjectIdString(schoolId)) return null;
  const key = String(schoolId);
  const now = Date.now();
  const hit = schoolCache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const doc = await School.findById(key).select("_id isActive institutionType").lean();
  const value: CachedSchool | null = doc
    ? {
        _id: doc._id.toString(),
        isActive: Boolean(doc.isActive),
        institutionType: (doc.institutionType as InstitutionType | undefined) ?? "SCHOOL"
      }
    : null;
  schoolCache.set(key, { expiresAt: now + SCHOOL_CACHE_TTL_MS, value });
  return value;
};
