export type FieldDutyScheduleStatus = "ACTIVE" | "COMPLETED" | "CANCELLED";

export type FieldDutyAttendanceStatus = "DRAFT" | "SUBMITTED" | "LOCKED";

export type FieldDutyStudentStatus =
  | "PRESENT"
  | "ABSENT"
  | "LATE"
  | "LEAVE"
  | "EMERGENCY_DUTY";

export type FieldDutyShift = "MORNING" | "DAY" | "EVENING" | "NIGHT" | "FULL_DAY";

export interface FieldDutyScheduleRecord {
  _id: string;
  schoolId: string;
  academicYearBs: string;
  faculty?: string;
  batchId: string;
  yearId: string;
  sectionId?: string;
  hospitalName: string;
  department: string;
  ward?: string;
  /** College staff assigned as field supervisor (not Teacher). */
  supervisorStaffId: string;
  /** @deprecated Legacy teacher-based supervisor id if present on old rows */
  supervisorTeacherId?: string;
  clinicalInstructorName?: string;
  hospitalSupervisorName?: string;
  startDateBs: string;
  endDateBs: string;
  shift: FieldDutyShift;
  remarks?: string;
  status: FieldDutyScheduleStatus;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  batch?: { _id: string; name: string };
  year?: { _id: string; name: string; level?: number };
  supervisor?: {
    _id: string;
    staffId?: string;
    designation?: string;
    fullName?: string;
    user?: { fullName: string };
  };
  studentCount?: number;
}

export interface FieldDutyAttendanceEntryRecord {
  studentId: string;
  status: FieldDutyStudentStatus;
  remarks?: string;
  student?: {
    _id: string;
    fullName?: string;
    admissionNumber?: string;
    rollNumber?: number;
  };
}

export interface FieldDutyAttendanceRecord {
  _id: string;
  schoolId: string;
  scheduleId: string;
  dateBs: string;
  hospitalName: string;
  department: string;
  ward?: string;
  shift: FieldDutyShift;
  batchId: string;
  yearId: string;
  supervisorStaffId: string;
  /** @deprecated Legacy teacher-based supervisor id if present on old rows */
  supervisorTeacherId?: string;
  entries: FieldDutyAttendanceEntryRecord[];
  notes?: string;
  status: FieldDutyAttendanceStatus;
  submittedBy?: string;
  submittedAt?: string;
  unlockedBy?: string;
  unlockedAt?: string;
  unlockReason?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  schedule?: FieldDutyScheduleRecord;
  summary?: {
    present: number;
    absent: number;
    late: number;
    leave: number;
    emergencyDuty: number;
    total: number;
  };
}

export interface FieldDutyRosterStudent {
  _id: string;
  fullName: string;
  admissionNumber: string;
  rollNumber: number;
  batchId?: string;
  yearId?: string;
}

export interface FieldDutyDashboard {
  studentsOnDutyToday: number;
  present: number;
  absent: number;
  late: number;
  leave: number;
  emergencyDuty: number;
  pendingSubmissions: number;
  submittedToday: number;
  hospitalWise: Array<{ hospital: string; present: number; absent: number; total: number }>;
  supervisorWise: Array<{
    supervisorId: string;
    supervisorName: string;
    present: number;
    absent: number;
    total: number;
  }>;
  myAssignments?: Array<{
    scheduleId: string;
    hospitalName: string;
    department: string;
    batchName?: string;
    yearName?: string;
    studentCount: number;
    attendanceStatus?: FieldDutyAttendanceStatus | "NONE";
  }>;
}

export interface FieldDutyPortalRow {
  _id: string;
  dateBs: string;
  hospitalName: string;
  department: string;
  ward?: string;
  shift: FieldDutyShift;
  supervisorName?: string;
  status: FieldDutyStudentStatus;
  remarks?: string;
  attendanceRecordStatus: FieldDutyAttendanceStatus;
}

export interface FieldDutyPortalSummary {
  rows: FieldDutyPortalRow[];
  present: number;
  absent: number;
  late: number;
  leave: number;
  emergencyDuty: number;
  totalMarked: number;
  attendancePercent: number;
}
