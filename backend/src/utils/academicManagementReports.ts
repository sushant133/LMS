import type { Request, Response } from "express";
import type { AcademicManagementFilters } from "@phit-erp/shared";
import { AcademicLessonPlan } from "../models/AcademicLessonPlan.js";
import { AcademicLessonPlanItem } from "../models/AcademicLessonPlanItem.js";
import { AcademicLogBookEntry } from "../models/AcademicLogBookEntry.js";
import { AcademicProgress } from "../models/AcademicProgress.js";
import { AcademicSessionPlan } from "../models/AcademicSessionPlan.js";
import { Subject } from "../models/Subject.js";
import { Teacher } from "../models/Teacher.js";
import { ApiError } from "./apiError.js";
import {
  applyCurriculumSubjectFilter,
  applyOfficialPlanScopeToFilter,
  applyLogBookListScope,
  buildAcademicFilter,
  computeItemStatus,
  expandCurriculumSubjectIds,
  getNepaliMonthNameFromBsDate,
  serializeLessonPlans,
  serializeLogBookEntries,
  serializeSessionPlan
} from "./academicManagementService.js";
import { getDayOfWeekFromBs, getTodayBs } from "./nepaliDate.js";
import { tenantObjectId } from "./tenant.js";
import { TimetableSlot } from "../models/TimetableSlot.js";

export type AcademicReportType =
  | "session-plan"
  | "lesson-plan"
  | "teacher-lesson-plan"
  | "teacher-log-book"
  | "monthly-teaching"
  | "subject-progress"
  | "syllabus-completion"
  | "faculty-wise"
  | "year-wise"
  | "teacher-performance"
  | "daily-teaching"
  | "pending-log-book"
  | "late-submission"
  | "pending-approvals";

const parseFilters = (query: Record<string, unknown>): AcademicManagementFilters => ({
  academicYearBs: typeof query.academicYearBs === "string" ? query.academicYearBs : undefined,
  session: typeof query.session === "string" ? query.session : undefined,
  faculty: typeof query.faculty === "string" ? query.faculty : undefined,
  semesterBs: typeof query.semesterBs === "string" ? query.semesterBs : undefined,
  subjectId: typeof query.subjectId === "string" ? query.subjectId : undefined,
  teacherId: typeof query.teacherId === "string" ? query.teacherId : undefined,
  month: typeof query.month === "string" ? query.month : undefined,
  dateFrom: typeof query.dateFrom === "string" ? query.dateFrom : undefined,
  dateTo: typeof query.dateTo === "string" ? query.dateTo : undefined,
  status: typeof query.status === "string" ? (query.status as AcademicManagementFilters["status"]) : undefined,
  keyword: typeof query.keyword === "string" ? query.keyword : undefined,
  classId: typeof query.classId === "string" ? query.classId : undefined,
  sectionId: typeof query.sectionId === "string" ? query.sectionId : undefined,
  batchId: typeof query.batchId === "string" ? query.batchId : undefined,
  yearId: typeof query.yearId === "string" ? query.yearId : undefined
});

const teacherNameMap = async (teacherIds: string[]): Promise<Map<string, string>> => {
  const teachers = await Teacher.find({ _id: { $in: teacherIds } })
    .populate("user", "fullName")
    .lean();
  return new Map(
    teachers.map((teacher) => [
      teacher._id.toString(),
      (teacher.user as { fullName?: string } | undefined)?.fullName ?? teacher.teacherCode
    ])
  );
};

const subjectNameMap = async (subjectIds: string[]): Promise<Map<string, string>> => {
  const subjects = await Subject.find({ _id: { $in: subjectIds } }).select("name").lean();
  return new Map(subjects.map((subject) => [subject._id.toString(), subject.name]));
};

export interface AcademicReportColumn {
  key: string;
  label: string;
}

type Row = Record<string, string | number>;

