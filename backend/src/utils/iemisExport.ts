import { Student } from "../models/Student.js";
import { Teacher } from "../models/Teacher.js";
import { Setting } from "../models/Setting.js";
import { Exam } from "../models/Exam.js";
import { Result } from "../models/Result.js";
import { Attendance } from "../models/Attendance.js";
import type { Request } from "express";
import { tenantObjectId } from "./tenant.js";

/**
 * IEMIS Export Service - Expanded Version
 * 
 * Supports key parts of Nepal's IEMIS / Flash Reports (CEHRD):
 * - Flash I: Student enrollment, Teacher data, Infrastructure
 * - Flash II: Performance indicators (promotion, results, attendance)
 */

export interface StudentMasterRow {
  admissionNumber: string;
  fullName: string;
  gender: string;
  dateOfBirthBs: string;
  className: string;
  sectionName: string;
  rollNumber: number;
  disabilityCategory: string;
  ethnicityCategory: string;
  fatherPhone: string;
  motherPhone: string;
  guardianName: string;
  guardianPhone: string;
  address: string;
  feesDueNpr: number;
}

export interface TeacherMasterRow {
  teacherCode: string;
  fullName: string;
  gender?: string;
  qualification: string;
  joinedDateBs: string;
  subjects: string;
  basicSalaryNpr: number;
}

export interface InfrastructureRow {
  schoolId: string;
  academicYearBs: string;
  classrooms: number;
  usableClassrooms: number;
  toiletsMale: number;
  toiletsFemale: number;
  toiletsDisabled: number;
  drinkingWater: boolean;
  electricity: boolean;
  internet: boolean;
  libraryBooks: number;
  hasScienceLab: boolean;
  hasComputerLab: boolean;
  hasPlayground: boolean;
  hasRamp: boolean;
  midDayMeal: boolean;
}

export interface FlashIIPerformance {
  academicYearBs: string;
  totalStudents: number;
  averageAttendanceRate: number; // percentage
  examParticipation: number;
  averageGpa: number;
  promotionRateEstimate: number; // rough proxy
  topPerformersCount: number;
  studentsWithLowPerformance: number;
}

/**
 * Student Master Export (existing + refined)
 */
export async function generateStudentMasterExport(req: Request): Promise<StudentMasterRow[]> {
  const schoolId = tenantObjectId(req);

  const students = await Student.find({ schoolId })
    .populate("classId", "name")
    .populate("sectionId", "name")
    .populate("batchId", "name")
    .populate("yearId", "name")
    .populate("user", "fullName")
    .lean();

  return students.map((s: any) => ({
    admissionNumber: s.admissionNumber,
    fullName: s.user?.fullName || "",
    gender: s.gender,
    dateOfBirthBs: s.dateOfBirthBs,
    className: s.batchId?.name || s.classId?.name || "",
    sectionName: s.yearId?.name || s.sectionId?.name || "",
    rollNumber: s.rollNumber,
    disabilityCategory: s.disabilityCategory || "None",
    ethnicityCategory: s.ethnicityCategory || "Other",
    fatherPhone: s.fatherPhone || "",
    motherPhone: s.motherPhone || "",
    guardianName: s.guardianName,
    guardianPhone: s.guardianPhone,
    address: `${s.address?.municipality || ""}, Ward ${s.address?.ward || ""}`,
    feesDueNpr: s.feesDueNpr || 0
  }));
}

/**
 * Teacher Data Export (new)
 */
export async function generateTeacherMasterExport(req: Request): Promise<TeacherMasterRow[]> {
  const schoolId = tenantObjectId(req);

  const teachers = await Teacher.find({ schoolId })
    .populate("user", "fullName")
    .populate("subjects", "name")
    .lean();

  return teachers.map((t: any) => ({
    teacherCode: t.teacherCode,
    fullName: t.user?.fullName || "",
    qualification: t.qualification,
    joinedDateBs: t.joinedDateBs,
    subjects: (t.subjects || []).map((s: any) => s.name).join("; ") || "",
    basicSalaryNpr: t.basicSalaryNpr || 0
  }));
}

/**
 * Infrastructure Export (new)
 */
