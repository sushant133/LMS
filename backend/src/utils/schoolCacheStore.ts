import type { InstitutionType } from "@phit-erp/shared";

/**
 * Storage for `schoolCache.ts`, kept free of model imports so the School model
 * can clear it from its write hooks without an import cycle.
 */
export interface CachedSchool {
  _id: string;
  isActive: boolean;
  institutionType: InstitutionType;
}

export const schoolCache = new Map<string, { expiresAt: number; value: CachedSchool | null }>();

export const invalidateSchoolCache = (): void => {
  schoolCache.clear();
};
