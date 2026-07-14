import type {
  AcademicLessonPlanRecord,
  AcademicLogBookEntryRecord,
  AcademicSessionPlanRecord,
  SubjectAssignmentRecord,
  SubjectRecord,
} from "@phit-erp/shared";

export interface HierarchyScopeOption {
  _id: string;
  name: string;
  level?: number;
  batchId?: string;
  classId?: string;
  isActive?: boolean;
}

/** Curriculum subject node — one entry per subject, not per batch instance. */
export interface HierarchySubjectNode {
  /** Stable curriculum key (masterSubjectId | code | name). */
  subjectKey: string;
  /** All provisioned subject instance IDs that share this curriculum subject. */
  subjectIds: string[];
  subjectName: string;
  subjectCode?: string;
  facultyKey: string;
  facultyLabel: string;
  yearKey: string;
  yearLabel: string;
  recordCount: number;
  teacherIds: string[];
  teacherNames: string[];
}

export interface HierarchyYearNode {
  /** Year level key e.g. "level:1" or "name:1st Year" — never a batch-specific year _id. */
  key: string;
  label: string;
  sortOrder: number;
  subjects: HierarchySubjectNode[];
  recordCount: number;
}

export interface HierarchyFacultyNode {
  key: string;
  label: string;
  years: HierarchyYearNode[];
  recordCount: number;
}

const UNASSIGNED_YEAR_KEY = "level:unassigned";
const GENERAL_FACULTY_KEY = "faculty:general";

const idOf = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "_id" in value) {
    return String((value as { _id: string })._id);
  }
  return String(value);
};

const normalizeFaculty = (value?: string | null): { key: string; label: string } => {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return { key: GENERAL_FACULTY_KEY, label: "General / All Programs" };
  }
  return { key: `faculty:${trimmed.toLowerCase()}`, label: trimmed };
};

/** Build a batch-independent year key from level or display name. */
export const yearLevelKey = (level?: number | null, name?: string | null): string => {
  if (typeof level === "number" && level > 0) return `level:${level}`;
  const n = (name ?? "").trim();
  if (!n) return UNASSIGNED_YEAR_KEY;
  // Normalize "1st Year", "First Year", etc. by leading digit when possible
  const digit = n.match(/(\d+)/)?.[1];
  if (digit) return `level:${Number(digit)}`;
  return `name:${n.toLowerCase()}`;
};

export const yearLevelLabel = (key: string, fallbackName?: string): string => {
  if (key === UNASSIGNED_YEAR_KEY) return "Unassigned Year";
  if (key.startsWith("level:")) {
    const n = Number(key.slice("level:".length));
    if (n === 1) return "1st Year";
    if (n === 2) return "2nd Year";
    if (n === 3) return "3rd Year";
    if (Number.isFinite(n) && n > 0) {
      const j = n % 10;
      const k = n % 100;
      const suffix =
        j === 1 && k !== 11 ? "st" : j === 2 && k !== 12 ? "nd" : j === 3 && k !== 13 ? "rd" : "th";
      return `${n}${suffix} Year`;
    }
  }
  if (key.startsWith("name:")) return fallbackName || key.slice("name:".length);
  return fallbackName || key;
};

const yearSortOrder = (key: string): number => {
  if (key === UNASSIGNED_YEAR_KEY) return 9999;
  if (key.startsWith("level:")) {
    const n = Number(key.slice("level:".length));
    return Number.isFinite(n) ? n : 100;
  }
  return 100;
};

/** Curriculum identity: prefer master subject, else code, else name — not batch instance _id. */
export const curriculumSubjectKey = (subject: {
  _id: string;
  masterSubjectId?: string | null;
  code?: string;
  name?: string;
}): string => {
  if (subject.masterSubjectId) return `master:${subject.masterSubjectId}`;
  const code = (subject.code ?? "").trim().toLowerCase();
  if (code) return `code:${code}`;
  const name = (subject.name ?? "").trim().toLowerCase();
  if (name) return `name:${name}`;
  return `id:${subject._id}`;
};

