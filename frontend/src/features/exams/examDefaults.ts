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