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
  applyTeacherScopeToFilter,
  buildAcademicFilter,
  serializeLessonPlan,
  serializeLogBookEntry,
  serializeSessionPlan
} from "./academicManagementService.js";
import { tenantObjectId } from "./tenant.js";

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

export const generateAcademicReport = async (req: Request, reportType: AcademicReportType) => {
  const filters = parseFilters(req.query as Record<string, unknown>);
  const baseFilter = buildAcademicFilter(req, filters);
  await applyTeacherScopeToFilter(req, baseFilter);

  switch (reportType) {
    case "session-plan": {
      const plans = await AcademicSessionPlan.find(baseFilter).sort({ updatedAt: -1 }).lean();
      const rows = await Promise.all(plans.map((plan) => serializeSessionPlan(plan._id.toString())));
      return { title: "Session Plan Report", rows: rows.filter(Boolean) };
    }
    case "lesson-plan": {
      const plans = await AcademicLessonPlan.find(baseFilter).sort({ updatedAt: -1 }).lean();
      const rows = await Promise.all(plans.map((plan) => serializeLessonPlan(plan._id.toString())));
      return { title: "Lesson Plan Report", rows: rows.filter(Boolean) };
    }
    case "teacher-lesson-plan": {
      if (!filters.teacherId) throw new ApiError(400, "teacherId is required for this report");
      const plans = await AcademicLessonPlan.find({ ...baseFilter, teacherId: filters.teacherId }).lean();
      const rows = await Promise.all(plans.map((plan) => serializeLessonPlan(plan._id.toString())));
      const names = await teacherNameMap([filters.teacherId]);
      return { title: `Teacher Lesson Plan — ${names.get(filters.teacherId) ?? "Teacher"}`, rows: rows.filter(Boolean) };
    }
    case "teacher-log-book": {
      if (!filters.teacherId) throw new ApiError(400, "teacherId is required for this report");
      const logFilter = { ...baseFilter, teacherId: filters.teacherId };
      delete (logFilter as Record<string, unknown>).status;
      const entries = await AcademicLogBookEntry.find(logFilter).sort({ dateBs: -1 }).lean();
      const rows = await Promise.all(entries.map((entry) => serializeLogBookEntry(entry._id.toString())));
      const names = await teacherNameMap([filters.teacherId]);
      return { title: `Teacher Log Book — ${names.get(filters.teacherId) ?? "Teacher"}`, rows: rows.filter(Boolean) };
    }
    case "monthly-teaching": {
      const logFilter: Record<string, unknown> = { ...baseFilter, isDeleted: false };
      delete logFilter.status;
      delete logFilter.month;
      if (filters.dateFrom || filters.dateTo) {
        logFilter.dateBs = {
          ...(filters.dateFrom ? { $gte: filters.dateFrom } : {}),
          ...(filters.dateTo ? { $lte: filters.dateTo } : {})
        };
      }
      const entries = await AcademicLogBookEntry.find(logFilter).sort({ dateBs: -1 }).lean();
      const rows = await Promise.all(entries.map((entry) => serializeLogBookEntry(entry._id.toString())));
      return { title: "Monthly Teaching Report", rows: rows.filter(Boolean) };
    }
    case "subject-progress": {
      const progress = await AcademicProgress.find({ schoolId: tenantObjectId(req) }).lean();
      const names = await subjectNameMap(progress.map((row) => row.subjectId.toString()));
      return {
        title: "Subject Progress Report",
        rows: progress.map((row) => ({
          subjectName: names.get(row.subjectId.toString()) ?? "Subject",
          completedPercent: row.completedPercent,
          completedUnits: row.completedUnits,
          remainingUnits: row.remainingUnits,
          delayedUnits: row.delayedUnits
        }))
      };
    }
    case "syllabus-completion": {
      const progress = await AcademicProgress.find({ schoolId: tenantObjectId(req) }).lean();
      const names = await subjectNameMap(progress.map((row) => row.subjectId.toString()));
      return {
        title: "Syllabus Completion Report",
        rows: progress.map((row) => ({
          subjectName: names.get(row.subjectId.toString()) ?? "Subject",
          percent: row.completedPercent
        }))
      };
    }
    case "faculty-wise": {
      const plans = await AcademicSessionPlan.find({ schoolId: tenantObjectId(req), isDeleted: false, faculty: { $exists: true, $ne: "" } }).lean();
      const progress = await AcademicProgress.find({ schoolId: tenantObjectId(req) }).lean();
      const planFacultyMap = new Map(plans.map((plan) => [plan._id.toString(), plan.faculty ?? "General"]));
      const facultyTotals = new Map<string, { total: number; sum: number }>();

      progress.forEach((row) => {
        const faculty = planFacultyMap.get(row.sessionPlanId.toString()) ?? "General";
        const current = facultyTotals.get(faculty) ?? { total: 0, sum: 0 };
        facultyTotals.set(faculty, { total: current.total + 1, sum: current.sum + row.completedPercent });
      });

      return {
        title: "Faculty-wise Report",
        rows: Array.from(facultyTotals.entries()).map(([faculty, stats]) => ({
          faculty,
          completionPercent: stats.total > 0 ? Math.round(stats.sum / stats.total) : 0
        }))
      };
    }
    case "year-wise": {
      const plans = await AcademicLessonPlan.find({ ...baseFilter }).lean();
      const grouped = new Map<string, number>();
      plans.forEach((plan) => {
        const key = plan.academicYearBs;
        grouped.set(key, (grouped.get(key) ?? 0) + 1);
      });
      return {
        title: "Year-wise Report",
        rows: Array.from(grouped.entries()).map(([academicYearBs, count]) => ({ academicYearBs, lessonPlans: count }))
      };
    }
    case "teacher-performance": {
      const progress = await AcademicProgress.find({ schoolId: tenantObjectId(req) }).lean();
      const names = await teacherNameMap(progress.map((row) => row.teacherId.toString()));
      const grouped = new Map<string, { total: number; sum: number }>();
      progress.forEach((row) => {
        const key = row.teacherId.toString();
        const current = grouped.get(key) ?? { total: 0, sum: 0 };
        grouped.set(key, { total: current.total + 1, sum: current.sum + row.completedPercent });
      });
      return {
        title: "Teacher Performance Report",
        rows: Array.from(grouped.entries()).map(([teacherId, stats]) => ({
          teacherId,
          teacherName: names.get(teacherId) ?? "Teacher",
          completionPercent: stats.total > 0 ? Math.round(stats.sum / stats.total) : 0
        }))
      };
    }
    case "daily-teaching": {
      const logFilter: Record<string, unknown> = { ...baseFilter, isDeleted: false };
      delete logFilter.status;
      if (filters.dateFrom) logFilter.dateBs = filters.dateFrom;
      const entries = await AcademicLogBookEntry.find(logFilter).sort({ periodNumber: 1 }).lean();
      const rows = await Promise.all(entries.map((entry) => serializeLogBookEntry(entry._id.toString())));
      return { title: "Daily Teaching Report", rows: rows.filter(Boolean) };
    }
    case "pending-log-book": {
      const teachers = await Teacher.find({ schoolId: tenantObjectId(req) }).select("_id").lean();
      const today = filters.dateFrom ?? new Date().toISOString().slice(0, 10);
      const submitted = await AcademicLogBookEntry.distinct("teacherId", {
        schoolId: tenantObjectId(req),
        dateBs: today,
        isDeleted: false
      });
      const submittedSet = new Set(submitted.map((id) => id.toString()));
      const names = await teacherNameMap(teachers.map((teacher) => teacher._id.toString()));
      return {
        title: "Pending Log Book Report",
        rows: teachers
          .filter((teacher) => !submittedSet.has(teacher._id.toString()))
          .map((teacher) => ({
            teacherId: teacher._id.toString(),
            teacherName: names.get(teacher._id.toString()) ?? "Teacher",
            dateBs: today,
            status: "MISSING"
          }))
      };
    }
    case "late-submission": {
      const items = await AcademicLessonPlanItem.find({
        schoolId: tenantObjectId(req),
        completionStatus: "DELAYED"
      }).lean();
      const planIds = [...new Set(items.map((item) => item.lessonPlanId.toString()))];
      const plans = await AcademicLessonPlan.find({ _id: { $in: planIds } }).lean();
      const planMap = new Map(plans.map((plan) => [plan._id.toString(), plan]));
      const names = await teacherNameMap(plans.map((plan) => plan.teacherId.toString()));
      return {
        title: "Late Submission Report",
        rows: items.map((item) => {
          const plan = planMap.get(item.lessonPlanId.toString());
          return {
            teacherName: plan ? (names.get(plan.teacherId.toString()) ?? "Teacher") : "Teacher",
            month: plan?.month,
            topic: item.plannedTopic,
            deadline: item.deadline,
            status: item.completionStatus
          };
        })
      };
    }
    case "pending-approvals": {
      const [sessionPending, lessonPending] = await Promise.all([
        AcademicSessionPlan.find({ ...baseFilter, status: { $in: ["SUBMITTED", "PENDING_APPROVAL"] } }).lean(),
        AcademicLessonPlan.find({ ...baseFilter, status: { $in: ["SUBMITTED", "PENDING_APPROVAL"] } }).lean()
      ]);
      const teacherIds = [
        ...sessionPending.map((plan) => plan.teacherId.toString()),
        ...lessonPending.map((plan) => plan.teacherId.toString())
      ];
      const names = await teacherNameMap(teacherIds);
      return {
        title: "Pending Approvals Report",
        rows: [
          ...sessionPending.map((plan) => ({
            type: "SESSION_PLAN",
            teacherName: names.get(plan.teacherId.toString()) ?? "Teacher",
            status: plan.status,
            academicYearBs: plan.academicYearBs
          })),
          ...lessonPending.map((plan) => ({
            type: "LESSON_PLAN",
            teacherName: names.get(plan.teacherId.toString()) ?? "Teacher",
            status: plan.status,
            month: plan.month
          }))
        ]
      };
    }
    default:
      throw new ApiError(400, "Unknown report type");
  }
};

const escapeCsv = (value: unknown): string => {
  const text = value == null ? "" : String(value);
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

export const exportAcademicReportCsv = async (req: Request, res: Response, reportType: AcademicReportType): Promise<void> => {
  const report = await generateAcademicReport(req, reportType);
  const rows = report.rows as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${reportType}.csv"`);
    res.send("No data\n");
    return;
  }

  const firstRow = rows[0];
  if (!firstRow) {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${reportType}.csv"`);
    res.send("No data\n");
    return;
  }

  const headers = Object.keys(firstRow);
  const lines = [headers.join(","), ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(","))];
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${reportType}_${Date.now()}.csv"`);
  res.send(lines.join("\n"));
};