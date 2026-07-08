export const BS_MONTH_NAMES = [
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
] as const;

export type BsMonthName = (typeof BS_MONTH_NAMES)[number];

export const ACADEMIC_CALENDAR_EVENT_TYPES = [
  "PUBLIC_HOLIDAY",
  "NATIONAL_HOLIDAY",
  "FESTIVAL",
  "COLLEGE_HOLIDAY",
  "ACADEMIC_EVENT",
  "SEMESTER_START",
  "SEMESTER_END",
  "INTERNAL_EXAMINATION",
  "FINAL_EXAMINATION",
  "PRACTICAL_EXAMINATION",
  "ADMISSION",
  "ORIENTATION",
  "SPORTS_WEEK",
  "CULTURAL_PROGRAM",
  "WORKSHOP",
  "SEMINAR",
  "INDUSTRIAL_VISIT",
  "PROJECT_SUBMISSION",
  "VIVA",
  "RESULT_PUBLICATION",
  "GRADUATION",
  "PARENT_MEETING",
  "FACULTY_MEETING",
  "OTHER"
] as const;

export type AcademicCalendarEventType = (typeof ACADEMIC_CALENDAR_EVENT_TYPES)[number];

export const HOLIDAY_EVENT_TYPES: AcademicCalendarEventType[] = [
  "PUBLIC_HOLIDAY",
  "NATIONAL_HOLIDAY",
  "FESTIVAL",
  "COLLEGE_HOLIDAY"
];

export const EXAMINATION_EVENT_TYPES: AcademicCalendarEventType[] = [
  "INTERNAL_EXAMINATION",
  "FINAL_EXAMINATION",
  "PRACTICAL_EXAMINATION",
  "VIVA"
];

export const ACADEMIC_EVENT_TYPES: AcademicCalendarEventType[] = [
  "ACADEMIC_EVENT",
  "SEMESTER_START",
  "SEMESTER_END",
  "ADMISSION",
  "ORIENTATION",
  "SPORTS_WEEK",
  "CULTURAL_PROGRAM",
  "WORKSHOP",
  "SEMINAR",
  "INDUSTRIAL_VISIT",
  "PROJECT_SUBMISSION",
  "RESULT_PUBLICATION",
  "GRADUATION",
  "PARENT_MEETING",
  "FACULTY_MEETING",
  "OTHER"
];

export const ACADEMIC_CALENDAR_EVENT_TYPE_LABELS: Record<AcademicCalendarEventType, string> = {
  PUBLIC_HOLIDAY: "Public Holiday",
  NATIONAL_HOLIDAY: "National Holiday",
  FESTIVAL: "Festival",
  COLLEGE_HOLIDAY: "College Holiday",
  ACADEMIC_EVENT: "Academic Event",
  SEMESTER_START: "Semester Start",
  SEMESTER_END: "Semester End",
  INTERNAL_EXAMINATION: "Internal Examination",
  FINAL_EXAMINATION: "Final Examination",
  PRACTICAL_EXAMINATION: "Practical Examination",
  ADMISSION: "Admission",
  ORIENTATION: "Orientation",
  SPORTS_WEEK: "Sports Week",
  CULTURAL_PROGRAM: "Cultural Program",
  WORKSHOP: "Workshop",
  SEMINAR: "Seminar",
  INDUSTRIAL_VISIT: "Industrial Visit",
  PROJECT_SUBMISSION: "Project Submission",
  VIVA: "Viva",
  RESULT_PUBLICATION: "Result Publication",
  GRADUATION: "Graduation",
  PARENT_MEETING: "Parent Meeting",
  FACULTY_MEETING: "Faculty Meeting",
  OTHER: "Other"
};

export const ACADEMIC_CALENDAR_EVENT_TYPE_COLORS: Record<AcademicCalendarEventType, string> = {
  PUBLIC_HOLIDAY: "#dc2626",
  NATIONAL_HOLIDAY: "#b91c1c",
  FESTIVAL: "#ef4444",
  COLLEGE_HOLIDAY: "#f87171",
  ACADEMIC_EVENT: "#2563eb",
  SEMESTER_START: "#059669",
  SEMESTER_END: "#0d9488",
  INTERNAL_EXAMINATION: "#7c3aed",
  FINAL_EXAMINATION: "#6d28d9",
  PRACTICAL_EXAMINATION: "#8b5cf6",
  ADMISSION: "#0891b2",
  ORIENTATION: "#0284c7",
  SPORTS_WEEK: "#d97706",
  CULTURAL_PROGRAM: "#ea580c",
  WORKSHOP: "#4f46e5",
  SEMINAR: "#4338ca",
  INDUSTRIAL_VISIT: "#0f766e",
  PROJECT_SUBMISSION: "#be185d",
  VIVA: "#a21caf",
  RESULT_PUBLICATION: "#15803d",
  GRADUATION: "#1d4ed8",
  PARENT_MEETING: "#ca8a04",
  FACULTY_MEETING: "#64748b",
  OTHER: "#475569"
};

export interface AcademicCalendarAuditTrail {
  createdBy?: string;
  createdByName?: string;
  updatedBy?: string;
  updatedByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AcademicCalendarEventRecord {
  _id: string;
  schoolId: string;
  academicYearBs: string;
  dateBs: string;
  dateAd: string;
  dayOfWeek: string;
  name: string;
  eventType: AcademicCalendarEventType;
  reason?: string;
  isHoliday: boolean;
  audit?: AcademicCalendarAuditTrail;
}

export interface AcademicCalendarEventInput {
  academicYearBs: string;
  dateBs: string;
  name: string;
  eventType: AcademicCalendarEventType;
  reason?: string;
}

export interface AcademicCalendarFilters {
  academicYearBs?: string;
  monthBs?: string;
  eventType?: AcademicCalendarEventType;
  keyword?: string;
  dateFromBs?: string;
  dateToBs?: string;
  dateAd?: string;
}

export interface AcademicCalendarDashboard {
  todayBs: string;
  todayAd: string;
  academicYearBs: string;
  upcomingHolidays: AcademicCalendarEventRecord[];
  upcomingAcademicEvents: AcademicCalendarEventRecord[];
  upcomingExaminations: AcademicCalendarEventRecord[];
}

export const isHolidayEventType = (eventType: AcademicCalendarEventType): boolean =>
  HOLIDAY_EVENT_TYPES.includes(eventType);

export const parseAcademicYearStart = (academicYearBs: string): number => {
  const [startYear] = academicYearBs.split("/");
  const year = Number(startYear);
  return Number.isFinite(year) && year > 2000 ? year : new Date().getFullYear() - 57;
};

export const formatAcademicYearLabel = (academicYearBs: string): string => `${academicYearBs} BS`;