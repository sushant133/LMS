import type { Request } from "express";
import mongoose from "mongoose";
import {
  isInstitutionAdmin,
  type AcademicManagementFilters,
  type AcademicSyllabusOversightCompleteInput,
  type AcademicSyllabusRecord,
  type AcademicSyllabusSubUnitRecord,
  type SyllabusCompletionAttribution,
  type SyllabusOversightAssignedTeacher,
  type SyllabusOversightDetail,
  type SyllabusOversightLeafRow,
  type SyllabusOversightListRow
} from "@phit-erp/shared";
import { AcademicLessonPlan } from "../models/AcademicLessonPlan.js";
import { AcademicLogBook } from "../models/AcademicLogBook.js";
import { AcademicLogBookEntry } from "../models/AcademicLogBookEntry.js";
import { AcademicSessionPlan } from "../models/AcademicSessionPlan.js";
import { AcademicSyllabus } from "../models/AcademicSyllabus.js";
import { AcademicSyllabusSubUnit } from "../models/AcademicSyllabusSubUnit.js";
import { AcademicSyllabusTopic } from "../models/AcademicSyllabusTopic.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { SubjectAssignment } from "../models/SubjectAssignment.js";
import { Teacher } from "../models/Teacher.js";
import { User } from "../models/User.js";
import { Year } from "../models/Year.js";
import { ApiError } from "./apiError.js";
import { recordAudit } from "./audit.js";
import { ensureValidBsDate } from "./nepaliDate.js";
import { tenantObjectId } from "./tenant.js";
import { leafCountsTowardTeacherSalary, markSubUnitsCompleted } from "./syllabusCompletionAttribution.js";
import {
  applyCurriculumSubjectFilter,
  buildAcademicFilter,
  getNepaliMonthNameFromBsDate,
  getOrCreateLogBook,
  nextContinuedLogBookSerial,
  nextLogBookPeriodNumber,
  resyncSessionPlansTouchedByLog,
  serializeSessionPlan,
  serializeSyllabus
} from "./academicManagementService.js";

const roundPct = (n: number): number => Math.round(Math.min(100, Math.max(0, n)));

const asSyllabusRecord = (
  row: Awaited<ReturnType<typeof serializeSyllabus>>
): AcademicSyllabusRecord | null => {
  if (!row) return null;
  return {
    ...row,
    faculty: row.faculty ?? undefined,
    semesterBs: row.semesterBs ?? undefined
  } as AcademicSyllabusRecord;
};

const idStr = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object" && value !== null && "_id" in value) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
};

export const assertSyllabusOversightAccess = (req: Request): void => {
  const role = req.user?.role ?? "";
  if (!isInstitutionAdmin(role)) {
    throw new ApiError(
      403,
      "Only Administrator and Super Admin can use syllabus completion oversight"
    );
  }
};

type FlatLeaf = {
  subUnitId: string;
  syllabusId: string;
  unitId: string;
  unitNo: number;
  unitTitle: string;
  chapterTitle: string;
  displayNo: string;
  heading: string;
  teachingHours: number;
  status: string;
  parentSubUnitId: string;
  attribution?: SyllabusCompletionAttribution;
};

const walkLeaves = (
  nodes: AcademicSyllabusSubUnitRecord[],
  ctx: { unitId: string; unitNo: number; unitTitle: string; chapterTitle: string },
  out: FlatLeaf[]
): void => {
  for (const node of nodes) {
    if (node.children?.length) {
      walkLeaves(node.children, ctx, out);
      continue;
    }
    out.push({
      subUnitId: node._id,
      syllabusId: node.syllabusId,
      unitId: ctx.unitId,
      unitNo: ctx.unitNo,
      unitTitle: ctx.unitTitle,
      chapterTitle: ctx.chapterTitle,
      displayNo: node.displayNo,
      heading: node.heading,
      teachingHours: node.teachingHours ?? 0,
      status: node.status,
      parentSubUnitId: node.parentSubUnitId || "",
      attribution: node.attribution
    });
  }
};

const flattenSyllabusLeaves = (syllabus: AcademicSyllabusRecord): FlatLeaf[] => {
  const out: FlatLeaf[] = [];
  for (const chapter of syllabus.chapters ?? []) {
    for (const unit of chapter.units ?? []) {
      walkLeaves(unit.subUnits ?? [], {
        unitId: unit._id,
        unitNo: unit.unitNo,
        unitTitle: unit.title,
        chapterTitle: chapter.title || ""
      }, out);
    }
  }
  return out;
};

