import type {
  SCOPE_MODES,
  SUBJECT_ASSIGNMENT_STATUSES,
  SUBJECT_ASSIGNMENT_TYPES,
  TEACHER_MIGRATION_STATUSES
} from "./constants.js";

/** FULL | UNIT | PERCENTAGE coverage for SubjectAssignment rows */
export type SubjectAssignmentType = (typeof SUBJECT_ASSIGNMENT_TYPES)[number];
export type SubjectAssignmentStatus = (typeof SUBJECT_ASSIGNMENT_STATUSES)[number];
export type TeacherMigrationStatus = (typeof TEACHER_MIGRATION_STATUSES)[number];
export type ScopeMode = (typeof SCOPE_MODES)[number];
export type ScopeSource = "legacy" | "assignment";

export interface TeacherAssignmentPair {
  subjectId: string;
  classId?: string;
  sectionId?: string;
  batchId?: string;
  yearId?: string;
  assignmentId: string;
  assignmentType: SubjectAssignmentType;
  unitFrom?: number | null;
  unitTo?: number | null;
  assignedPercentage?: number | null;
}

/** Stable teacher academic scope — always returned by getTeacherScope / portal */
export interface TeacherScopeV2 {
  teacherId: string;
  subjectIds: string[];
  classIds: string[];
  sectionIds: string[];
  batchIds: string[];
  yearIds: string[];
  assignments: TeacherAssignmentPair[];
  academicYearBs: string;
  scopeSource: ScopeSource;
}

export interface SubjectAssignmentRecord {
  _id: string;
  schoolId: string;
  academicYearBs: string;
  faculty?: string | null;
  semesterBs?: string | null;
  classId?: string | null;
  sectionId?: string | null;
  batchId?: string | null;
  yearId?: string | null;
  subjectId: string | { _id: string; name?: string; code?: string };
  teacherId: string | { _id: string; teacherCode?: string; user?: { fullName?: string } };
  assignmentType: SubjectAssignmentType;
  unitFrom?: number | null;
  unitTo?: number | null;
  assignedPercentage?: number | null;
  effectiveFromBs: string;
  effectiveToBs?: string | null;
  status: SubjectAssignmentStatus;
  remarks?: string;
  supersedesAssignmentId?: string | null;
  supersededByAssignmentId?: string | null;
  createdBy: string;
  updatedBy?: string;
  endedBy?: string;
  endReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SubjectAssignmentWriteResult {
  rows: SubjectAssignmentRecord[];
  warnings: string[];
}

export interface SubjectAssignmentWorkloadRow {
  teacherId: string;
  teacherCode?: string;
  teacherName?: string;
  subjectId: string;
  subjectName?: string;
  classId?: string | null;
  sectionId?: string | null;
  batchId?: string | null;
  yearId?: string | null;
  assignmentType: SubjectAssignmentType;
  assignedPercentage: number;
  unitFrom?: number | null;
  unitTo?: number | null;
  unitSpan?: number | null;
}
