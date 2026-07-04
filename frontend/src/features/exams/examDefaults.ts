import type { ExamInput, ExamRoutineInput, ResultInput } from "@nepal-school-erp/shared";

export const defaultExamValue: ExamInput = {
  name: "",
  academicYearBs: "2083/2084",
  startDateBs: "",
  endDateBs: "",
  resultPublishDateBs: "",
  status: "DRAFT",
  classIds: [],
  batchIds: [],
  yearIds: []
};

export const defaultRoutineValue: ExamRoutineInput = {
  subjectId: "",
  examDateBs: "",
  day: "",
  startTime: "",
  endTime: "",
  durationMinutes: 120,
  examHall: "",
  invigilator: "",
  remarks: ""
};

export const defaultResultValue: ResultInput = {
  examId: "",
  studentId: "",
  classId: "",
  sectionId: "",
  batchId: "",
  yearId: "",
  marks: []
};

export const EXAM_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  ONGOING: "Ongoing",
  COMPLETED: "Completed",
  PUBLISHED: "Published"
};

export const RESULT_SUBMISSION_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED_FOR_REVIEW: "Submitted for Review",
  PENDING_ADMIN_REVIEW: "Pending Admin Review",
  RETURNED_FOR_CORRECTION: "Returned for Correction",
  APPROVED: "Approved",
  PUBLISHED: "Published"
};

export const RESULT_SUBMISSION_STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  SUBMITTED_FOR_REVIEW: "bg-blue-100 text-blue-700",
  PENDING_ADMIN_REVIEW: "bg-amber-100 text-amber-800",
  RETURNED_FOR_CORRECTION: "bg-orange-100 text-orange-800",
  APPROVED: "bg-emerald-100 text-emerald-700",
  PUBLISHED: "bg-violet-100 text-violet-700"
};