const leafDone = (status: string): boolean =>
  status === "COMPLETED" || status === "SKIPPED";

const summarizeLeaves = (leaves: FlatLeaf[]) => {
  const total = leaves.length;
  let completed = 0;
  let teacher = 0;
  let administration = 0;
  for (const leaf of leaves) {
    if (!leafDone(leaf.status)) continue;
    completed += 1;
    const admin =
      leaf.attribution?.source === "ADMINISTRATION" ||
      leaf.attribution?.countsTowardSalary === false;
    if (admin) administration += 1;
    else teacher += 1;
  }
  const completedPercent = total > 0 ? roundPct((completed / total) * 100) : 0;
  return {
    totalLeaves: total,
    completedLeaves: completed,
    teacherLeaves: teacher,
    administrationLeaves: administration,
    remainingLeaves: Math.max(0, total - completed),
    completedPercent,
    teacherPercent: total > 0 ? roundPct((teacher / total) * 100) : 0,
    administrationPercent: total > 0 ? roundPct((administration / total) * 100) : 0,
    remainingPercent: Math.max(0, 100 - completedPercent)
  };
};

const teacherNameFromDoc = (teacher: {
  _id?: unknown;
  user?: { fullName?: string } | unknown;
}): string => {
  const user = teacher.user as { fullName?: string } | undefined;
  return user?.fullName?.trim() || "Teacher";
};

const loadTeacherNames = async (teacherIds: string[]): Promise<Map<string, string>> => {
  const ids = teacherIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const rows = await Teacher.find({ _id: { $in: ids } })
    .populate("user", "fullName")
    .select("user")
    .lean();
  for (const row of rows) {
    map.set(String(row._id), teacherNameFromDoc(row));
  }
  return map;
};

type AssignmentLean = {
  _id: unknown;
  teacherId?: unknown;
  subjectId?: unknown;
  assignmentType?: string;
  unitFrom?: number | null;
  unitTo?: number | null;
  assignedPercentage?: number | null;
  handoverBaselinePercent?: number | null;
  yearId?: unknown;
  classId?: unknown;
};

const leavesForAssignment = (leaves: FlatLeaf[], asg: AssignmentLean): FlatLeaf[] => {
  const type = String(asg.assignmentType || "FULL").toUpperCase();
  if (type !== "UNIT") return leaves;
  const from = Number(asg.unitFrom) || 1;
  const to = Number(asg.unitTo) || from;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return leaves.filter((leaf) => leaf.unitNo >= lo && leaf.unitNo <= hi);
};

const salaryStatsForTeacher = (
  leaves: FlatLeaf[],
  asg: AssignmentLean,
  teacherId: string
): Pick<
  SyllabusOversightAssignedTeacher,
  "salaryPercent" | "completedLeaves" | "allottedLeaves" | "administrationLeaves"
> => {
  const allotted = leavesForAssignment(leaves, asg);
  let completed = 0;
  let administration = 0;
  for (const leaf of allotted) {
    const done = leafDone(leaf.status);
    if (
      done &&
      (leaf.attribution?.source === "ADMINISTRATION" ||
        leaf.attribution?.countsTowardSalary === false)
    ) {
      administration += 1;
    }
    if (
      leafCountsTowardTeacherSalary(
        {
          completed: done,
          completionSource: leaf.attribution?.source,
          countsTowardSalary: leaf.attribution?.countsTowardSalary,
          completedByTeacherId: leaf.attribution?.completedByTeacherId
        },
        teacherId
      )
    ) {
      completed += 1;
    }
  }
  return {
    allottedLeaves: allotted.length,
    completedLeaves: completed,
    administrationLeaves: administration,
    salaryPercent: allotted.length > 0 ? roundPct((completed / allotted.length) * 100) : 0
  };
};

