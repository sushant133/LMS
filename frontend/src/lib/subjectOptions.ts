/**
 * College subjects are stored once per batch year (Anatomy for HA 2081, HA 2082, …), but it
 * is one subject of the course and year. Dropdowns list it once per year.
 *
 * The option's value is one of the copies (the newest batch's when batches are known); filters
 * on the server match every batch's copy of that subject, and syllabus / tender progress
 * counts them all, so which copy is used does not change results.
 */

interface SubjectLike {
  _id: string;
  name: string;
  code?: string;
  masterSubjectId?: string | null;
  yearIds?: string[];
  isActive?: boolean;
}

interface YearLike {
  _id: string;
  name: string;
  batchId?: unknown;
}

interface BatchLike {
  _id: string;
  name: string;
  academicYearBs?: string;
}

export interface SubjectGroupOption<S extends SubjectLike = SubjectLike> {
  /** Value to use in the <option> (one copy's id). */
  value: string;
  /** e.g. "Anatomy (ANAT) — 1st Year" */
  label: string;
  subject: S;
  memberIds: string[];
}

const idOf = (value: unknown): string =>
  value && typeof value === "object" && "_id" in value
    ? String((value as { _id: unknown })._id)
    : String(value ?? "");

export const groupSubjectsByCourseYear = <S extends SubjectLike>(
  subjects: S[],
  options: {
    years?: YearLike[];
    batches?: BatchLike[];
    /** Add " — 1st Year" to the label (default true when years are given). */
    showYear?: boolean;
    includeInactive?: boolean;
  } = {},
): {
  options: Array<SubjectGroupOption<S>>;
  /** The option value that stands for this subject id (any batch's copy). */
  optionFor: (subjectId: string) => string;
} => {
  const yearById = new Map((options.years ?? []).map((y) => [String(y._id), y]));
  const batchById = new Map((options.batches ?? []).map((b) => [String(b._id), b]));
  const showYear = options.showYear ?? (options.years ?? []).length > 0;
  const groups = new Map<string, SubjectGroupOption<S> & { batchKey: string }>();

  for (const subject of subjects) {
    if (!options.includeInactive && subject.isActive === false) continue;
    const year = yearById.get(String(subject.yearIds?.[0] ?? ""));
    const batch = year ? batchById.get(idOf(year.batchId)) : undefined;
    const yearName = year?.name ?? "";
    const key = [
      subject.masterSubjectId || `${(subject.code ?? "").trim().toLowerCase()}|${subject.name.trim().toLowerCase()}`,
      yearName.toLowerCase(),
    ].join("|");
    const batchKey = `${batch?.academicYearBs ?? ""}|${batch?.name ?? ""}`;
    const label = `${subject.name}${subject.code ? ` (${subject.code})` : ""}${
      showYear && yearName ? ` — ${yearName}` : ""
    }`;
    const id = String(subject._id);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { value: id, label, subject, memberIds: [id], batchKey });
      continue;
    }
    group.memberIds.push(id);
    // Newest batch's copy stands for the subject
    if (batchKey.localeCompare(group.batchKey, undefined, { numeric: true }) > 0) {
      group.value = id;
      group.subject = subject;
      group.batchKey = batchKey;
    }
  }

  const optionByMember = new Map<string, string>();
  groups.forEach((g) => g.memberIds.forEach((id) => optionByMember.set(id, g.value)));
  return {
    options: [...groups.values()]
      .map(({ batchKey: _batchKey, ...option }) => option)
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
    optionFor: (subjectId: string) => optionByMember.get(String(subjectId)) ?? subjectId,
  };
};
