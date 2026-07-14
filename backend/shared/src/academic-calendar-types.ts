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

/**
 * Primary event categories shown in admin UI.
 * Legacy types remain in ACADEMIC_CALENDAR_EVENT_TYPES for existing records.
 */
export const PRIMARY_ACADEMIC_CALENDAR_EVENT_TYPES = [
  "PUBLIC_HOLIDAY",
  "FESTIVAL_HOLIDAY",
  "SUMMER_VACATION",
  "WINTER_VACATION",
  "DASHAIN_VACATION",
  "TIHAR_VACATION",
  "EXAMINATION_WEEK",
  "INTERNAL_EXAMINATION",
  "PRACTICAL_EXAMINATION",
  "ORIENTATION_PROGRAM",
  "COLLEGE_PROGRAM",
  "SPORTS_WEEK",
  "EDUCATIONAL_TOUR",
  "SEMINAR_WORKSHOP",
  "FIELD_HOSPITAL_DUTY",
  "WORKING_DAY",
  "OTHER"
] as const;

/** Full enum accepted by API/DB (includes legacy values). */
export const ACADEMIC_CALENDAR_EVENT_TYPES = [
  ...PRIMARY_ACADEMIC_CALENDAR_EVENT_TYPES,
  // Legacy — kept so existing documents remain valid
  "NATIONAL_HOLIDAY",
  "FESTIVAL",
  "COLLEGE_HOLIDAY",
  "ACADEMIC_EVENT",
  "SEMESTER_START",
  "SEMESTER_END",
  "FINAL_EXAMINATION",
  "ADMISSION",
  "ORIENTATION",
  "CULTURAL_PROGRAM",
  "WORKSHOP",
  "SEMINAR",
  "INDUSTRIAL_VISIT",
  "PROJECT_SUBMISSION",
  "VIVA",
  "RESULT_PUBLICATION",
  "GRADUATION",
  "PARENT_MEETING",
  "FACULTY_MEETING"
] as const;

export type AcademicCalendarEventType = (typeof ACADEMIC_CALENDAR_EVENT_TYPES)[number];
export type PrimaryAcademicCalendarEventType = (typeof PRIMARY_ACADEMIC_CALENDAR_EVENT_TYPES)[number];

export const ACADEMIC_CALENDAR_EVENT_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type AcademicCalendarEventStatus = (typeof ACADEMIC_CALENDAR_EVENT_STATUSES)[number];

export const HOLIDAY_EVENT_TYPES: AcademicCalendarEventType[] = [
  "PUBLIC_HOLIDAY",
  "FESTIVAL_HOLIDAY",
  "SUMMER_VACATION",
  "WINTER_VACATION",
  "DASHAIN_VACATION",
  "TIHAR_VACATION",
  "NATIONAL_HOLIDAY",
  "FESTIVAL",
  "COLLEGE_HOLIDAY"
];

export const VACATION_EVENT_TYPES: AcademicCalendarEventType[] = [
  "SUMMER_VACATION",
  "WINTER_VACATION",
  "DASHAIN_VACATION",
  "TIHAR_VACATION",
  "COLLEGE_HOLIDAY"
];

export const EXAMINATION_EVENT_TYPES: AcademicCalendarEventType[] = [
  "EXAMINATION_WEEK",
  "INTERNAL_EXAMINATION",
  "PRACTICAL_EXAMINATION",
  "FINAL_EXAMINATION",
  "VIVA"
];