const teacherNameOf = (
  teacherId: string,
  teachers: Array<{ _id: string; user?: { fullName?: string } }>,
  fallback?: string,
): string => {
  const match = teachers.find((t) => t._id === teacherId);
  return match?.user?.fullName ?? fallback ?? "Teacher";
};

type SubjectInput = Pick<
  SubjectRecord,
  "_id" | "name" | "code" | "yearIds" | "classIds" | "isActive"
> & { masterSubjectId?: string | null };

/**
 * Build Faculty/Program → Year (1st/2nd/3rd by level, batch-independent) → Subject hierarchy.
 * Subjects are deduplicated by curriculum identity so batch-provisioned instances collapse into one.
 * Multiple teachers appear under that single subject node.
 */
export const buildAcademicHierarchy = (params: {
  isCollege: boolean;
  years?: HierarchyScopeOption[];
  classes?: HierarchyScopeOption[];
  subjects: SubjectInput[];
  assignments?: SubjectAssignmentRecord[];
  records: Array<{
    subjectId: string;
    yearId?: string;
    classId?: string;
    teacherId: string;
    faculty?: string;
    subjectName?: string;
    teacherName?: string;
  }>;
  teachers?: Array<{ _id: string; user?: { fullName?: string } }>;
  filterYearId?: string;
  filterClassId?: string;
  filterSubjectId?: string;
  filterTeacherId?: string;
  filterFaculty?: string;
  keyword?: string;
}): HierarchyFacultyNode[] => {
  const {
    isCollege,
    years = [],
    classes = [],
    subjects,
    assignments = [],
    records,
    teachers = [],
    filterYearId,
    filterClassId,
    filterSubjectId,
    filterTeacherId,
    filterFaculty,
    keyword,
  } = params;

  // Map batch-specific year _id → year level key (dedupes 1st Year across batches)
  const yearIdToKey = new Map<string, string>();
  const yearIdToLabel = new Map<string, string>();
  for (const y of years) {
    if (y.isActive === false) continue;
    const key = yearLevelKey(y.level, y.name);
    yearIdToKey.set(y._id, key);
    yearIdToLabel.set(y._id, yearLevelLabel(key, y.name));
  }

  // If user filters by a specific batch year id, convert to level key
  const filterYearLevelKey = filterYearId
    ? yearIdToKey.get(filterYearId) ?? yearLevelKey(undefined, undefined)
    : undefined;

  // For school mode, class ids stay as-is (not batch-based)
  const classIdToKey = new Map<string, string>();
  for (const c of classes) {
    if (c.isActive === false) continue;
    classIdToKey.set(c._id, `class:${c._id}`);
  }
  const filterClassKey = filterClassId ? `class:${filterClassId}` : undefined;

  const subjectById = new Map(subjects.map((s) => [s._id, s]));

  type Acc = {
    subjectKey: string;
    subjectIds: Set<string>;
    subjectName: string;
    subjectCode?: string;
    facultyKey: string;
    facultyLabel: string;
    yearKey: string;
    yearLabel: string;
    teacherIds: Set<string>;
    teacherNames: Set<string>;
    recordCount: number;
  };

  // facultyKey → yearKey → subjectKey → Acc
  const tree = new Map<string, Map<string, Map<string, Acc>>>();

  const ensure = (
    facultyKey: string,
    facultyLabel: string,
    yearKey: string,
    yearLabel: string,
    subjectKey: string,
    subjectId: string,
    subjectName: string,
    subjectCode?: string,
  ): Acc => {
    if (!tree.has(facultyKey)) tree.set(facultyKey, new Map());
    const byYear = tree.get(facultyKey)!;
    if (!byYear.has(yearKey)) byYear.set(yearKey, new Map());
    const bySubject = byYear.get(yearKey)!;
    let acc = bySubject.get(subjectKey);
    if (!acc) {
      acc = {
        subjectKey,
        subjectIds: new Set(),
        subjectName,
        subjectCode,
        facultyKey,
        facultyLabel,
        yearKey,
        yearLabel,
        teacherIds: new Set(),
        teacherNames: new Set(),
        recordCount: 0,
      };
      bySubject.set(subjectKey, acc);
    }
    acc.subjectIds.add(subjectId);
    if (subjectName && (!acc.subjectName || acc.subjectName === "Unknown subject")) {
      acc.subjectName = subjectName;
    }
    if (subjectCode && !acc.subjectCode) acc.subjectCode = subjectCode;
    return acc;
  };

  const resolveYearPlacesForSubject = (
    subject: SubjectInput,
  ): Array<{ key: string; label: string }> => {
    if (isCollege) {
      const levels = new Map<string, string>();
      for (const yearId of subject.yearIds ?? []) {
        const key = yearIdToKey.get(yearId);
        if (key) {
          levels.set(key, yearIdToLabel.get(yearId) ?? yearLevelLabel(key));
        }
      }
      if (levels.size === 0) {
        return [{ key: UNASSIGNED_YEAR_KEY, label: yearLevelLabel(UNASSIGNED_YEAR_KEY) }];
      }
      return [...levels.entries()].map(([key, label]) => ({ key, label }));
    }
    // School: class is the academic tier (not batch)
    const classPlaces = (subject.classIds ?? []).map((id) => {
      const cls = classes.find((c) => c._id === id);
      return {
        key: `class:${id}`,
        label: cls?.name ?? "Class",
      };
    });
    if (classPlaces.length === 0) {
      return [{ key: UNASSIGNED_YEAR_KEY, label: "Unassigned Class" }];
    }
    return classPlaces;
  };

  const facultyFilter = filterFaculty?.trim().toLowerCase();

  const passesFaculty = (facultyLabel: string, facultyKey: string) => {
    if (!facultyFilter) return true;
    return (
      facultyLabel.toLowerCase().includes(facultyFilter) ||
      facultyKey.toLowerCase().includes(facultyFilter)
    );
  };

  // 1) Seed from subject master (curriculum structure — batch-independent levels)
  for (const subject of subjects) {
    if (subject.isActive === false) continue;
    if (filterSubjectId && subject._id !== filterSubjectId) {
      // Allow match if filter is another instance of same curriculum
      const filtered = subjectById.get(filterSubjectId);
      if (
        !filtered ||
        curriculumSubjectKey(filtered) !== curriculumSubjectKey(subject)
      ) {
        continue;
      }
    }

    const subjectKey = curriculumSubjectKey(subject);
    const places = resolveYearPlacesForSubject(subject);

    for (const place of places) {
      if (isCollege && filterYearLevelKey && place.key !== filterYearLevelKey) continue;
      if (!isCollege && filterClassKey && place.key !== filterClassKey) continue;

      // Faculty unknown from subject master alone — place under General until assignment/record says otherwise
      const fac = normalizeFaculty(undefined);
      ensure(
        fac.key,
        fac.label,
        place.key,
        place.label,
        subjectKey,
        subject._id,
        subject.name,
        subject.code,
      );
    }
  }

  // 2) Assignments — attach teachers + faculty without creating batch year duplicates
  for (const assignment of assignments) {
    if (assignment.status && assignment.status !== "ACTIVE") continue;
    const subjectId = idOf(assignment.subjectId);
    if (!subjectId) continue;

    const subject = subjectById.get(subjectId);
    const subjectKey = subject
      ? curriculumSubjectKey(subject)
      : curriculumSubjectKey({
          _id: subjectId,
          name:
            typeof assignment.subjectId === "object" &&
            assignment.subjectId &&
            "name" in assignment.subjectId
              ? String((assignment.subjectId as { name?: string }).name ?? "")
              : "",
          code:
            typeof assignment.subjectId === "object" &&
            assignment.subjectId &&
            "code" in assignment.subjectId
              ? String((assignment.subjectId as { code?: string }).code ?? "")
              : "",
        });

    if (filterSubjectId) {
      const filtered = subjectById.get(filterSubjectId);
      if (filtered && curriculumSubjectKey(filtered) !== subjectKey && filterSubjectId !== subjectId) {
        continue;
      }
    }

    const teacherId = idOf(assignment.teacherId);
    if (filterTeacherId && teacherId !== filterTeacherId) continue;

    const fac = normalizeFaculty(assignment.faculty);
    if (!passesFaculty(fac.label, fac.key)) continue;

    let yearPlaces: Array<{ key: string; label: string }>;
    if (isCollege) {
      if (assignment.yearId && yearIdToKey.has(assignment.yearId)) {
        const key = yearIdToKey.get(assignment.yearId)!;
        yearPlaces = [
          {
            key,
            label: yearIdToLabel.get(assignment.yearId) ?? yearLevelLabel(key),
          },
        ];
      } else if (subject) {
        yearPlaces = resolveYearPlacesForSubject(subject);
      } else {
        yearPlaces = [{ key: UNASSIGNED_YEAR_KEY, label: yearLevelLabel(UNASSIGNED_YEAR_KEY) }];
      }
    } else if (assignment.classId) {
      const cls = classes.find((c) => c._id === assignment.classId);
      yearPlaces = [{ key: `class:${assignment.classId}`, label: cls?.name ?? "Class" }];
    } else if (subject) {
      yearPlaces = resolveYearPlacesForSubject(subject);
    } else {
      yearPlaces = [{ key: UNASSIGNED_YEAR_KEY, label: "Unassigned Class" }];
    }

    const subjectName =
      subject?.name ??
      (typeof assignment.subjectId === "object" &&
      assignment.subjectId &&
      "name" in assignment.subjectId
        ? String((assignment.subjectId as { name?: string }).name ?? "Subject")
        : "Subject");
    const subjectCode =
      subject?.code ??
      (typeof assignment.subjectId === "object" &&
      assignment.subjectId &&
      "code" in assignment.subjectId
        ? String((assignment.subjectId as { code?: string }).code ?? "")
        : undefined);

    for (const place of yearPlaces) {
      if (isCollege && filterYearLevelKey && place.key !== filterYearLevelKey) continue;
      if (!isCollege && filterClassKey && place.key !== filterClassKey) continue;

      const acc = ensure(
        fac.key,
        fac.label,
        place.key,
        place.label,
        subjectKey,
        subjectId,
        subjectName,
        subjectCode,
      );
      if (teacherId) {
        acc.teacherIds.add(teacherId);
        acc.teacherNames.add(
          teacherNameOf(
            teacherId,
            teachers,
            typeof assignment.teacherId === "object" &&
              assignment.teacherId &&
              "user" in assignment.teacherId
              ? (assignment.teacherId as { user?: { fullName?: string } }).user?.fullName
              : undefined,
          ),
        );
      }
    }
  }

  // 3) Academic records (plans / logs) — counts + teachers; still batch-independent year keys
  for (const record of records) {
    if (filterTeacherId && record.teacherId !== filterTeacherId) continue;

    const subject = subjectById.get(record.subjectId);
    const subjectKey = subject
      ? curriculumSubjectKey(subject)
      : curriculumSubjectKey({
          _id: record.subjectId,
          name: record.subjectName ?? "",
        });

    if (filterSubjectId) {
      const filtered = subjectById.get(filterSubjectId);
      if (
        filtered &&
        curriculumSubjectKey(filtered) !== subjectKey &&
        filterSubjectId !== record.subjectId
      ) {
        continue;
      }
    }

    const fac = normalizeFaculty(record.faculty);
    if (!passesFaculty(fac.label, fac.key)) continue;

    let yearPlaces: Array<{ key: string; label: string }>;
    if (isCollege) {
      if (record.yearId && yearIdToKey.has(record.yearId)) {
        const key = yearIdToKey.get(record.yearId)!;
        yearPlaces = [
          {
            key,
            label: yearIdToLabel.get(record.yearId) ?? yearLevelLabel(key),
          },
        ];
      } else if (subject) {
        yearPlaces = resolveYearPlacesForSubject(subject);
      } else {
        yearPlaces = [{ key: UNASSIGNED_YEAR_KEY, label: yearLevelLabel(UNASSIGNED_YEAR_KEY) }];
      }
    } else if (record.classId) {
      const cls = classes.find((c) => c._id === record.classId);
      yearPlaces = [{ key: `class:${record.classId}`, label: cls?.name ?? "Class" }];
    } else if (subject) {
      yearPlaces = resolveYearPlacesForSubject(subject);
    } else {
      yearPlaces = [{ key: UNASSIGNED_YEAR_KEY, label: "Unassigned Class" }];
    }

    // Deduplicate places by year key (same level from multiple batch years → once)
    const uniquePlaces = new Map(yearPlaces.map((p) => [p.key, p]));

    for (const place of uniquePlaces.values()) {
      if (isCollege && filterYearLevelKey && place.key !== filterYearLevelKey) continue;
      if (!isCollege && filterClassKey && place.key !== filterClassKey) continue;

      const acc = ensure(
        fac.key,
        fac.label,
        place.key,
        place.label,
        subjectKey,
        record.subjectId,
        subject?.name ?? record.subjectName ?? "Subject",
        subject?.code,
      );
      acc.recordCount += 1;
      if (record.teacherId) {
        acc.teacherIds.add(record.teacherId);
        acc.teacherNames.add(
          teacherNameOf(record.teacherId, teachers, record.teacherName),
        );
      }
    }
  }

  // 4) Materialize Faculty → Year → Subject (merge General subjects into faculty groups when only General exists per year)
  const kw = keyword?.toLowerCase().trim() ?? "";
  const facultyNodes: HierarchyFacultyNode[] = [];

  for (const [facultyKey, byYear] of tree.entries()) {
    const yearNodes: HierarchyYearNode[] = [];

    for (const [yearKey, bySubject] of byYear.entries()) {
      let subjectsList: HierarchySubjectNode[] = [...bySubject.values()].map((acc) => ({
        subjectKey: acc.subjectKey,
        subjectIds: [...acc.subjectIds],
        subjectName: acc.subjectName,
        subjectCode: acc.subjectCode,
        facultyKey: acc.facultyKey,
        facultyLabel: acc.facultyLabel,
        yearKey: acc.yearKey,
        yearLabel: acc.yearLabel,
        recordCount: acc.recordCount,
        teacherIds: [...acc.teacherIds],
        teacherNames: [...acc.teacherNames].sort((a, b) => a.localeCompare(b)),
      }));

      // Collapse duplicate curriculum subjects that landed under same year with different faculty paths later
      const merged = new Map<string, HierarchySubjectNode>();
      for (const s of subjectsList) {
        const existing = merged.get(s.subjectKey);
        if (!existing) {
          merged.set(s.subjectKey, { ...s, subjectIds: [...s.subjectIds] });
          continue;
        }
        existing.subjectIds = [...new Set([...existing.subjectIds, ...s.subjectIds])];
        existing.recordCount += s.recordCount;
        existing.teacherIds = [...new Set([...existing.teacherIds, ...s.teacherIds])];
        existing.teacherNames = [
          ...new Set([...existing.teacherNames, ...s.teacherNames]),
        ].sort((a, b) => a.localeCompare(b));
      }
      subjectsList = [...merged.values()];

      if (kw) {
        subjectsList = subjectsList.filter(
          (s) =>
            s.subjectName.toLowerCase().includes(kw) ||
            (s.subjectCode ?? "").toLowerCase().includes(kw) ||
            s.teacherNames.some((n) => n.toLowerCase().includes(kw)) ||
            s.yearLabel.toLowerCase().includes(kw) ||
            s.facultyLabel.toLowerCase().includes(kw),
        );
      }

      subjectsList.sort((a, b) => a.subjectName.localeCompare(b.subjectName));
      if (subjectsList.length === 0) continue;

      const firstLabel = subjectsList[0]?.yearLabel ?? yearLevelLabel(yearKey);
      yearNodes.push({
        key: yearKey,
        label: firstLabel,
        sortOrder: yearSortOrder(yearKey),
        subjects: subjectsList,
        recordCount: subjectsList.reduce((sum, s) => sum + s.recordCount, 0),
      });
    }

    yearNodes.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
    if (yearNodes.length === 0) continue;

    const facLabel =
      byYear.values().next().value?.values().next().value?.facultyLabel ??
      (facultyKey === GENERAL_FACULTY_KEY ? "General / All Programs" : facultyKey);

    facultyNodes.push({
      key: facultyKey,
      label: facLabel,
      years: yearNodes,
      recordCount: yearNodes.reduce((sum, y) => sum + y.recordCount, 0),
    });
  }

  // Prefer real faculties first, General last
  facultyNodes.sort((a, b) => {
    if (a.key === GENERAL_FACULTY_KEY) return 1;
    if (b.key === GENERAL_FACULTY_KEY) return -1;
    return a.label.localeCompare(b.label);
  });

  // If a curriculum subject already appears under a named faculty+year,
  // drop the duplicate under "General" so the tree is not batch/faculty-duplicated.
  const claimed = new Set<string>();
  for (const fac of facultyNodes) {
    if (fac.key === GENERAL_FACULTY_KEY) continue;
    for (const year of fac.years) {
      for (const sub of year.subjects) {
        claimed.add(`${year.key}::${sub.subjectKey}`);
      }
    }
  }
  for (const fac of facultyNodes) {
    if (fac.key !== GENERAL_FACULTY_KEY) continue;
    for (const year of fac.years) {
      year.subjects = year.subjects.filter(
        (s) => !claimed.has(`${year.key}::${s.subjectKey}`),
      );
      year.recordCount = year.subjects.reduce((sum, s) => sum + s.recordCount, 0);
    }
    fac.years = fac.years.filter((y) => y.subjects.length > 0);
    fac.recordCount = fac.years.reduce((sum, y) => sum + y.recordCount, 0);
  }

  return facultyNodes.filter((f) => f.years.length > 0);
};

