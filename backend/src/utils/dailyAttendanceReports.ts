import type { DailyAttendanceStatus } from "@phit-erp/shared";
import { Batch } from "../models/Batch.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { Student } from "../models/Student.js";
import { Teacher } from "../models/Teacher.js";
import { Year } from "../models/Year.js";

type AttendanceEntry = { studentId: { toString(): string }; status: DailyAttendanceStatus; remarks?: string };
export type ReportAttendanceRecord = {
  _id: { toString(): string };
  dateBs: string;
  classId?: { toString(): string } | null;
  sectionId?: { toString(): string } | null;
  batchId?: { toString(): string } | null;
  yearId?: { toString(): string } | null;
  teacherId: { toString(): string };
  entries: AttendanceEntry[];
  status: string;
};

export interface StatusCounts {
  total: number;
  present: number;
  absent: number;
  late: number;
  leave: number;
  medicalLeave: number;
}

export const countEntryStatuses = (entries: AttendanceEntry[]): StatusCounts => {
  const counts: StatusCounts = {
    total: entries.length,
    present: 0,
    absent: 0,
    late: 0,
    leave: 0,
    medicalLeave: 0
  };

  entries.forEach((entry) => {
    if (entry.status === "PRESENT") counts.present += 1;
    if (entry.status === "ABSENT") counts.absent += 1;
    if (entry.status === "LATE") counts.late += 1;
    if (entry.status === "LEAVE") counts.leave += 1;
    if (entry.status === "MEDICAL_LEAVE") counts.medicalLeave += 1;
  });

  return counts;
};

export const attendancePercentage = (counts: StatusCounts): number =>
  counts.total === 0 ? 0 : Number((((counts.present + counts.late) / counts.total) * 100).toFixed(2));

export const aggregateRecords = (records: ReportAttendanceRecord[]): StatusCounts => {
  return records.reduce<StatusCounts>(
    (acc, record) => {
      const counts = countEntryStatuses(record.entries);
      return {
        total: acc.total + counts.total,
        present: acc.present + counts.present,
        absent: acc.absent + counts.absent,
        late: acc.late + counts.late,
        leave: acc.leave + counts.leave,
        medicalLeave: acc.medicalLeave + counts.medicalLeave
      };
    },
    { total: 0, present: 0, absent: 0, late: 0, leave: 0, medicalLeave: 0 }
  );
};

export const buildDailyTrend = (records: ReportAttendanceRecord[], limit = 14) => {
  const map = new Map<string, StatusCounts>();
  records.forEach((record) => {
    const current = map.get(record.dateBs) ?? {
      total: 0,
      present: 0,
      absent: 0,
      late: 0,
      leave: 0,
      medicalLeave: 0
    };
    const counts = countEntryStatuses(record.entries);
    map.set(record.dateBs, {
      total: current.total + counts.total,
      present: current.present + counts.present,
      absent: current.absent + counts.absent,
      late: current.late + counts.late,
      leave: current.leave + counts.leave,
      medicalLeave: current.medicalLeave + counts.medicalLeave
    });
  });

  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-limit)
    .map(([dateBs, counts]) => ({
      dateBs,
      present: counts.present,
      absent: counts.absent,
      late: counts.late,
      leave: counts.leave
    }));
};

export const buildMonthlyTrend = (records: ReportAttendanceRecord[]) => {
  const map = new Map<string, StatusCounts>();
  records.forEach((record) => {
    const month = record.dateBs.slice(0, 7);
    const current = map.get(month) ?? {
      total: 0,
      present: 0,
      absent: 0,
      late: 0,
      leave: 0,
      medicalLeave: 0
    };
    const counts = countEntryStatuses(record.entries);
    map.set(month, {
      total: current.total + counts.total,
      present: current.present + counts.present,
      absent: current.absent + counts.absent,
      late: current.late + counts.late,
      leave: current.leave + counts.leave,
      medicalLeave: current.medicalLeave + counts.medicalLeave
    });
  });

  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-12)
    .map(([month, counts]) => ({
      month,
      present: counts.present,
      absent: counts.absent
    }));
};