export const ACADEMIC_EVENT_TYPES: AcademicCalendarEventType[] = [
  "ORIENTATION_PROGRAM",
  "COLLEGE_PROGRAM",
  "SPORTS_WEEK",
  "EDUCATIONAL_TOUR",
  "SEMINAR_WORKSHOP",
  "FIELD_HOSPITAL_DUTY",
  "ACADEMIC_EVENT",
  "SEMESTER_START",
  "SEMESTER_END",
  "ADMISSION",
  "ORIENTATION",
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
  FESTIVAL_HOLIDAY: "Festival Holiday",
  SUMMER_VACATION: "Summer Vacation",
  WINTER_VACATION: "Winter Vacation",
  DASHAIN_VACATION: "Dashain Vacation",
  TIHAR_VACATION: "Tihar Vacation",
  EXAMINATION_WEEK: "Examination Week",
  INTERNAL_EXAMINATION: "Internal Examination",
  PRACTICAL_EXAMINATION: "Practical Examination",
  ORIENTATION_PROGRAM: "Orientation Program",
  COLLEGE_PROGRAM: "College Program",
  SPORTS_WEEK: "Sports Week",
  EDUCATIONAL_TOUR: "Educational Tour",
  SEMINAR_WORKSHOP: "Seminar / Workshop",
  FIELD_HOSPITAL_DUTY: "Field/Hospital Duty",
  WORKING_DAY: "Working Day (Override)",
  OTHER: "Other",
  // Legacy labels
  NATIONAL_HOLIDAY: "National Holiday",
  FESTIVAL: "Festival Holiday",
  COLLEGE_HOLIDAY: "College Holiday",
  ACADEMIC_EVENT: "Academic Event",
  SEMESTER_START: "Semester Start",
  SEMESTER_END: "Semester End",
  FINAL_EXAMINATION: "Final Examination",
  ADMISSION: "Admission",
  ORIENTATION: "Orientation Program",
  CULTURAL_PROGRAM: "College Program",
  WORKSHOP: "Seminar / Workshop",
  SEMINAR: "Seminar / Workshop",
  INDUSTRIAL_VISIT: "Educational Tour",
  PROJECT_SUBMISSION: "Other",
  VIVA: "Practical Examination",
  RESULT_PUBLICATION: "Other",
  GRADUATION: "College Program",
  PARENT_MEETING: "Other",
  FACULTY_MEETING: "Other"
};

export const ACADEMIC_CALENDAR_EVENT_TYPE_COLORS: Record<AcademicCalendarEventType, string> = {
  PUBLIC_HOLIDAY: "#dc2626",
  FESTIVAL_HOLIDAY: "#ef4444",
  SUMMER_VACATION: "#f59e0b",
  WINTER_VACATION: "#38bdf8",
  DASHAIN_VACATION: "#f97316",
  TIHAR_VACATION: "#eab308",
  EXAMINATION_WEEK: "#7c3aed",
  INTERNAL_EXAMINATION: "#8b5cf6",
  PRACTICAL_EXAMINATION: "#a78bfa",
  ORIENTATION_PROGRAM: "#0284c7",
  COLLEGE_PROGRAM: "#2563eb",
  SPORTS_WEEK: "#d97706",
  EDUCATIONAL_TOUR: "#0f766e",
  SEMINAR_WORKSHOP: "#4f46e5",
  FIELD_HOSPITAL_DUTY: "#334155",
  WORKING_DAY: "#16a34a",
  OTHER: "#475569",
  // Legacy colors
  NATIONAL_HOLIDAY: "#b91c1c",
  FESTIVAL: "#ef4444",
  COLLEGE_HOLIDAY: "#f87171",
  ACADEMIC_EVENT: "#2563eb",
  SEMESTER_START: "#059669",
  SEMESTER_END: "#0d9488",
  FINAL_EXAMINATION: "#6d28d9",
  ADMISSION: "#0891b2",
  ORIENTATION: "#0284c7",
  CULTURAL_PROGRAM: "#ea580c",
  WORKSHOP: "#4f46e5",
  SEMINAR: "#4338ca",
  INDUSTRIAL_VISIT: "#0f766e",
  PROJECT_SUBMISSION: "#be185d",
  VIVA: "#a21caf",
  RESULT_PUBLICATION: "#15803d",
  GRADUATION: "#1d4ed8",
  PARENT_MEETING: "#ca8a04",
  FACULTY_MEETING: "#64748b"
};