/** Flatten hierarchy years for panels that still iterate year nodes. */
export const flattenHierarchyYears = (
  faculties: HierarchyFacultyNode[],
): HierarchyYearNode[] => {
  // Merge years with the same level key across faculties into one list for flat tree mode
  const byYear = new Map<string, HierarchyYearNode>();
  for (const fac of faculties) {
    for (const year of fac.years) {
      const existing = byYear.get(year.key);
      if (!existing) {
        byYear.set(year.key, {
          ...year,
          subjects: year.subjects.map((s) => ({ ...s, subjectIds: [...s.subjectIds] })),
        });
        continue;
      }
      // Merge subjects by subjectKey
      const subjectMap = new Map(existing.subjects.map((s) => [s.subjectKey, s]));
      for (const s of year.subjects) {
        const prev = subjectMap.get(s.subjectKey);
        if (!prev) {
          subjectMap.set(s.subjectKey, { ...s, subjectIds: [...s.subjectIds] });
          continue;
        }
        prev.subjectIds = [...new Set([...prev.subjectIds, ...s.subjectIds])];
        prev.recordCount += s.recordCount;
        prev.teacherIds = [...new Set([...prev.teacherIds, ...s.teacherIds])];
        prev.teacherNames = [
          ...new Set([...prev.teacherNames, ...s.teacherNames]),
        ].sort((a, b) => a.localeCompare(b));
      }
      existing.subjects = [...subjectMap.values()].sort((a, b) =>
        a.subjectName.localeCompare(b.subjectName),
      );
      existing.recordCount = existing.subjects.reduce((sum, s) => sum + s.recordCount, 0);
    }
  }
  return [...byYear.values()].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
  );
};