const col = (key: string, label: string): AcademicReportColumn => ({ key, label });
const text = (value: unknown): string => (value === null || value === undefined ? "" : String(value).trim());
const pct = (value: unknown): number => Math.round(Number(value) || 0);
/** Status codes read as words ("PENDING_APPROVAL" → "Pending approval"). */
const humanize = (value: unknown): string => {
  const raw = text(value);
  if (!raw) return "";
  const words = raw.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
type Populated = { name?: string; code?: string; teacherCode?: string; user?: { fullName?: string } } | undefined;
const subjectOf = (record: { subject?: unknown }) => record.subject as Populated;
const teacherOf = (record: { teacher?: unknown }) => {
  const teacher = record.teacher as Populated;
  return teacher?.user?.fullName || teacher?.teacherCode || "";
};

const LOG_COLUMNS = [
  col("dateBs", "Date (BS)"),
  col("period", "Period"),
  col("time", "Time"),
  col("subject", "Subject"),
  col("teacher", "Teacher"),
  col("unit", "Unit"),
  col("topic", "Topic covered"),
  col("method", "Teaching method"),
  col("type", "Theory / Practical"),
  col("present", "Present"),
  col("absent", "Absent"),
  col("attendance", "Attendance %"),
  col("review", "Review status")
];

const logRows = (entries: Array<Record<string, unknown>>): Row[] =>
  entries.map((entry) => ({
    dateBs: text(entry.dateBs),
    period: text(entry.periodNumber),
    time: [text(entry.startTime), text(entry.endTime)].filter(Boolean).join(" – "),
    subject: subjectOf(entry)?.name ?? "",
    teacher: teacherOf(entry) || text(entry.deliveredByName),
    unit: text(entry.unit),
    topic: text(entry.topicCovered) || text(entry.subUnitTitle),
    method: text(entry.teachingMethod),
    type: humanize(entry.theoryPractical),
    present: Number(entry.attendancePresent) || 0,
    absent: Number(entry.attendanceAbsent) || 0,
    attendance: entry.attendancePercent != null ? pct(entry.attendancePercent) : "",
    review: humanize(entry.reviewStatus)
  }));

const LESSON_COLUMNS = [
  col("month", "Month"),
  col("date", "Teaching date (BS)"),
  col("subject", "Subject"),
  col("teacher", "Teacher"),
  col("planned", "Planned topics"),
  col("completed", "Completed topics"),
  col("pending", "Pending topics"),
  col("delayed", "Delayed"),
  col("completedPct", "Completed %"),
  col("status", "Status"),
  col("preparedBy", "Prepared by"),
  col("approvedBy", "Approved by")
];

const lessonRows = (plans: Array<Record<string, unknown>>): Row[] =>
  plans.map((plan) => ({
    month: text(plan.month),
    date: text(plan.teachingDateBs),
    subject: subjectOf(plan)?.name ?? "",
    teacher: teacherOf(plan),
    planned: Number(plan.plannedTopics) || 0,
    completed: Number(plan.completedTopics) || 0,
    pending: Number(plan.pendingTopics) || 0,
    delayed: Number(plan.delayedUnits) || 0,
    completedPct: pct(plan.completedPercent),
    status: humanize(plan.status),
    preparedBy: text(plan.preparedBy),
    approvedBy: text(plan.approvedByName)
  }));

/** Month filter on log book entries (they carry a BS date, not a month name). */
const inMonth = (dateBs: unknown, month?: string) =>
  !month || getNepaliMonthNameFromBsDate(text(dateBs)) === month || text(dateBs).slice(0, 7) === month;

export const generateAcademicReport = async (req: Request, reportType: AcademicReportType) => {
  const filters = parseFilters(req.query as Record<string, unknown>);
  const baseFilter = buildAcademicFilter(req, filters);
  // "month" only exists on lesson plans; every other record would match nothing.
  if (reportType !== "lesson-plan" && reportType !== "teacher-lesson-plan" && reportType !== "year-wise") {
    delete baseFilter.month;
  }
  await applyCurriculumSubjectFilter(req, baseFilter, filters.subjectId);
  const logBookReports = new Set<AcademicReportType>([
    "teacher-log-book",
    "pending-log-book",
    "daily-teaching",
    "monthly-teaching",
    "late-submission",
    "teacher-performance"
  ]);
  if (logBookReports.has(reportType)) {
    await applyLogBookListScope(req, baseFilter);
  } else {
    await applyOfficialPlanScopeToFilter(req, baseFilter, filters.teacherId);
  }
  const schoolId = tenantObjectId(req);
  // A teacher running a teacher-wise report sees their own records.
  const teacherForReport = filters.teacherId || (baseFilter.teacherId ? String(baseFilter.teacherId) : undefined);

  const subjectFilter =
    filters.subjectId != null
      ? await expandCurriculumSubjectIds(schoolId, filters.subjectId).then((ids) =>
          ids.length === 1 ? ids[0] : { $in: ids }
        )
      : undefined;

  /** Progress rows only for non-deleted session plans, respecting teacher scope / filters. */
  const liveSessionFilter: Record<string, unknown> = { schoolId, isDeleted: false };
  if (baseFilter.teacherId) liveSessionFilter.teacherId = baseFilter.teacherId;
  if (filters.academicYearBs) liveSessionFilter.academicYearBs = filters.academicYearBs;
  if (filters.faculty) liveSessionFilter.faculty = filters.faculty;
  if (subjectFilter !== undefined) liveSessionFilter.subjectId = subjectFilter;
  const liveSessionIds = (await AcademicSessionPlan.find(liveSessionFilter).select("_id").lean()).map((p) => p._id);
  const progressFilter: Record<string, unknown> = {
    schoolId,
    sessionPlanId: { $in: liveSessionIds }
  };
  if (baseFilter.teacherId) progressFilter.teacherId = baseFilter.teacherId;
  if (filters.academicYearBs) progressFilter.academicYearBs = filters.academicYearBs;
  if (subjectFilter !== undefined) progressFilter.subjectId = subjectFilter;

  const logFilterFor = (extra?: Record<string, unknown>) => {
    const logFilter: Record<string, unknown> = { ...baseFilter, isDeleted: false, ...extra };
    delete logFilter.status;
    if (filters.dateFrom || filters.dateTo) {
      logFilter.dateBs = {
        ...(filters.dateFrom ? { $gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { $lte: filters.dateTo } : {})
      };
    }
    return logFilter;
  };

  switch (reportType) {
    case "session-plan": {
      const plans = await AcademicSessionPlan.find(baseFilter).sort({ academicYearBs: -1, updatedAt: -1 }).lean();
      const records = (
        await Promise.all(plans.map((plan) => serializeSessionPlan(plan._id.toString(), { readOnly: true })))
      ).filter(Boolean) as Array<Record<string, unknown>>;
      return {
        title: "Session Plan Report",
        columns: [
          col("subject", "Subject"),
          col("code", "Code"),
          col("teacher", "Teacher"),
          col("year", "Academic year"),
          col("faculty", "Faculty"),
          col("semester", "Semester"),
          col("units", "Units"),
          col("completedUnits", "Completed"),
          col("remainingUnits", "Remaining"),
          col("completedPct", "Completed %"),
          col("status", "Status"),
          col("verifiedBy", "Verified by")
        ],
        rows: records.map((plan) => ({
          subject: subjectOf(plan)?.name ?? "",
          code: subjectOf(plan)?.code ?? "",
          teacher: teacherOf(plan),
          year: text(plan.academicYearBs),
          faculty: text(plan.faculty),
          semester: text(plan.semesterBs),
          units: Array.isArray(plan.units) ? plan.units.length : 0,
          completedUnits: Number(plan.completedUnits) || 0,
          remainingUnits: Number(plan.remainingUnits) || 0,
          completedPct: pct(plan.completedPercent),
          status: humanize(plan.status),
          verifiedBy: text(plan.verifiedByName)
        }))
      };
    }
    case "lesson-plan": {
      const plans = await AcademicLessonPlan.find(baseFilter).sort({ academicYearBs: -1, teachingDateBs: -1, updatedAt: -1 }).lean();
      const records = (await serializeLessonPlans(plans.map((plan) => plan._id.toString()))).filter(Boolean);
      return { title: "Lesson Plan Report", columns: LESSON_COLUMNS, rows: lessonRows(records as Array<Record<string, unknown>>) };
    }
    case "teacher-lesson-plan": {
      if (!teacherForReport) throw new ApiError(400, "Select a teacher in the filters for this report");
      const plans = await AcademicLessonPlan.find({ ...baseFilter, teacherId: teacherForReport })
        .sort({ teachingDateBs: -1, updatedAt: -1 })
        .lean();
      const records = (await serializeLessonPlans(plans.map((plan) => plan._id.toString()))).filter(Boolean);
      const names = await teacherNameMap([teacherForReport]);
      return {
        title: `Teacher-wise Lesson Plan — ${names.get(teacherForReport) ?? "Teacher"}`,
        columns: LESSON_COLUMNS,
        rows: lessonRows(records as Array<Record<string, unknown>>)
      };
    }
    case "teacher-log-book": {
      if (!teacherForReport) throw new ApiError(400, "Select a teacher in the filters for this report");
      const entries = await AcademicLogBookEntry.find(logFilterFor({ teacherId: teacherForReport }))
        .sort({ dateBs: -1, periodNumber: 1 })
        .lean();
      const records = (await serializeLogBookEntries(entries.map((entry) => entry._id.toString()))).filter(
        (entry) => entry && inMonth(entry.dateBs, filters.month)
      );
      const names = await teacherNameMap([teacherForReport]);
      return {
        title: `Teacher-wise Log Book — ${names.get(teacherForReport) ?? "Teacher"}`,
        columns: LOG_COLUMNS,
        rows: logRows(records as Array<Record<string, unknown>>)
      };
    }
    case "monthly-teaching": {
      const entries = await AcademicLogBookEntry.find(logFilterFor()).sort({ dateBs: 1, periodNumber: 1 }).lean();
      const records = (await serializeLogBookEntries(entries.map((entry) => entry._id.toString()))).filter(
        (entry) => entry && inMonth(entry.dateBs, filters.month)
      ) as Array<Record<string, unknown>>;
      // One row per teacher × subject × month: classes taken and topics covered.
      const grouped = new Map<string, Row>();
      const topicsByKey = new Map<string, Set<string>>();
      for (const entry of records) {
        const month = getNepaliMonthNameFromBsDate(text(entry.dateBs));
        const subject = subjectOf(entry)?.name ?? "";
        const teacher = teacherOf(entry) || text(entry.deliveredByName);
        const key = `${text(entry.dateBs).slice(0, 7)}|${teacher}|${subject}`;
        const row =
          grouped.get(key) ??
          ({
            month: `${month} ${text(entry.dateBs).slice(0, 4)}`,
            teacher,
            subject,
            classes: 0,
            theory: 0,
            practical: 0,
            firstDate: text(entry.dateBs),
            lastDate: text(entry.dateBs),
            topics: 0
          } as Row);
        row.classes = Number(row.classes) + 1;
        if (String(entry.theoryPractical ?? "").toUpperCase().includes("PRACTICAL")) row.practical = Number(row.practical) + 1;
        else row.theory = Number(row.theory) + 1;
        row.lastDate = text(entry.dateBs);
        const topic = text(entry.topicCovered) || text(entry.subUnitTitle);
        const topics = topicsByKey.get(key) ?? new Set<string>();
        if (topic) topics.add(topic.toLowerCase());
        topicsByKey.set(key, topics);
        row.topics = topics.size;
        grouped.set(key, row);
      }
      return {
        title: "Monthly Teaching Report",
        columns: [
          col("month", "Month"),
          col("teacher", "Teacher"),
          col("subject", "Subject"),
          col("classes", "Classes taken"),
          col("theory", "Theory"),
          col("practical", "Practical"),
          col("topics", "Topics covered"),
          col("firstDate", "First class"),
          col("lastDate", "Last class")
        ],
        rows: Array.from(grouped.values())
      };
    }
    case "subject-progress": {
      const progress = await AcademicProgress.find(progressFilter).lean();
      const [names, teachers] = await Promise.all([
        subjectNameMap(progress.map((row) => row.subjectId.toString())),
        teacherNameMap(progress.map((row) => row.teacherId.toString()))
      ]);
      return {
        title: "Subject Progress Report",
        columns: [
          col("subject", "Subject"),
          col("teacher", "Teacher"),
          col("completedUnits", "Completed units"),
          col("remainingUnits", "Remaining units"),
          col("delayedUnits", "Delayed units"),
          col("completedPct", "Completed %"),
          col("remainingPct", "Remaining %")
        ],
        rows: progress
          .map((row) => ({
            subject: names.get(row.subjectId.toString()) ?? "Subject",
            teacher: teachers.get(row.teacherId.toString()) ?? "",
            completedUnits: row.completedUnits ?? 0,
            remainingUnits: row.remainingUnits ?? 0,
            delayedUnits: row.delayedUnits ?? 0,
            completedPct: pct(row.completedPercent),
            remainingPct: pct(row.remainingPercent)
          }))
          .sort((a, b) => a.subject.localeCompare(b.subject))
      };
    }
    case "syllabus-completion": {
      const { AcademicSyllabus } = await import("../models/AcademicSyllabus.js");
      const { serializeSyllabus } = await import("./academicManagementService.js");
      const syllabusFilter: Record<string, unknown> = { ...baseFilter, isDeleted: false };
      delete syllabusFilter.status;
      const syllabi = await AcademicSyllabus.find(syllabusFilter).sort({ updatedAt: -1 }).lean();
      const serialized = (
        await Promise.all(syllabi.map((row) => serializeSyllabus(row._id.toString(), { readOnly: true })))
      ).filter(Boolean);
      const columns = [
        col("subject", "Subject"),
        col("code", "Code"),
        col("teacher", "Teacher"),
        col("chapter", "Chapter"),
        col("unit", "Unit"),
        col("subUnit", "Sub-unit"),
        col("heading", "Topic"),
        col("status", "Status"),
        col("hours", "Hours"),
        col("practical", "Practical"),
        col("subjectPct", "Subject completed %")
      ];

      if (serialized.length > 0) {
        const rows: Row[] = [];
        for (const plan of serialized) {
          if (!plan) continue;
          const base = {
            subject: plan.subject?.name ?? "Subject",
            code: plan.subjectCode || plan.subject?.code || "",
            teacher: plan.teacher?.user?.fullName ?? "Shared",
            subjectPct: pct(plan.completedPercent)
          };
          if (plan.chapters && plan.chapters.length > 0) {
            for (const chapter of plan.chapters) {
              for (const unit of chapter.units) {
                for (const sub of unit.subUnits) {
                  rows.push({
                    ...base,
                    chapter: [text(chapter.chapterNo), text(chapter.title)].filter(Boolean).join(". "),
                    unit: [text(unit.unitNo), text(unit.title)].filter(Boolean).join(". "),
                    subUnit: text(sub.displayNo),
                    heading: text(sub.heading),
                    status: humanize(sub.status),
                    hours: Number(sub.teachingHours) || 0,
                    practical: sub.practicalRequired ? "Yes" : "No"
                  });
                }
              }
            }
          } else {
            rows.push({ ...base, chapter: "", unit: "", subUnit: "", heading: "", status: "", hours: "", practical: "" });
          }
        }
        return { title: "Syllabus Completion Report", columns, rows };
      }

      // Fallback: session-plan progress (legacy)
      const progress = await AcademicProgress.find(progressFilter).lean();
      const names = await subjectNameMap(progress.map((row) => row.subjectId.toString()));
      return {
        title: "Syllabus Completion Report",
        columns: [col("subject", "Subject"), col("completedPct", "Completed %"), col("remainingPct", "Remaining %")],
        rows: progress.map((row) => ({
          subject: names.get(row.subjectId.toString()) ?? "Subject",
          completedPct: pct(row.completedPercent),
          remainingPct: pct(row.remainingPercent)
        }))
      };
    }
    case "faculty-wise": {
      const plans = await AcademicSessionPlan.find(liveSessionFilter).select("faculty subjectId teacherId").lean();
      const progress = await AcademicProgress.find(progressFilter).lean();
      const planFacultyMap = new Map(plans.map((plan) => [plan._id.toString(), text(plan.faculty) || "General"]));
      const facultyTotals = new Map<string, { plans: number; teachers: Set<string>; progressRows: number; sum: number }>();
      for (const plan of plans) {
        const faculty = text(plan.faculty) || "General";
        const current = facultyTotals.get(faculty) ?? { plans: 0, teachers: new Set<string>(), progressRows: 0, sum: 0 };
        current.plans += 1;
        if (plan.teacherId) current.teachers.add(plan.teacherId.toString());
        facultyTotals.set(faculty, current);
      }
      for (const row of progress) {
        const faculty = planFacultyMap.get(row.sessionPlanId.toString()) ?? "General";
        const current = facultyTotals.get(faculty) ?? { plans: 0, teachers: new Set<string>(), progressRows: 0, sum: 0 };
        current.progressRows += 1;
        current.sum += row.completedPercent;
        facultyTotals.set(faculty, current);
      }
      return {
        title: "Faculty-wise Report",
        columns: [
          col("faculty", "Faculty"),
          col("plans", "Session plans"),
          col("teachers", "Teachers"),
          col("completedPct", "Average completed %"),
          col("remainingPct", "Remaining %")
        ],
        rows: Array.from(facultyTotals.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([faculty, stats]) => {
            const average = stats.progressRows > 0 ? Math.round(stats.sum / stats.progressRows) : 0;
            return {
              faculty,
              plans: stats.plans,
              teachers: stats.teachers.size,
              completedPct: average,
              remainingPct: 100 - average
            };
          })
      };
    }
    case "year-wise": {
      const sessionFilter: Record<string, unknown> = { ...baseFilter };
      delete sessionFilter.month;
      const logFilter = logFilterFor();
      delete logFilter.month;
      const [sessionPlans, lessonPlans, logEntries] = await Promise.all([
        AcademicSessionPlan.find(sessionFilter).select("academicYearBs").lean(),
        AcademicLessonPlan.find(baseFilter).select("academicYearBs status").lean(),
        AcademicLogBookEntry.find(logFilter).select("academicYearBs").lean()
      ]);
      const grouped = new Map<string, { sessionPlans: number; lessonPlans: number; approved: number; logEntries: number }>();
      const bump = (year: unknown, key: "sessionPlans" | "lessonPlans" | "approved" | "logEntries") => {
        const label = text(year) || "Not set";
        const row = grouped.get(label) ?? { sessionPlans: 0, lessonPlans: 0, approved: 0, logEntries: 0 };
        row[key] += 1;
        grouped.set(label, row);
      };
      sessionPlans.forEach((plan) => bump(plan.academicYearBs, "sessionPlans"));
      lessonPlans.forEach((plan) => {
        bump(plan.academicYearBs, "lessonPlans");
        if (plan.status === "APPROVED") bump(plan.academicYearBs, "approved");
      });
      logEntries.forEach((entry) => bump(entry.academicYearBs, "logEntries"));
      return {
        title: "Year-wise Report",
        columns: [
          col("academicYearBs", "Academic year"),
          col("sessionPlans", "Session plans"),
          col("lessonPlans", "Lesson plans"),
          col("approved", "Lesson plans approved"),
          col("logEntries", "Log book entries")
        ],
        rows: Array.from(grouped.entries())
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([academicYearBs, stats]) => ({ academicYearBs, ...stats }))
      };
    }
    case "teacher-performance": {
      const [progress, logEntries] = await Promise.all([
        AcademicProgress.find(progressFilter).lean(),
        AcademicLogBookEntry.find(logFilterFor()).select("teacherId dateBs").lean()
      ]);
      const grouped = new Map<string, { subjects: number; sum: number; classes: number; delayed: number }>();
      const entryFor = (id: string) => grouped.get(id) ?? { subjects: 0, sum: 0, classes: 0, delayed: 0 };
      for (const row of progress) {
        const key = row.teacherId.toString();
        const current = entryFor(key);
        current.subjects += 1;
        current.sum += row.completedPercent;
        current.delayed += row.delayedUnits ?? 0;
        grouped.set(key, current);
      }
      for (const entry of logEntries) {
        if (!entry.teacherId || !inMonth(entry.dateBs, filters.month)) continue;
        const key = entry.teacherId.toString();
        const current = entryFor(key);
        current.classes += 1;
        grouped.set(key, current);
      }
      const names = await teacherNameMap(Array.from(grouped.keys()));
      return {
        title: "Teacher Performance Report",
        columns: [
          col("teacher", "Teacher"),
          col("subjects", "Subjects (session plans)"),
          col("completedPct", "Average syllabus completed %"),
          col("delayed", "Delayed units"),
          col("classes", "Classes logged")
        ],
        rows: Array.from(grouped.entries())
          .map(([teacherId, stats]) => ({
            teacher: names.get(teacherId) ?? "Teacher",
            subjects: stats.subjects,
            completedPct: stats.subjects > 0 ? Math.round(stats.sum / stats.subjects) : 0,
            delayed: stats.delayed,
            classes: stats.classes
          }))
          .sort((a, b) => a.teacher.localeCompare(b.teacher))
      };
    }
    case "daily-teaching": {
      // One day: the From date, or today when no date is chosen.
      const day = filters.dateFrom || getTodayBs();
      const logFilter: Record<string, unknown> = { ...baseFilter, isDeleted: false, dateBs: day };
      delete logFilter.status;
      const entries = await AcademicLogBookEntry.find(logFilter).sort({ periodNumber: 1, startTime: 1 }).lean();
      const records = await serializeLogBookEntries(entries.map((entry) => entry._id.toString()));
      return {
        title: `Daily Teaching Report — ${day}`,
        columns: LOG_COLUMNS,
        rows: logRows(records.filter(Boolean) as Array<Record<string, unknown>>)
      };
    }
    case "pending-log-book": {
      const day = filters.dateFrom || getTodayBs();
      const dayOfWeek = getDayOfWeekFromBs(day);
      const slotFilter: Record<string, unknown> = { schoolId, dayOfWeek, teacherId: { $ne: null } };
      if (baseFilter.teacherId) slotFilter.teacherId = baseFilter.teacherId;
      const [slots, submitted] = await Promise.all([
        TimetableSlot.find(slotFilter).select("teacherId").lean(),
        AcademicLogBookEntry.find({
          schoolId,
          dateBs: day,
          isDeleted: false,
          ...(baseFilter.teacherId ? { teacherId: baseFilter.teacherId } : {})
        })
          .select("teacherId")
          .lean()
      ]);
      const scheduled = new Map<string, number>();
      slots.forEach((slot) => {
        if (!slot.teacherId) return;
        const key = slot.teacherId.toString();
        scheduled.set(key, (scheduled.get(key) ?? 0) + 1);
      });
      const logged = new Map<string, number>();
      submitted.forEach((entry) => {
        if (!entry.teacherId) return;
        const key = entry.teacherId.toString();
        logged.set(key, (logged.get(key) ?? 0) + 1);
      });
      // Pending when fewer classes are logged than the timetable schedules that day.
      const pending = Array.from(scheduled.entries()).filter(([id, periods]) => (logged.get(id) ?? 0) < periods);
      const names = await teacherNameMap(pending.map(([id]) => id));
      return {
        title: `Pending Log Book Report — ${day}`,
        columns: [
          col("teacher", "Teacher"),
          col("dateBs", "Date (BS)"),
          col("scheduled", "Periods scheduled"),
          col("logged", "Periods logged"),
          col("status", "Status")
        ],
        rows: pending
          .map(([id, periods]) => ({
            teacher: names.get(id) ?? "Teacher",
            dateBs: day,
            scheduled: periods,
            logged: logged.get(id) ?? 0,
            status: (logged.get(id) ?? 0) === 0 ? "Missing" : "Partly logged"
          }))
          .sort((a, b) => a.teacher.localeCompare(b.teacher))
      };
    }
    case "late-submission": {
      const todayBs = getTodayBs();
      // Lesson plans in scope (filters, teacher), then their overdue topics.
      const planFilter: Record<string, unknown> = { ...baseFilter };
      delete planFilter.status;
      const plans = await AcademicLessonPlan.find(planFilter).populate("subjectId", "name").lean();
      const planMap = new Map(plans.map((plan) => [plan._id.toString(), plan]));
      const candidates = await AcademicLessonPlanItem.find({
        schoolId,
        lessonPlanId: { $in: plans.map((plan) => plan._id) },
        completionStatus: { $ne: "COMPLETED" }
      }).lean();
      const items = candidates.filter(
        (item) => computeItemStatus(item.estimatedClasses, item.completedClasses, item.deadline, todayBs) === "DELAYED"
      );
      const names = await teacherNameMap(plans.map((plan) => plan.teacherId.toString()));
      return {
        title: "Late Submission Report",
        columns: [
          col("teacher", "Teacher"),
          col("subject", "Subject"),
          col("month", "Month"),
          col("topic", "Topic"),
          col("deadline", "Deadline (BS)"),
          col("classes", "Classes done / planned"),
          col("status", "Status")
        ],
        rows: items
          .map((item) => {
            const plan = planMap.get(item.lessonPlanId.toString());
            return {
              teacher: plan ? (names.get(plan.teacherId.toString()) ?? "Teacher") : "Teacher",
              subject: (plan?.subjectId as { name?: string } | undefined)?.name ?? "",
              month: text(plan?.month),
              topic: text(item.plannedTopic),
              deadline: text(item.deadline),
              classes: `${item.completedClasses ?? 0} / ${item.estimatedClasses ?? 0}`,
              status: "Delayed"
            };
          })
          .sort((a, b) => a.deadline.localeCompare(b.deadline))
      };
    }
    case "pending-approvals": {
      const pendingStatuses = { $in: ["SUBMITTED", "PENDING_APPROVAL"] };
      const sessionFilter: Record<string, unknown> = { ...baseFilter, status: pendingStatuses };
      delete sessionFilter.month;
      const [sessionPending, lessonPending] = await Promise.all([
        AcademicSessionPlan.find(sessionFilter).populate("subjectId", "name").lean(),
        AcademicLessonPlan.find({ ...baseFilter, status: pendingStatuses }).populate("subjectId", "name").lean()
      ]);
      const names = await teacherNameMap([
        ...sessionPending.map((plan) => plan.teacherId.toString()),
        ...lessonPending.map((plan) => plan.teacherId.toString())
      ]);
      const submittedOn = (plan: { updatedAt?: Date }) =>
        plan.updatedAt ? new Date(plan.updatedAt).toISOString().slice(0, 10) : "";
      return {
        title: "Pending Approvals Report",
        columns: [
          col("type", "Type"),
          col("teacher", "Teacher"),
          col("subject", "Subject"),
          col("period", "Academic year / Month"),
          col("status", "Status"),
          col("submittedOn", "Last updated (AD)")
        ],
        rows: [
          ...sessionPending.map((plan) => ({
            type: "Session plan",
            teacher: names.get(plan.teacherId.toString()) ?? "Teacher",
            subject: (plan.subjectId as { name?: string } | undefined)?.name ?? "",
            period: text(plan.academicYearBs),
            status: humanize(plan.status),
            submittedOn: submittedOn(plan as { updatedAt?: Date })
          })),
          ...lessonPending.map((plan) => ({
            type: "Lesson plan",
            teacher: names.get(plan.teacherId.toString()) ?? "Teacher",
            subject: (plan.subjectId as { name?: string } | undefined)?.name ?? "",
            period: [text(plan.academicYearBs), text(plan.month)].filter(Boolean).join(" · "),
            status: humanize(plan.status),
            submittedOn: submittedOn(plan as { updatedAt?: Date })
          }))
        ]
      };
    }
    default:
      throw new ApiError(400, "Unknown report type");
  }
};

const escapeCsv = (value: unknown): string => {
  const raw = value == null ? "" : String(value);
  if (raw.includes(",") || raw.includes('"') || raw.includes("\n")) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
};

export const exportAcademicReportCsv = async (req: Request, res: Response, reportType: AcademicReportType): Promise<void> => {
  const report = await generateAcademicReport(req, reportType);
  const rows = report.rows as Array<Record<string, unknown>>;
  const lines = [
    report.columns.map((column) => escapeCsv(column.label)).join(","),
    ...rows.map((row) => report.columns.map((column) => escapeCsv(row[column.key])).join(","))
  ];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${reportType}_${Date.now()}.csv"`);
  // BOM so Excel opens Nepali text correctly
  res.send("﻿" + lines.join("\r\n"));
};
