import type {
  ACADEMIC_PROMOTION_OUTCOMES,
  ACADEMIC_PROMOTION_STATUSES,
  STUDENT_ACADEMIC_STATUSES
} from "./constants.js";

export type StudentAcademicStatus = (typeof STUDENT_ACADEMIC_STATUSES)[number];
export type AcademicPromotionStatus = (typeof ACADEMIC_PROMOTION_STATUSES)[number];
export type AcademicPromotionOutcome = (typeof ACADEMIC_PROMOTION_OUTCOMES)[number];

export interface AcademicPromotionStudentSnapshot {
  studentId: string;
  admissionNumber: string;
  fullName?: string;
  previousYearId?: string;
  previousYearName?: string;
  previousLevel?: number;
  newYearId?: string;
  newYearName?: string;
  newLevel?: number;
  previousStatus: StudentAcademicStatus;
  newStatus: StudentAcademicStatus;
  batchId: string;
  batchName: string;
  outcome: AcademicPromotionOutcome;
}

export interface AcademicPromotionGroupSummary {
  batchId: string;
  batchName: string;
  previousYearId?: string;
  previousYearName: string;
  previousLevel: number;
  newYearId?: string;
  newYearName: string;
  newLevel?: number;
  outcome: AcademicPromotionOutcome;
  studentCount: number;
  students: AcademicPromotionStudentSnapshot[];
}

export interface AcademicPromotionPreview {
  academicSessionBs: string;
  canPromote: boolean;
  totalStudents: number;
  groups: AcademicPromotionGroupSummary[];
  validationErrors: string[];
  validationWarnings: string[];
  existingPromotionId?: string;
  batchesDetected: number;
  feeStructuresToEnsure: number;
}

export interface AcademicPromotionRecord {
  _id: string;
  schoolId: string;
  academicSessionBs: string;
  promotionDate: string;
  promotedBy: string;
  promotedByName: string;
  remarks?: string;
  status: AcademicPromotionStatus;
  totalStudents: number;
  groups: AcademicPromotionGroupSummary[];
  rolledBackAt?: string;
  rolledBackBy?: string;
  rolledBackByName?: string;
  rollbackRemarks?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AcademicPromotionExecuteResult {
  promotion: AcademicPromotionRecord;
  message: string;
}

export interface AcademicPromotionRollbackResult {
  promotion: AcademicPromotionRecord;
  restoredStudents: number;
  message: string;
}