const loadAssignmentsForSubjects = async (
  schoolId: mongoose.Types.ObjectId,
  subjectIds: string[],
  academicYearBs: string
): Promise<AssignmentLean[]> => {
  if (subjectIds.length === 0) return [];
  const filter: Record<string, unknown> = {
    schoolId,
    subjectId: { $in: subjectIds },
    status: "ACTIVE"
  };
  if (academicYearBs.trim()) filter.academicYearBs = academicYearBs.trim();
  let rows = (await SubjectAssignment.find(filter)
    .select(
      "teacherId subjectId assignmentType unitFrom unitTo assignedPercentage handoverBaselinePercent yearId classId academicYearBs"
    )
    .lean()) as AssignmentLean[];
  if (rows.length === 0 && academicYearBs.trim()) {
    rows = (await SubjectAssignment.find({
      schoolId,
      subjectId: { $in: subjectIds },
      status: "ACTIVE"
    })
      .select(
        "teacherId subjectId assignmentType unitFrom unitTo assignedPercentage handoverBaselinePercent yearId classId academicYearBs"
      )
      .lean()) as AssignmentLean[];
  }
  return rows;
};

const collectDescendantLeafIds = async (
  syllabusId: string,
  selectedSubUnitIds: string[],
  selectedUnitIds: string[]
): Promise<string[]> => {
  const all = await AcademicSyllabusSubUnit.find({ syllabusId })
    .select("_id unitId parentSubUnitId")
    .lean();
  const byParent = new Map<string, string[]>();
  for (const row of all) {
    const pid = row.parentSubUnitId ? String(row.parentSubUnitId) : "";
    const list = byParent.get(pid) ?? [];
    list.push(String(row._id));
    byParent.set(pid, list);
  }
  const parentIds = new Set(
    all.map((row) => (row.parentSubUnitId ? String(row.parentSubUnitId) : "")).filter(Boolean)
  );
  const selected = new Set(
    [...selectedSubUnitIds, ...selectedUnitIds].map((id) => String(id).trim()).filter(Boolean)
  );

  const wanted = new Set<string>();
  const addLeavesUnder = (id: string) => {
    const children = byParent.get(id) ?? [];
    if (children.length === 0) {
      if (!parentIds.has(id)) wanted.add(id);
      return;
    }
    for (const child of children) addLeavesUnder(child);
  };

  for (const row of all) {
    const id = String(row._id);
    const unitId = String(row.unitId);
    if (selected.has(id) || selected.has(unitId)) addLeavesUnder(id);
  }
  // Unit-only selection: every leaf under that topic
  if (selectedUnitIds.length > 0) {
    const unitSet = new Set(selectedUnitIds.map((id) => String(id).trim()));
    for (const row of all) {
      if (unitSet.has(String(row.unitId))) addLeavesUnder(String(row._id));
    }
  }
  return [...wanted];
};

const teacherExists = async (
  schoolId: mongoose.Types.ObjectId,
  teacherId: string
): Promise<boolean> => {
  const id = teacherId.trim();
  if (!id || !mongoose.isValidObjectId(id)) return false;
  const row = await Teacher.findOne({ _id: id, schoolId }).select("_id").lean();
  return Boolean(row);
};

// A log book always needs a teacher to hang off, even when the work was done by
// administration. When the subject has no active assignment for the year we
// fall back to whoever already owns the subject instead of refusing the
// completion — administration entries never count toward salary anyway.
const fallbackLogBookTeacherId = async (params: {
  schoolId: mongoose.Types.ObjectId;
  subjectId: string;
  syllabusTeacherId?: string;
}): Promise<string> => {
  const syllabusTeacher = (params.syllabusTeacherId || "").trim();
  if (await teacherExists(params.schoolId, syllabusTeacher)) return syllabusTeacher;

  const existingBook = await AcademicLogBook.findOne({
    schoolId: params.schoolId,
    subjectId: params.subjectId
  })
    .sort({ updatedAt: -1 })
    .select("teacherId")
    .lean();
  const bookTeacher = existingBook ? idStr(existingBook.teacherId) : "";
  if (await teacherExists(params.schoolId, bookTeacher)) return bookTeacher;

  const anyAssignment = await SubjectAssignment.findOne({
    schoolId: params.schoolId,
    subjectId: params.subjectId
  })
    .sort({ updatedAt: -1 })
    .select("teacherId")
    .lean();
  const assignmentTeacher = anyAssignment ? idStr(anyAssignment.teacherId) : "";
  if (await teacherExists(params.schoolId, assignmentTeacher)) return assignmentTeacher;

  return "";
};

