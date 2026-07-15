/**
 * Centralized upload module folder layout (relative to tenant root).
 *
 * On disk:  {UPLOAD_DIR}/{schoolId}/{modulePath}/filename.ext
 * Public:   /uploads/{schoolId}/{modulePath}/filename.ext
 *
 * Legacy module keys remain for backward-compatible path resolution of
 * files written before the VPS storage refactor.
 */

/** Canonical module keys used by the upload service. */
export const UPLOAD_MODULES = {
  STUDENTS_PHOTOS: "students/photos",
  STUDENTS_DOCUMENTS: "students/documents",
  TEACHERS_PHOTOS: "teachers/photos",
  TEACHERS_DOCUMENTS: "teachers/documents",
  LIBRARY_BOOK_COVERS: "library/book-covers",
  LIBRARY_EBOOKS: "library/ebooks",
  LIBRARY_DOCUMENTS: "library/documents",
  NOTICES: "notices",
  ASSIGNMENTS: "assignments",
  RESULTS: "results",
  LABORATORY: "laboratory",
  INVENTORY: "inventory",
  ACCOUNTING: "accounting",
  PROFILE: "profile",
  TEMP: "temp",
  /** Operational modules used by existing features */
  COMPLAINTS: "complaints",
  ACADEMIC_MANAGEMENT: "academic-management"
} as const;

export type UploadModuleKey = (typeof UPLOAD_MODULES)[keyof typeof UPLOAD_MODULES];

/**
 * Every directory that must exist under each tenant (and as a global template).
 * Order is intentional for readability in the filesystem.
 */
export const REQUIRED_UPLOAD_FOLDERS: readonly UploadModuleKey[] = [
  UPLOAD_MODULES.STUDENTS_PHOTOS,
  UPLOAD_MODULES.STUDENTS_DOCUMENTS,
  UPLOAD_MODULES.TEACHERS_PHOTOS,
  UPLOAD_MODULES.TEACHERS_DOCUMENTS,
  UPLOAD_MODULES.LIBRARY_BOOK_COVERS,
  UPLOAD_MODULES.LIBRARY_EBOOKS,
  UPLOAD_MODULES.LIBRARY_DOCUMENTS,
  UPLOAD_MODULES.NOTICES,
  UPLOAD_MODULES.ASSIGNMENTS,
  UPLOAD_MODULES.RESULTS,
  UPLOAD_MODULES.LABORATORY,
  UPLOAD_MODULES.INVENTORY,
  UPLOAD_MODULES.ACCOUNTING,
  UPLOAD_MODULES.PROFILE,
  UPLOAD_MODULES.TEMP,
  UPLOAD_MODULES.COMPLAINTS,
  UPLOAD_MODULES.ACADEMIC_MANAGEMENT
];

/**
 * Legacy relative folders that may still appear in MongoDB URLs.
 * Serving and deletion must continue to resolve these paths.
 */
export const LEGACY_UPLOAD_FOLDERS = [
  "banners",
  "banners/thumbs",
  "classroom",
  "staff/photos",
  "staff/documents"
] as const;

/**
 * Map old storage entity segments to the new canonical module path.
 * Used only for *new* writes when callers still pass legacy names.
 */
export const LEGACY_MODULE_ALIASES: Record<string, UploadModuleKey> = {
  banners: UPLOAD_MODULES.NOTICES,
  classroom: UPLOAD_MODULES.ASSIGNMENTS,
  "staff/photos": UPLOAD_MODULES.TEACHERS_PHOTOS,
  "staff/documents": UPLOAD_MODULES.TEACHERS_DOCUMENTS,
  staff: UPLOAD_MODULES.TEACHERS_PHOTOS
};

/** Normalize module path segments (no leading/trailing slashes, forward slashes only). */
export const normalizeModulePath = (modulePath: string): string =>
  modulePath
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/");

/**
 * Resolve a caller-provided entity path to a canonical module directory.
 * Accepts either a single module key or path parts joined with "/".
 */
export const resolveModulePath = (...entityParts: string[]): UploadModuleKey | string => {
  const joined = normalizeModulePath(entityParts.filter(Boolean).join("/"));
  if (!joined) return UPLOAD_MODULES.TEMP;

  const alias = LEGACY_MODULE_ALIASES[joined];
  if (alias) return alias;

  // Already a known module
  if ((REQUIRED_UPLOAD_FOLDERS as readonly string[]).includes(joined)) {
    return joined as UploadModuleKey;
  }

  // Nested under a known module prefix is allowed (e.g. notices/thumbs)
  return joined;
};