export async function generateInfrastructureExport(req: Request): Promise<InfrastructureRow> {
  const schoolId = tenantObjectId(req);

  const setting = await Setting.findOne({ schoolId }).lean();

  const infra = (setting as any)?.infrastructure || {};

  return {
    schoolId: schoolId.toString(),
    academicYearBs: setting?.academicYearBs || "N/A",
    classrooms: infra.classrooms || 0,
    usableClassrooms: infra.usableClassrooms || 0,
    toiletsMale: infra.toiletsMale || 0,
    toiletsFemale: infra.toiletsFemale || 0,
    toiletsDisabled: infra.toiletsDisabled || 0,
    drinkingWater: !!infra.drinkingWater,
    electricity: !!infra.electricity,
    internet: !!infra.internet,
    libraryBooks: infra.libraryBooks || 0,
    hasScienceLab: !!infra.hasScienceLab,
    hasComputerLab: !!infra.hasComputerLab,
    hasPlayground: !!infra.hasPlayground,
    hasRamp: !!infra.hasRamp,
    midDayMeal: !!infra.midDayMeal
  };
}

/**
 * Improved Flash II Performance Data
 */
export async function generateFlashIIPerformance(req: Request): Promise<FlashIIPerformance> {
  const schoolId = tenantObjectId(req);

  const [studentCount, results, attendances] = await Promise.all([
    Student.countDocuments({ schoolId }),
    Result.find({ schoolId }).lean(),
    Attendance.find({ schoolId }).lean()
  ]);

  // Attendance rate
  let totalEntries = 0;
  let presentEntries = 0;
  attendances.forEach((a: any) => {
    a.entries.forEach((e: any) => {
      totalEntries++;
      if (e.status === "PRESENT") presentEntries++;
    });
  });
  const avgAttendance = totalEntries > 0 ? (presentEntries / totalEntries) * 100 : 0;

  // Exam performance
  const gpas = results.map((r: any) => r.gpa || 0).filter((g: number) => g > 0);
  const avgGpa = gpas.length > 0 ? gpas.reduce((a, b) => a + b, 0) / gpas.length : 0;

  const lowPerformers = results.filter((r: any) => (r.gpa || 0) < 1.6).length;

  return {
    academicYearBs: "Current",
    totalStudents: studentCount,
    averageAttendanceRate: Math.round(avgAttendance * 100) / 100,
    examParticipation: results.length,
    averageGpa: Math.round(avgGpa * 100) / 100,
    promotionRateEstimate: avgGpa > 2.0 ? 92 : avgGpa > 1.6 ? 78 : 65, // heuristic
    topPerformersCount: results.filter((r: any) => (r.gpa || 0) >= 3.6).length,
    studentsWithLowPerformance: lowPerformers
  };
}

/**
 * Legacy Enrollment Summary (kept for compatibility)
 */
export async function generateEnrollmentSummary(req: Request) {
  const schoolId = tenantObjectId(req);
  const students = await Student.find({ schoolId }).populate("classId", "name").lean();

  const summary: any = {
    totalStudents: students.length,
    byGender: {},
    byClass: [],
    byDisability: [],
    byEthnicity: []
  };

  students.forEach((s: any) => {
    const g = s.gender || "Unknown";
    summary.byGender[g] = (summary.byGender[g] || 0) + 1;

    const c = (s.classId as any)?.name || "Unassigned";
    const existingClass = summary.byClass.find((x: any) => x.className === c);
    if (existingClass) existingClass.count++;
    else summary.byClass.push({ className: c, count: 1 });

    const d = s.disabilityCategory || "None";
    const existingD = summary.byDisability.find((x: any) => x.category === d);
    if (existingD) existingD.count++;
    else summary.byDisability.push({ category: d, count: 1 });

    const e = s.ethnicityCategory || "Other";
    const existingE = summary.byEthnicity.find((x: any) => x.category === e);
    if (existingE) existingE.count++;
    else summary.byEthnicity.push({ category: e, count: 1 });
  });

  return summary;
}

/** CSV helper with proper escaping */
export function toCsv(rows: any[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const csvRows = [headers.join(",")];

  for (const row of rows) {
    const values = headers.map((header) => {
      let val = row[header] ?? "";
      if (typeof val === "string" && (val.includes(",") || val.includes('"') || val.includes("\n"))) {
        val = `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    });
    csvRows.push(values.join(","));
  }
  return csvRows.join("\n");
}