const pickLogBookTeacherId = async (params: {
  schoolId: mongoose.Types.ObjectId;
  subjectId: string;
  academicYearBs: string;
  requestedTeacherId?: string;
  syllabusTeacherId?: string;
  unitNos: number[];
}): Promise<string> => {
  const requested = (params.requestedTeacherId || "").trim();
  if (requested) {
    const exists = await Teacher.findOne({ _id: requested, schoolId: params.schoolId })
      .select("_id")
      .lean();
    if (!exists) throw new ApiError(400, "Selected teacher was not found");
    return requested;
  }
  const assignments = await loadAssignmentsForSubjects(
    params.schoolId,
    [params.subjectId],
    params.academicYearBs
  );
  if (assignments.length === 0) {
    const fallback = await fallbackLogBookTeacherId({
      schoolId: params.schoolId,
      subjectId: params.subjectId,
      syllabusTeacherId: params.syllabusTeacherId
    });
    if (fallback) return fallback;
    throw new ApiError(
      400,
      "This subject has no teacher on record yet. Select a teacher to file the log book against. Administration extra lectures still will not count toward salary."
    );
  }
  if (assignments.length === 1) return idStr(assignments[0]!.teacherId);
  const unitNos = params.unitNos;
  const covering = assignments.filter((asg) => {
    const type = String(asg.assignmentType || "FULL").toUpperCase();
    if (type !== "UNIT") return true;
    const from = Number(asg.unitFrom) || 1;
    const to = Number(asg.unitTo) || from;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    return unitNos.some((n) => n >= lo && n <= hi);
  });
  const pick = covering[0] ?? assignments[0]!;
  return idStr(pick.teacherId);
};

export const listSyllabusOversight = async (
  req: Request,
  filters: AcademicManagementFilters
): Promise<SyllabusOversightListRow[]> => {
  assertSyllabusOversightAccess(req);
  const schoolId = tenantObjectId(req);
  const filter = buildAcademicFilter(req, filters);
  await applyCurriculumSubjectFilter(req, filter, filters.subjectId);
  delete filter.teacherId;
  delete filter.session;
  delete filter.batchId;

  const syllabi = await AcademicSyllabus.find(filter).sort({ updatedAt: -1 }).lean();
  if (syllabi.length === 0) return [];

  const serialized = (
    await Promise.all(
      syllabi.map(async (row) => {
        try {
          return asSyllabusRecord(await serializeSyllabus(row._id.toString()));
        } catch (error) {
          console.error("[syllabus-oversight] serialize failed", String(row._id), error);
          return null;
        }
      })
    )
  ).filter((row): row is AcademicSyllabusRecord => Boolean(row));

  const subjectIds = [...new Set(serialized.map((row) => row.subjectId).filter(Boolean))];
  const yearIds = [...new Set(serialized.map((row) => row.yearId).filter(Boolean))] as string[];
  const classIds = [...new Set(serialized.map((row) => row.classId).filter(Boolean))] as string[];
  const ay = filters.academicYearBs || serialized[0]?.academicYearBs || "";

  const [assignments, years, classes] = await Promise.all([
    loadAssignmentsForSubjects(schoolId, subjectIds, ay),
    yearIds.length
      ? Year.find({ _id: { $in: yearIds } }).select("name level").lean()
      : Promise.resolve([]),
    classIds.length
      ? SchoolClass.find({ _id: { $in: classIds } }).select("name").lean()
      : Promise.resolve([])
  ]);
  const yearLabel = new Map(years.map((y) => [String(y._id), y.name]));
  const classLabel = new Map(classes.map((c) => [String(c._id), c.name]));
  const teacherIds = [...new Set(assignments.map((a) => idStr(a.teacherId)).filter(Boolean))];
  const teacherNames = await loadTeacherNames(teacherIds);

  const assignmentsBySubject = new Map<string, AssignmentLean[]>();
  for (const asg of assignments) {
    const sid = idStr(asg.subjectId);
    const list = assignmentsBySubject.get(sid) ?? [];
    list.push(asg);
    assignmentsBySubject.set(sid, list);
  }

  return serialized.map((plan) => {
    const leaves = flattenSyllabusLeaves(plan);
    const summary = summarizeLeaves(leaves);
    const assigned = (assignmentsBySubject.get(plan.subjectId) ?? []).map((asg) => ({
      teacherId: idStr(asg.teacherId),
      teacherName: teacherNames.get(idStr(asg.teacherId)) || "Teacher",
      assignmentType: String(asg.assignmentType || "FULL"),
      unitFrom: asg.unitFrom ?? null,
      unitTo: asg.unitTo ?? null
    }));
    return {
      _id: plan._id,
      academicYearBs: plan.academicYearBs,
      subjectId: plan.subjectId,
      subjectName: plan.subject?.name || "Subject",
      subjectCode: plan.subject?.code || plan.subjectCode || "",
      yearId: plan.yearId,
      yearLabel: plan.yearId ? yearLabel.get(plan.yearId) : undefined,
      classId: plan.classId,
      className: plan.classId ? classLabel.get(plan.classId) : undefined,
      faculty: plan.faculty || undefined,
      status: plan.status,
      ...summary,
      assignedTeachers: assigned
    };
  });
};