export const buildWeeklyTrend = (records: ReportAttendanceRecord[]) => {
  const map = new Map<string, StatusCounts>();

  records.forEach((record) => {
    const [year, month, day] = record.dateBs.split("-").map(Number);
    const weekIndex = Math.ceil((day ?? 1) / 7);
    const weekKey = `${year}-${String(month).padStart(2, "0")}-W${weekIndex}`;
    const current = map.get(weekKey) ?? {
      total: 0,
      present: 0,
      absent: 0,
      late: 0,
      leave: 0,
      medicalLeave: 0
    };
    const counts = countEntryStatuses(record.entries);
    map.set(weekKey, {
      total: current.total + counts.total,
      present: current.present + counts.present,
      absent: current.absent + counts.absent,
      late: current.late + counts.late,
      leave: current.leave + counts.leave,
      medicalLeave: current.medicalLeave + counts.medicalLeave
    });
  });

  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-8)
    .map(([week, counts]) => ({
      week,
      present: counts.present,
      absent: counts.absent
    }));
};

export const getGroupKey = (record: ReportAttendanceRecord, college: boolean): string =>
  college
    ? `${record.batchId?.toString() ?? ""}-${record.yearId?.toString() ?? ""}`
    : `${record.classId?.toString() ?? ""}-${record.sectionId?.toString() ?? ""}`;

export const loadAcademicLabels = async (records: ReportAttendanceRecord[], college: boolean) => {
  const classIds = records.map((r) => r.classId).filter(Boolean);
  const sectionIds = records.map((r) => r.sectionId).filter(Boolean);
  const batchIds = records.map((r) => r.batchId).filter(Boolean);
  const yearIds = records.map((r) => r.yearId).filter(Boolean);
  const teacherIds = records.map((r) => r.teacherId).filter(Boolean);

  const [classes, sections, batches, years, teachers] = await Promise.all([
    college ? [] : SchoolClass.find({ _id: { $in: classIds } }).lean(),
    college ? [] : Section.find({ _id: { $in: sectionIds } }).lean(),
    college ? Batch.find({ _id: { $in: batchIds } }).lean() : [],
    college ? Year.find({ _id: { $in: yearIds } }).lean() : [],
    Teacher.find({ _id: { $in: teacherIds } }).populate("user", "fullName").lean()
  ]);

  const classMap = new Map(classes.map((item) => [item._id.toString(), item.name]));
  const sectionMap = new Map(sections.map((item) => [item._id.toString(), item.name]));
  const batchMap = new Map(batches.map((item) => [item._id.toString(), item.name]));
  const yearMap = new Map(years.map((item) => [item._id.toString(), item.name]));
  const teacherMap = new Map(
    teachers.map((item) => [
      item._id.toString(),
      (item as { user?: { fullName?: string } }).user?.fullName ?? "Teacher"
    ])
  );

  const labelForRecord = (record: ReportAttendanceRecord): string => {
    if (college) {
      const batch = batchMap.get(record.batchId?.toString() ?? "") ?? "Batch";
      const year = yearMap.get(record.yearId?.toString() ?? "") ?? "Year";
      return `${batch} · ${year}`;
    }
    const className = classMap.get(record.classId?.toString() ?? "") ?? "Class";
    const section = sectionMap.get(record.sectionId?.toString() ?? "") ?? "Section";
    return `${className} · ${section}`;
  };

  return { labelForRecord, teacherMap };
};

export const buildClassWiseSummary = async (records: ReportAttendanceRecord[], college: boolean) => {
  const { labelForRecord } = await loadAcademicLabels(records, college);
  const map = new Map<string, { label: string; counts: StatusCounts }>();

  records.forEach((record) => {
    const key = getGroupKey(record, college);
    const current = map.get(key) ?? {
      label: labelForRecord(record),
      counts: { total: 0, present: 0, absent: 0, late: 0, leave: 0, medicalLeave: 0 }
    };
    const counts = countEntryStatuses(record.entries);
    map.set(key, {
      label: current.label,
      counts: {
        total: current.counts.total + counts.total,
        present: current.counts.present + counts.present,
        absent: current.counts.absent + counts.absent,
        late: current.counts.late + counts.late,
        leave: current.counts.leave + counts.leave,
        medicalLeave: current.counts.medicalLeave + counts.medicalLeave
      }
    });
  });

  return [...map.values()]
    .map(({ label, counts }) => ({
      label,
      present: counts.present,
      absent: counts.absent,
      percentage: attendancePercentage(counts)
    }))
    .sort((left, right) => right.percentage - left.percentage);
};