/** Compact legend groups for the calendar footer. */
export const ACADEMIC_CALENDAR_LEGEND_GROUPS = [
  { key: "public_holiday", label: "Public Holiday", color: "#dc2626", types: ["PUBLIC_HOLIDAY", "NATIONAL_HOLIDAY"] as AcademicCalendarEventType[] },
  { key: "festival", label: "Festival Holiday", color: "#ef4444", types: ["FESTIVAL_HOLIDAY", "FESTIVAL"] as AcademicCalendarEventType[] },
  {
    key: "vacation",
    label: "Vacation",
    color: "#f59e0b",
    types: ["SUMMER_VACATION", "WINTER_VACATION", "DASHAIN_VACATION", "TIHAR_VACATION", "COLLEGE_HOLIDAY"] as AcademicCalendarEventType[]
  },
  {
    key: "examination",
    label: "Examination",
    color: "#7c3aed",
    types: ["EXAMINATION_WEEK", "INTERNAL_EXAMINATION", "PRACTICAL_EXAMINATION", "FINAL_EXAMINATION", "VIVA"] as AcademicCalendarEventType[]
  },
  {
    key: "college_event",
    label: "College Event",
    color: "#2563eb",
    types: [
      "ORIENTATION_PROGRAM",
      "COLLEGE_PROGRAM",
      "SPORTS_WEEK",
      "EDUCATIONAL_TOUR",
      "ACADEMIC_EVENT",
      "ORIENTATION",
      "CULTURAL_PROGRAM",
      "GRADUATION"
    ] as AcademicCalendarEventType[]
  },
  {
    key: "seminar",
    label: "Seminar",
    color: "#4f46e5",
    types: ["SEMINAR_WORKSHOP", "SEMINAR", "WORKSHOP"] as AcademicCalendarEventType[]
  },
  {
    key: "field_duty",
    label: "Field/Hospital Duty",
    color: "#334155",
    types: ["FIELD_HOSPITAL_DUTY"] as AcademicCalendarEventType[]
  },
  {
    key: "working_day",
    label: "Working Day",
    color: "#16a34a",
    types: ["WORKING_DAY"] as AcademicCalendarEventType[]
  }
] as const;

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
  /** Start date (BS). Also used as the primary date for single-day events. */
  dateBs: string;
  startDateBs: string;
  endDateBs: string;
  dateAd: string;
  startDateAd: string;
  endDateAd: string;
  dayOfWeek: string;
  name: string;
  eventType: AcademicCalendarEventType;
  reason?: string;
  isHoliday: boolean;
  /** Inclusive day count between start and end. */
  totalDays: number;
  status: AcademicCalendarEventStatus;
  /** True for auto-generated Saturday public holidays (not stored in DB). */
  isSystemGenerated?: boolean;
  /** Admin marked this Saturday (or other holiday) as a working day. */
  isWorkingDayOverride?: boolean;
  audit?: AcademicCalendarAuditTrail;
}

export interface AcademicCalendarEventInput {
  academicYearBs: string;
  /** Single date or range start (BS YYYY-MM-DD). */
  startDateBs: string;
  /** Range end; omit or equal startDateBs for single-day events. */
  endDateBs?: string;
  /** @deprecated Prefer startDateBs — kept for older clients. */
  dateBs?: string;
  name: string;
  eventType: AcademicCalendarEventType;
  reason?: string;
  status?: AcademicCalendarEventStatus;
}

export interface AcademicCalendarFilters {
  academicYearBs?: string;
  monthBs?: string;
  eventType?: AcademicCalendarEventType;
  keyword?: string;
  dateFromBs?: string;
  dateToBs?: string;
  dateAd?: string;
  status?: AcademicCalendarEventStatus;
  /** When true, omit auto-generated Saturday holidays from the list. */
  excludeSystemGenerated?: boolean;
}

export interface AcademicCalendarDashboard {
  todayBs: string;
  todayAd: string;
  academicYearBs: string;
  /** Events active on today's date (including auto Saturday). */
  todayEvents: AcademicCalendarEventRecord[];
  upcomingHolidays: AcademicCalendarEventRecord[];
  upcomingAcademicEvents: AcademicCalendarEventRecord[];
  upcomingExaminations: AcademicCalendarEventRecord[];
  /** Multi-day events currently in progress. */
  activeMultiDayEvents: AcademicCalendarEventRecord[];
}

export const isHolidayEventType = (eventType: AcademicCalendarEventType): boolean =>
  HOLIDAY_EVENT_TYPES.includes(eventType);

export const isVacationEventType = (eventType: AcademicCalendarEventType): boolean =>
  VACATION_EVENT_TYPES.includes(eventType);

/** Types that block attendance (public holidays + vacations). Working-day override never blocks. */
export const isAttendanceBlockingEventType = (eventType: AcademicCalendarEventType): boolean =>
  eventType !== "WORKING_DAY" && isHolidayEventType(eventType);

export const resolveIsHoliday = (eventType: AcademicCalendarEventType): boolean => {
  if (eventType === "WORKING_DAY") return false;
  return isHolidayEventType(eventType);
};

export const parseAcademicYearStart = (academicYearBs: string): number => {
  const [startYear] = academicYearBs.split("/");
  const year = Number(startYear);
  return Number.isFinite(year) && year > 2000 ? year : new Date().getFullYear() - 57;
};

export const formatAcademicYearLabel = (academicYearBs: string): string => `${academicYearBs} BS`;

export const eventOverlapsDate = (
  event: Pick<AcademicCalendarEventRecord, "startDateBs" | "endDateBs" | "dateBs">,
  dateBs: string
): boolean => {
  const start = event.startDateBs || event.dateBs;
  const end = event.endDateBs || event.dateBs;
  return dateBs >= start && dateBs <= end;
};