const buildAssignedTeachers = (
  leaves: FlatLeaf[],
  assignments: AssignmentLean[],
  teacherNames: Map<string, string>
): SyllabusOversightAssignedTeacher[] => {
  const byTeacher = new Map<string, AssignmentLean>();
  for (const asg of assignments) {
    const tid = idStr(asg.teacherId);
    if (!tid) continue;
    const prev = byTeacher.get(tid);
    if (!prev) {
      byTeacher.set(tid, asg);
      continue;
    }
    // Prefer UNIT rows when mixed (more specific allotment).
    if (
      String(asg.assignmentType || "").toUpperCase() === "UNIT" &&
      String(prev.assignmentType || "").toUpperCase() !== "UNIT"
    ) {
      byTeacher.set(tid, asg);
    }
  }
  return [...byTeacher.entries()].map(([teacherId, asg]) => {
    const stats = salaryStatsForTeacher(leaves, asg, teacherId);
    return {
      teacherId,
      teacherName: teacherNames.get(teacherId) || "Teacher",
      assignmentType: String(asg.assignmentType || "FULL"),
      unitFrom: asg.unitFrom ?? null,
      unitTo: asg.unitTo ?? null,
      assignedPercentage: asg.assignedPercentage ?? null,
      handoverBaselinePercent: asg.handoverBaselinePercent ?? null,
      ...stats
    };
  });
};

