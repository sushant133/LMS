import type {
  AcademicLessonPlanRecord,
  AcademicLogBookEntryRecord,
  AcademicManagementFilters,
  AcademicSessionPlanRecord,
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
  keyword: "",
});

export const filtersToParams = (
  filters: AcademicManagementFilters,
): Record<string, string> => {
  const params: Record<string, string> = {};
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params[key] = String(value);
  });
  return params;
};

export const statusBadgeClass = (status: string): string => {
  switch (status) {
    case "APPROVED":
    case "COMPLETED":
      return "bg-emerald-100 text-emerald-800";
    case "REJECTED":
    case "NEEDS_IMPROVEMENT":
    case "DELAYED":
      return "bg-rose-100 text-rose-800";
    case "SUBMITTED":
    case "PENDING_APPROVAL":
    case "PENDING":
    case "IN_PROGRESS":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
};

export const remainingPercentOf = (completedPercent: number): number =>
  Math.max(0, 100 - Math.min(100, completedPercent));

export const exportSessionPlansExcel = (
  plans: AcademicSessionPlanRecord[],
  filename: string,
) => {
  const rows = plans.flatMap((plan) =>
    plan.units.map((unit) => ({
      "Academic Year": plan.academicYearBs,
      Faculty: plan.faculty ?? "",
      Teacher: plan.teacher?.user?.fullName ?? plan.teacherId,
      Subject: plan.subject?.name ?? plan.subjectId,
      "Subject Code": plan.subject?.code ?? "",
      "Approval Status": plan.status,
      "Completion %": plan.completedPercent,
      "Unit No": unit.unitNo,
      "Unit Title": unit.chapterName,
      Topics: unit.topicsCovered,
      "Estimated Hours": unit.estimatedTeachingHours,
      "Learning Outcomes": unit.learningOutcomes,
      References: unit.references,
      "Unit Status": unit.status,
    })),
  );
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Session Plans");
  XLSX.writeFile(workbook, filename);
};

export const exportLessonPlansExcel = (
  plans: AcademicLessonPlanRecord[],
  filename: string,
) => {
  const rows = plans.flatMap((plan) =>
    plan.items.map((item) => ({
      "Academic Year": plan.academicYearBs,
      Teacher: plan.teacher?.user?.fullName ?? plan.teacherId,
      Subject: plan.subject?.name ?? plan.subjectId,
      Month: plan.month,
      "Monthly Description": plan.monthlyDescription ?? "",
      Topic: item.plannedTopic,
      Unit: item.unit
        ? `U${item.unit.unitNo}: ${item.unit.chapterName}`
        : item.subjectLabel,
      Description: item.description,
      Deadline: item.deadline || "",
      "Est. Classes": item.estimatedClasses,
      Completed: item.completedClasses,
      "Completed %": item.completedPercent,
      "Remaining %":
        item.remainingPercent ?? remainingPercentOf(item.completedPercent),
      "Approval Status": plan.status,
      "Topic Status": item.completionStatus,
      Remarks: item.remarks,
    })),
  );
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Lesson Plans");
  XLSX.writeFile(workbook, filename);
};

export const exportLogBookExcel = (
  entries: AcademicLogBookEntryRecord[],
  filename: string,
) => {
  const rows = entries.map((entry) => ({
    Date: entry.dateBs,
    "Academic Year": entry.academicYearBs,
    Teacher: entry.teacher?.user?.fullName ?? entry.teacherId,
    Subject: entry.subject?.name ?? entry.subjectId,
    Unit: entry.unit,
    Topic: entry.topicCovered,
    Objectives: entry.objectives,
    Method: entry.teachingMethod,
    "Theory/Practical": entry.theoryPractical,
    Period: entry.periodNumber,
    "Start Time": entry.startTime ?? "",
    "End Time": entry.endTime ?? "",
    Feedback: entry.feedback,
    Attendance: `${entry.attendancePercent}%`,
    "Review Status": entry.reviewStatus,
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
  "Chaitra",
];