/**
 * Match records for a curriculum subject (any batch-provisioned subject id)
 * under a year *level* (not a batch-specific year document id).
 */
export const recordsForCurriculumSubject = <
  T extends { subjectId: string; yearId?: string; classId?: string },
>(
  records: T[],
  subjectIds: string[],
  yearKey?: string | null,
  yearIdToLevelKey?: Map<string, string>,
  isCollege?: boolean,
): T[] => {
  const idSet = new Set(subjectIds);
  return records.filter((record) => {
    if (!idSet.has(record.subjectId)) return false;
    if (!yearKey || yearKey === UNASSIGNED_YEAR_KEY) return true;
    if (isCollege) {
      if (!record.yearId) return true; // unscoped plan still belongs to curriculum subject
      const recordLevel = yearIdToLevelKey?.get(record.yearId);
      // If we can't map the year, still include so batch-scoped plans aren't lost
      if (!recordLevel) return true;
      return recordLevel === yearKey;
    }
    if (!record.classId) return true;
    return `class:${record.classId}` === yearKey;
  });
};

/** @deprecated Use recordsForCurriculumSubject — kept for gradual migration. */
export const recordsForSubject = <
  T extends { subjectId: string; yearId?: string; classId?: string },
>(
  records: T[],
  subjectId: string,
  yearKey?: string,
  isCollege?: boolean,
): T[] => recordsForCurriculumSubject(records, [subjectId], yearKey, undefined, isCollege);