export const buildTeacherWiseSummary = async (records: ReportAttendanceRecord[], college: boolean) => {
  const { teacherMap } = await loadAcademicLabels(records, college);
  const map = new Map<string, { classesMarked: number; counts: StatusCounts }>();

  records.forEach((record) => {
    const teacherId = record.teacherId.toString();
    const current = map.get(teacherId) ?? {
      classesMarked: 0,
      counts: { total: 0, present: 0, absent: 0, late: 0, leave: 0, medicalLeave: 0 }
    };
    const counts = countEntryStatuses(record.entries);
    map.set(teacherId, {
      classesMarked: current.classesMarked + 1,
      counts: {
        total: current.counts.total + counts.total,
        present: current.counts.present + counts.present,
        absent: current.counts.absent + counts.absent,
        late: current.counts.late + counts.late,
        leave: current.counts.leave + counts.leave,
        medicalLeave: current.counts.medicalLeave + counts.medicalLeave
      }
    });
  });

  return [...map.entries()]
    .map(([teacherId, value]) => ({
      teacherName: teacherMap.get(teacherId) ?? "Teacher",
      classesMarked: value.classesMarked,
      percentage: attendancePercentage(value.counts)
    }))
    .sort((left, right) => right.classesMarked - left.classesMarked);
};

export const buildStudentWiseReport = async (
  records: ReportAttendanceRecord[],
  schoolId: string,
  threshold = 75
) => {
  const studentIds = new Set<string>();
  const stats = new Map<string, StatusCounts>();

  records.forEach((record) => {
    record.entries.forEach((entry) => {
      const studentId = entry.studentId.toString();
      studentIds.add(studentId);
      const current = stats.get(studentId) ?? {
        total: 0,
        present: 0,
        absent: 0,
        late: 0,
        leave: 0,
        medicalLeave: 0
      };
      current.total += 1;
      if (entry.status === "PRESENT") current.present += 1;
      if (entry.status === "ABSENT") current.absent += 1;
      if (entry.status === "LATE") current.late += 1;
      if (entry.status === "LEAVE") current.leave += 1;
      if (entry.status === "MEDICAL_LEAVE") current.medicalLeave += 1;
      stats.set(studentId, current);
    });
  });

  const students = await Student.find({ _id: { $in: [...studentIds] }, schoolId })
    .populate("user", "fullName")
    .lean();

  const rows = students.map((student) => {
    const counts = stats.get(student._id.toString()) ?? {
      total: 0,
      present: 0,
      absent: 0,
      late: 0,
      leave: 0,
      medicalLeave: 0
    };
    const percentage = attendancePercentage(counts);
    return {
      studentId: student._id.toString(),
      fullName: (student as { user?: { fullName?: string } }).user?.fullName ?? "Student",
      rollNumber: student.rollNumber,
      admissionNumber: student.admissionNumber,
      totalDays: counts.total,
      present: counts.present,
      absent: counts.absent,
      late: counts.late,
      leave: counts.leave,
      medicalLeave: counts.medicalLeave,
      percentage,
      isDefaulter: percentage < threshold
    };
  });

  return rows.sort((left, right) => left.percentage - right.percentage);
};

export const buildStatusReport = (records: ReportAttendanceRecord[], status: DailyAttendanceStatus) => {
  const rows: Array<{
    dateBs: string;
    studentId: string;
    status: DailyAttendanceStatus;
    remarks?: string;
    recordId: string;
  }> = [];

  records.forEach((record) => {
    record.entries
      .filter((entry) => entry.status === status)
      .forEach((entry) => {
        rows.push({
          dateBs: record.dateBs,
          studentId: entry.studentId.toString(),
          status: entry.status,
          remarks: entry.remarks,
          recordId: record._id.toString()
        });
      });
  });

  return rows;
};