export const getSyllabusOversightDetail = async (
  req: Request,
  syllabusId: string
): Promise<SyllabusOversightDetail> => {
  assertSyllabusOversightAccess(req);
  const schoolId = tenantObjectId(req);
  const syllabus = asSyllabusRecord(await serializeSyllabus(syllabusId));
  if (!syllabus) throw new ApiError(404, "Syllabus not found");
  const owned = await AcademicSyllabus.findOne({
    _id: syllabusId,
    schoolId,
    isDeleted: false
  })
    .select("_id")
    .lean();
  if (!owned) throw new ApiError(404, "Syllabus not found");

  const leavesFlat = flattenSyllabusLeaves(syllabus);
  const summary = summarizeLeaves(leavesFlat);
  const assignments = await loadAssignmentsForSubjects(
    schoolId,
    [syllabus.subjectId],
    syllabus.academicYearBs
  );
  const teacherIds = [
    ...new Set([
      ...assignments.map((a) => idStr(a.teacherId)),
      ...leavesFlat.map((l) => l.attribution?.completedByTeacherId || "")
    ])
  ].filter(Boolean);
  const teacherNames = await loadTeacherNames(teacherIds);
  const assignedTeachers = buildAssignedTeachers(leavesFlat, assignments, teacherNames);

  const leaves: SyllabusOversightLeafRow[] = leavesFlat.map((leaf) => {
    const attr = leaf.attribution
      ? {
          ...leaf.attribution,
          completedByTeacherName:
            leaf.attribution.completedByTeacherName ||
            (leaf.attribution.completedByTeacherId
              ? teacherNames.get(leaf.attribution.completedByTeacherId)
              : undefined)
        }
      : undefined;
    return {
      subUnitId: leaf.subUnitId,
      displayNo: leaf.displayNo,
      heading: leaf.heading,
      unitId: leaf.unitId,
      unitNo: leaf.unitNo,
      unitTitle: leaf.unitTitle,
      chapterTitle: leaf.chapterTitle,
      status: leaf.status as SyllabusOversightLeafRow["status"],
      teachingHours: leaf.teachingHours,
      attribution: attr
    };
  });

  const [sessionPlans, lessonPlanCount, logEntries] = await Promise.all([
    AcademicSessionPlan.find({
      schoolId,
      subjectId: syllabus.subjectId,
      academicYearBs: syllabus.academicYearBs,
      isDeleted: false
    })
      .select("_id teacherId status")
      .lean(),
    AcademicLessonPlan.countDocuments({
      schoolId,
      subjectId: syllabus.subjectId,
      academicYearBs: syllabus.academicYearBs,
      isDeleted: false
    }),
    AcademicLogBookEntry.find({
      schoolId,
      subjectId: syllabus.subjectId,
      academicYearBs: syllabus.academicYearBs,
      isDeleted: false
    })
      .select("completionSource countsTowardSalary dateBs")
      .sort({ dateBs: -1 })
      .lean()
  ]);

  const sessionPlanRows = (
    await Promise.all(sessionPlans.map((plan) => serializeSessionPlan(plan._id.toString())))
  ).filter(Boolean);

  let logBookTeacherEntries = 0;
  let logBookAdministrationEntries = 0;
  for (const entry of logEntries) {
    const admin =
      String((entry as { completionSource?: string }).completionSource || "") ===
        "ADMINISTRATION" || (entry as { countsTowardSalary?: boolean }).countsTowardSalary === false;
    if (admin) logBookAdministrationEntries += 1;
    else logBookTeacherEntries += 1;
  }

  return {
    syllabus,
    assignedTeachers,
    leaves,
    related: {
      sessionPlans: sessionPlanRows.map((plan) => ({
        _id: plan!._id,
        teacherId: plan!.teacherId,
        teacherName: plan!.teacher?.user?.fullName || "Teacher",
        status: plan!.status,
        completedPercent: plan!.completedPercent,
        remainingPercent: plan!.remainingPercent
      })),
      lessonPlanCount,
      logBookTeacherEntries,
      logBookAdministrationEntries,
      lastLogBookDateBs: logEntries[0] ? String(logEntries[0].dateBs || "") : undefined
    },
    summary
  };
};

