import type {
  AcademicLessonPlanRecord,
  AcademicLogBookEntryRecord,
  AcademicManagementFilters,
  AcademicSessionPlanRecord
} from "@phit-erp/shared";
import * as XLSX from "xlsx";

export const defaultAcademicFilters = (): AcademicManagementFilters => ({
  academicYearBs: "",
  session: "",
  faculty: "",
  semesterBs: "",
  classId: "",
  sectionId: "",
  batchId: "",
  yearId: "",
  subjectId: "",
  teacherId: "",
  month: "",
  dateFrom: "",
  dateTo: "",
  status: undefined,
  keyword: ""
});

export const filtersToParams = (filters: AcademicManagementFilters): Record<string, string> => {
  const params: Record<string, string> = {};
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params[key] = String(value);
  });
  return params;
};

export const statusBadgeClass = (status: string): string => {
  switch (status) {
    case "APPROVED":
      return "bg-emerald-100 text-emerald-800";
    case "REJECTED":
    case "NEEDS_IMPROVEMENT":
      return "bg-rose-100 text-rose-800";
    case "SUBMITTED":
    case "PENDING_APPROVAL":
    case "PENDING":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
};

export const exportSessionPlansExcel = (plans: AcademicSessionPlanRecord[], filename: string) => {
  const rows = plans.flatMap((plan) =>
    plan.units.map((unit) => ({
      Teacher: plan.teacher?.user?.fullName ?? plan.teacherId,
      Subject: plan.subject?.name ?? plan.subjectId,
      "Academic Year": plan.academicYearBs,
      "Unit No": unit.unitNo,
      Chapter: unit.chapterName,
      Hours: unit.estimatedTeachingHours,
      Status: plan.status,
      "Unit Status": unit.status
    }))
  );
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Session Plans");
  XLSX.writeFile(workbook, filename);
};

export const exportLessonPlansExcel = (plans: AcademicLessonPlanRecord[], filename: string) => {
  const rows = plans.flatMap((plan) =>
    plan.items.map((item) => ({
      Teacher: plan.teacher?.user?.fullName ?? plan.teacherId,
      Subject: plan.subject?.name ?? plan.subjectId,
      Month: plan.month,
      Topic: item.plannedTopic,
      "Est. Classes": item.estimatedClasses,
      Completed: item.completedClasses,
      Status: plan.status,
      "Item Status": item.completionStatus
    }))
  );
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Lesson Plans");
  XLSX.writeFile(workbook, filename);
};

export const exportLogBookExcel = (entries: AcademicLogBookEntryRecord[], filename: string) => {
  const rows = entries.map((entry) => ({
    Date: entry.dateBs,
    Teacher: entry.teacher?.user?.fullName ?? entry.teacherId,
    Subject: entry.subject?.name ?? entry.subjectId,
    Topic: entry.topicCovered,
    Period: entry.periodNumber,
    Attendance: `${entry.attendancePercent}%`,
    Review: entry.reviewStatus
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Log Book");
  XLSX.writeFile(workbook, filename);
};

export const NEPALI_MONTHS = [
  "Baisakh",
  "Jestha",
  "Ashadh",
  "Shrawan",
  "Bhadra",
  "Ashwin",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra"
];