export const buildYearIdToLevelKeyMap = (
  years: HierarchyScopeOption[],
): Map<string, string> => {
  const map = new Map<string, string>();
  for (const y of years) {
    map.set(y._id, yearLevelKey(y.level, y.name));
  }
  return map;
};

export const groupByTeacher = <
  T extends {
    teacherId?: string;
    teacher?: { user?: { fullName?: string } };
  },
>(
  records: T[],
): Array<{ teacherId: string; teacherName: string; items: T[] }> => {
  const map = new Map<string, { teacherId: string; teacherName: string; items: T[] }>();
  for (const record of records) {
    const teacherId = record.teacherId || "shared";
    const teacherName =
      record.teacher?.user?.fullName ??
      (record.teacherId ? "Teacher" : "Shared (by subject)");
    const group = map.get(teacherId) ?? {
      teacherId,
      teacherName,
      items: [],
    };
    group.items.push(record);
    map.set(teacherId, group);
  }
  return [...map.values()].sort((a, b) =>
    a.teacherName.localeCompare(b.teacherName),
  );
};

export const matchSessionPlanKeyword = (
  plan: AcademicSessionPlanRecord | {
    subject?: { name?: string };
    teacher?: { user?: { fullName?: string } };
    status?: string;
    academicYearBs?: string;
    faculty?: string;
    units: Array<{
      unitNo: number;
      chapterName: string;
      topicsCovered?: string;
      references?: string;
    }>;
  },
  keyword: string,
): boolean => {
  const kw = keyword.toLowerCase().trim();
  if (!kw) return true;
  return [
    plan.subject?.name,
    plan.teacher?.user?.fullName,
    plan.status,
    plan.academicYearBs,
    plan.faculty,
    ...plan.units.flatMap((u) => [
      String(u.unitNo),
      u.chapterName,
      u.topicsCovered,
      u.references,
    ]),
  ]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(kw));
};

export const matchLessonPlanKeyword = (
  plan: AcademicLessonPlanRecord,
  keyword: string,
): boolean => {
  const kw = keyword.toLowerCase().trim();
  if (!kw) return true;
  return [
    plan.subject?.name,
    plan.teacher?.user?.fullName,
    plan.status,
    plan.month,
    plan.monthlyDescription,
    plan.faculty,
    ...plan.items.flatMap((i) => [
      i.plannedTopic,
      i.description,
      i.learningObjectives,
      i.unit?.chapterName,
    ]),
  ]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(kw));
};

export const matchLogBookKeyword = (
  entry: AcademicLogBookEntryRecord,
  keyword: string,
): boolean => {
  const kw = keyword.toLowerCase().trim();
  if (!kw) return true;
  return [
    entry.subject?.name,
    entry.teacher?.user?.fullName,
    entry.unit,
    entry.topicCovered,
    entry.objectives,
    entry.teachingMethod,
    entry.reviewStatus,
    entry.dateBs,
    entry.faculty,
  ]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(kw));
};