export const completeSyllabusOversight = async (
  req: Request,
  syllabusId: string,
  payload: AcademicSyllabusOversightCompleteInput
): Promise<SyllabusOversightDetail> => {
  assertSyllabusOversightAccess(req);
  const schoolId = tenantObjectId(req);
  const existing = await AcademicSyllabus.findOne({
    _id: syllabusId,
    schoolId,
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Syllabus not found");

  const dateBs = ensureValidBsDate(payload.dateBs);
  const leafIds = await collectDescendantLeafIds(
    syllabusId,
    payload.subUnitIds ?? [],
    payload.unitIds ?? []
  );
  if (leafIds.length === 0) {
    throw new ApiError(400, "No syllabus sub-units matched the selection");
  }

  const leafDocs = await AcademicSyllabusSubUnit.find({
    _id: { $in: leafIds },
    syllabusId,
    schoolId
  })
    .select("_id heading unitId teachingHours")
    .lean();
  if (leafDocs.length === 0) {
    throw new ApiError(400, "Selected sub-units do not belong to this syllabus");
  }

  const topicIds = [...new Set(leafDocs.map((row) => String(row.unitId)))];
  const topics = await AcademicSyllabusTopic.find({ _id: { $in: topicIds } })
    .select("_id unitNo title")
    .lean();
  const topicById = new Map(topics.map((t) => [String(t._id), t]));

  const teacherId = await pickLogBookTeacherId({
    schoolId,
    subjectId: existing.subjectId.toString(),
    academicYearBs: existing.academicYearBs,
    requestedTeacherId: payload.teacherId,
    syllabusTeacherId: existing.teacherId ? existing.teacherId.toString() : undefined,
    unitNos: topics.map((t) => Number(t.unitNo) || 0)
  });

  const actor = await User.findById(req.user!.userId).select("fullName").lean();
  const actorName = actor?.fullName?.trim() || "Administrator";
  const countsTowardSalary = payload.source === "TEACHER";
  const deliveredByName = (payload.deliveredByName || "").trim();
  const note = (payload.note || "").trim();
  const coverageLabel =
    payload.source === "ADMINISTRATION"
      ? deliveredByName
        ? `Completed by administration (extra lectures: ${deliveredByName})`
        : "Completed by administration (extra lectures)"
      : `Completed by assigned teacher`;

  const groups = new Map<string, typeof leafDocs>();
  for (const leaf of leafDocs) {
    const key = String(leaf.unitId);
    const list = groups.get(key) ?? [];
    list.push(leaf);
    groups.set(key, list);
  }

  const month = getNepaliMonthNameFromBsDate(dateBs);
  const logBookId = await getOrCreateLogBook(req, {
    academicYearBs: existing.academicYearBs,
    session: existing.session || existing.academicYearBs,
    faculty: existing.faculty || undefined,
    semesterBs: existing.semesterBs || undefined,
    classId: existing.classId?.toString(),
    sectionId: existing.sectionId?.toString(),
    batchId: existing.batchId?.toString(),
    yearId: existing.yearId?.toString(),
    subjectId: existing.subjectId.toString(),
    teacherId,
    month
  });

  const createdEntryIds: string[] = [];
  for (const [unitId, group] of groups) {
    const topic = topicById.get(unitId);
    const unitLabel = topic
      ? `Unit ${topic.unitNo}: ${topic.title || ""}`.trim()
      : "Unit";
    const titles = group.map((row) => String(row.heading || "").trim()).filter(Boolean);
    const ids = group.map((row) => String(row._id));
    const periodNumber = await nextLogBookPeriodNumber(
      req,
      teacherId,
      existing.subjectId.toString(),
      dateBs
    );
    const serialNo = await nextContinuedLogBookSerial(req, {
      teacherId,
      subjectId: existing.subjectId.toString(),
      academicYearBs: existing.academicYearBs,
      classId: existing.classId?.toString(),
      sectionId: existing.sectionId?.toString(),
      batchId: existing.batchId?.toString(),
      yearId: existing.yearId?.toString(),
      logBookId
    });

    const topicCovered = titles.length > 0 ? `${unitLabel} — ${titles.join("; ")}` : unitLabel;
    const entry = await AcademicLogBookEntry.create({
      schoolId,
      logBookId,
      syllabusId: existing._id,
      syllabusUnitId: topic?._id,
      syllabusSubUnitId: ids[0],
      syllabusSubUnitIds: ids,
      subUnitTitles: titles,
      subUnitTitle: titles.join("; "),
      academicYearBs: existing.academicYearBs,
      session: existing.session || existing.academicYearBs,
      faculty: existing.faculty || undefined,
      semesterBs: existing.semesterBs || undefined,
      classId: existing.classId,
      sectionId: existing.sectionId,
      batchId: existing.batchId,
      yearId: existing.yearId,
      subjectId: existing.subjectId,
      teacherId,
      serialNo,
      dateBs,
      unit: unitLabel,
      topicCovered,
      objectives: note || coverageLabel,
      teachingMethod: payload.source === "ADMINISTRATION" ? "Extra lectures" : "Class teaching",
      theoryPractical: payload.theoryPractical || "THEORY",
      periodNumber,
      reviewStatus: "APPROVED",
      adminSignature: actorName,
      adminRemarks: note || coverageLabel,
      completionSource: payload.source,
      countsTowardSalary,
      deliveredByName,
      audit: { createdBy: new mongoose.Types.ObjectId(req.user!.userId) }
    });
    createdEntryIds.push(entry._id.toString());
  }

  await markSubUnitsCompleted({
    schoolId,
    subUnitIds: leafDocs.map((row) => String(row._id)),
    source: payload.source,
    teacherId: countsTowardSalary ? teacherId : undefined,
    userId: req.user!.userId,
    note,
    deliveredByName,
    taughtDateBs: dateBs,
    todaysCoverage: coverageLabel,
    overwriteAttribution: true
  });

  await resyncSessionPlansTouchedByLog({
    schoolId: schoolId.toString(),
    teacherId,
    subjectId: existing.subjectId.toString()
  });

  await recordAudit(req, {
    action: "academic.syllabus.oversight.complete",
    entity: "SYLLABUS",
    entityId: existing._id.toString(),
    after: {
      source: payload.source,
      teacherId,
      countsTowardSalary,
      leafCount: leafDocs.length,
      logBookEntryIds: createdEntryIds,
      dateBs
    }
  });

  return getSyllabusOversightDetail(req, syllabusId);
};
