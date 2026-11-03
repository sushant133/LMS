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
  /** Came to class but left early — attended. */
  earlyLeave: number;
}

const emptyCounts = (): StatusCounts => ({
  total: 0,
  present: 0,
  absent: 0,
  late: 0,
  leave: 0,
  medicalLeave: 0,
  earlyLeave: 0
});

const addCounts = (a: StatusCounts, b: StatusCounts): StatusCounts => ({
  total: a.total + b.total,
  present: a.present + b.present,
  absent: a.absent + b.absent,
  late: a.late + b.late,
  leave: a.leave + b.leave,
  medicalLeave: a.medicalLeave + b.medicalLeave,
  earlyLeave: a.earlyLeave + b.earlyLeave
});

const countStatus = (counts: StatusCounts, status: DailyAttendanceStatus) => {
  counts.total += 1;
  if (status === "PRESENT") counts.present += 1;
  if (status === "ABSENT") counts.absent += 1;
  if (status === "LATE") counts.late += 1;
  if (status === "LEAVE") counts.leave += 1;
  if (status === "MEDICAL_LEAVE") counts.medicalLeave += 1;
  if (status === "EARLY_LEAVE") counts.earlyLeave += 1;
};

export const countEntryStatuses = (entries: AttendanceEntry[]): StatusCounts => {
  const counts = emptyCounts();
  entries.forEach((entry) => countStatus(counts, entry.status));
  return counts;
};

/** Present, late and early-leave all mean the student attended. */
export const attendancePercentage = (counts: StatusCounts): number =>
  counts.total === 0
    ? 0
    : Number((((counts.present + counts.late + counts.earlyLeave) / counts.total) * 100).toFixed(2));

export const aggregateRecords = (records: ReportAttendanceRecord[]): StatusCounts =>
  records.reduce<StatusCounts>((acc, record) => addCounts(acc, countEntryStatuses(record.entries)), emptyCounts());

const groupCounts = (records: ReportAttendanceRecord[], keyOf: (record: ReportAttendanceRecord) => string) => {
  const map = new Map<string, StatusCounts>();
  records.forEach((record) => {
    const key = keyOf(record);
    map.set(key, addCounts(map.get(key) ?? emptyCounts(), countEntryStatuses(record.entries)));
  });
  return [...map.entries()].sort(([left], [right]) => left.localeCompare(right));
};

export const buildDailyTrend = (records: ReportAttendanceRecord[], limit = 14) =>
  groupCounts(records, (record) => record.dateBs)
    .slice(-limit)
    .map(([dateBs, counts]) => ({
      dateBs,
      present: counts.present,
      absent: counts.absent,
      late: counts.late,
      leave: counts.leave
    }));

export const buildMonthlyTrend = (records: ReportAttendanceRecord[]) =>
  groupCounts(records, (record) => record.dateBs.slice(0, 7))
    .slice(-12)
    .map(([month, counts]) => ({ month, present: counts.present, absent: counts.absent }));

export const buildWeeklyTrend = (records: ReportAttendanceRecord[]) =>
  groupCounts(records, (record) => {
    const [year, month, day] = record.dateBs.split("-").map(Number);
    const weekIndex = Math.ceil((day ?? 1) / 7);
    return `${year}-${String(month).padStart(2, "0")}-W${weekIndex}`;
  })
    .slice(-8)
    .map(([week, counts]) => ({ week, present: counts.present, absent: counts.absent }));

export const getGroupKey = (record: ReportAttendanceRecord, college: boolean): string =>
  college
    ? `${record.batchId?.toString() ?? ""}-${record.yearId?.toString() ?? ""}`
    : `${record.classId?.toString() ?? ""}-${record.sectionId?.toString() ?? ""}`;

type GroupRefs = {
  classId?: { toString(): string } | null;
  sectionId?: { toString(): string } | null;
  batchId?: { toString(): string } | null;
  yearId?: { toString(): string } | null;
};

const loadGroupNames = async (refs: GroupRefs[], college: boolean) => {
  const ids = (pick: (ref: GroupRefs) => { toString(): string } | null | undefined) =>
    [...new Set(refs.map(pick).filter(Boolean).map((id) => id!.toString()))];
  const [classes, sections, batches, years] = await Promise.all([
    college ? [] : SchoolClass.find({ _id: { $in: ids((r) => r.classId) } }).lean(),
    college ? [] : Section.find({ _id: { $in: ids((r) => r.sectionId) } }).lean(),
    college ? Batch.find({ _id: { $in: ids((r) => r.batchId) } }).lean() : [],
    college ? Year.find({ _id: { $in: ids((r) => r.yearId) } }).lean() : []
  ]);
  const classMap = new Map(classes.map((item) => [item._id.toString(), item.name]));
  const sectionMap = new Map(sections.map((item) => [item._id.toString(), item.name]));
  const batchMap = new Map(batches.map((item) => [item._id.toString(), item.name]));
  const yearMap = new Map(years.map((item) => [item._id.toString(), item.name]));
  return (ref: GroupRefs): string => {
    if (college) {
      const batch = batchMap.get(ref.batchId?.toString() ?? "") ?? "Batch";
      const year = yearMap.get(ref.yearId?.toString() ?? "") ?? "Year";
      return `${batch} · ${year}`;
    }
    const className = classMap.get(ref.classId?.toString() ?? "") ?? "Class";
    const section = sectionMap.get(ref.sectionId?.toString() ?? "") ?? "Section";
    return `${className} · ${section}`;
  };
};

export const loadAcademicLabels = async (records: ReportAttendanceRecord[], college: boolean) => {
  const teacherIds = records.map((r) => r.teacherId).filter(Boolean);
  const [labelForRecord, teachers] = await Promise.all([
    loadGroupNames(records, college),
    Teacher.find({ _id: { $in: teacherIds } }).populate("user", "fullName").lean()
  ]);
  const teacherMap = new Map(
    teachers.map((item) => [
      item._id.toString(),
      (item as { user?: { fullName?: string } }).user?.fullName ?? "Teacher"
    ])
  );
  return { labelForRecord, teacherMap };
};

export const buildClassWiseSummary = async (records: ReportAttendanceRecord[], college: boolean) => {
  const { labelForRecord } = await loadAcademicLabels(records, college);
  const map = new Map<string, { label: string; days: Set<string>; counts: StatusCounts }>();

  records.forEach((record) => {
    const key = getGroupKey(record, college);
    const current = map.get(key) ?? { label: labelForRecord(record), days: new Set<string>(), counts: emptyCounts() };
    current.days.add(record.dateBs);
    current.counts = addCounts(current.counts, countEntryStatuses(record.entries));
    map.set(key, current);
  });

  return [...map.values()]
    .map(({ label, days, counts }) => ({
      label,
      days: days.size,
      total: counts.total,
      present: counts.present,
      absent: counts.absent,
      late: counts.late,
      leave: counts.leave + counts.medicalLeave,
      earlyLeave: counts.earlyLeave,
      percentage: attendancePercentage(counts)
    }))
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));
};

export const buildTeacherWiseSummary = async (records: ReportAttendanceRecord[], college: boolean) => {
  const { teacherMap } = await loadAcademicLabels(records, college);
  const map = new Map<string, { classesMarked: number; counts: StatusCounts }>();

  records.forEach((record) => {
    const teacherId = record.teacherId.toString();
    const current = map.get(teacherId) ?? { classesMarked: 0, counts: emptyCounts() };
    map.set(teacherId, {
      classesMarked: current.classesMarked + 1,
      counts: addCounts(current.counts, countEntryStatuses(record.entries))
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
  threshold = 75,
  college = true
) => {
  const stats = new Map<string, StatusCounts>();

  records.forEach((record) => {
    record.entries.forEach((entry) => {
      const studentId = entry.studentId.toString();
      const current = stats.get(studentId) ?? emptyCounts();
      countStatus(current, entry.status);
      stats.set(studentId, current);
    });
  });

  const students = await Student.find({ _id: { $in: [...stats.keys()] }, schoolId })
    .populate("user", "fullName")
    .lean();
  const groupLabel = await loadGroupNames(students as GroupRefs[], college);

  const rows = students.map((student) => {
    const counts = stats.get(student._id.toString()) ?? emptyCounts();
    const percentage = attendancePercentage(counts);
    return {
      studentId: student._id.toString(),
      fullName: (student as { user?: { fullName?: string } }).user?.fullName ?? "Student",
      rollNumber: student.rollNumber,
      admissionNumber: student.admissionNumber,
      groupLabel: groupLabel(student as GroupRefs),
      totalDays: counts.total,
      present: counts.present,
      absent: counts.absent,
      late: counts.late,
      leave: counts.leave,
      medicalLeave: counts.medicalLeave,
      earlyLeave: counts.earlyLeave,
      percentage,
      isDefaulter: percentage < threshold
    };
  });

  // Class, then roll number — the order of the register.
  return rows.sort(
    (left, right) =>
      left.groupLabel.localeCompare(right.groupLabel, undefined, { numeric: true }) ||
      (Number(left.rollNumber) || 0) - (Number(right.rollNumber) || 0) ||
      left.fullName.localeCompare(right.fullName)
  );
};

const STATUS_LABELS: Record<string, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  LATE: "Late",
  LEAVE: "Leave",
  MEDICAL_LEAVE: "Medical leave",
  EARLY_LEAVE: "Early leave"
};

export const buildStatusReport = async (
  records: ReportAttendanceRecord[],
  statuses: DailyAttendanceStatus | DailyAttendanceStatus[],
  college = true
) => {
  const wanted = new Set<string>(Array.isArray(statuses) ? statuses : [statuses]);
  const labelForRecord = await loadGroupNames(records, college);
  const rows: Array<{
    dateBs: string;
    studentId: string;
    studentName?: string;
    rollNumber?: number | string;
    admissionNumber?: string;
    groupLabel: string;
    status: DailyAttendanceStatus;
    statusLabel: string;
    remarks?: string;
    recordId: string;
  }> = [];

  records.forEach((record) => {
    record.entries
      .filter((entry) => wanted.has(entry.status))
      .forEach((entry) => {
        rows.push({
          dateBs: record.dateBs,
          studentId: entry.studentId.toString(),
          groupLabel: labelForRecord(record),
          status: entry.status,
          statusLabel: STATUS_LABELS[entry.status] ?? entry.status,
          remarks: entry.remarks ?? "",
          recordId: record._id.toString()
        });
      });
  });

  const studentIds = [...new Set(rows.map((row) => row.studentId))];
  if (studentIds.length > 0) {
    const students = await Student.find({ _id: { $in: studentIds } })
      .populate("user", "fullName")
      .select("user rollNumber admissionNumber")
      .lean();
    const byId = new Map(students.map((student) => [student._id.toString(), student]));
    rows.forEach((row) => {
      const student = byId.get(row.studentId);
      row.studentName = (student?.user as { fullName?: string } | undefined)?.fullName ?? "Student";
      row.rollNumber = student?.rollNumber ?? "";
      row.admissionNumber = student?.admissionNumber ?? "";
    });
  }

  // Newest day first, then class and roll number.
  return rows.sort(
    (left, right) =>
      right.dateBs.localeCompare(left.dateBs) ||
      left.groupLabel.localeCompare(right.groupLabel, undefined, { numeric: true }) ||
      (Number(left.rollNumber) || 0) - (Number(right.rollNumber) || 0)
  );
};
const groupDayKey = (record: Pick<ReportAttendanceRecord, "dateBs" | "classId" | "sectionId" | "batchId" | "yearId">) =>
  [record.dateBs, record.classId, record.sectionId, record.batchId, record.yearId]
    .map((part) => part?.toString() ?? "")
    .join("|");

/**
 * Subject-wise marks count as daily attendance where no daily mark exists:
 * a student on the day's daily sheet keeps that status; anyone else takes their
 * status from the earliest subject-wise sheet of that day (the first period).
 * Read-only: builds report rows, never writes.
 */
export const withSubjectWiseFallback = (
  dailyRecords: ReportAttendanceRecord[],
  subjectRecords: Array<Omit<ReportAttendanceRecord, "status"> & { createdAt?: Date }>
): ReportAttendanceRecord[] => {
  const derived = new Map<string, ReportAttendanceRecord & { seen: Set<string> }>();
  // Daily sheets come first so their students keep the daily status
  for (const record of dailyRecords) {
    const key = groupDayKey(record);
    const day = derived.get(key);
    if (!day) {
      derived.set(key, {
        ...record,
        entries: [...(record.entries ?? [])],
        seen: new Set((record.entries ?? []).map((entry) => entry.studentId.toString()))
      });
      continue;
    }
    for (const entry of record.entries ?? []) {
      const studentId = entry.studentId.toString();
      if (day.seen.has(studentId)) continue;
      day.seen.add(studentId);
      day.entries.push(entry);
    }
  }

  const ordered = [...subjectRecords].sort(
    (a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0)
  );
  for (const record of ordered) {
    const key = groupDayKey(record);
    let day = derived.get(key);
    if (!day) {
      day = { ...record, entries: [], status: "SUBJECT_WISE", seen: new Set() };
      derived.set(key, day);
    }
    for (const entry of record.entries ?? []) {
      const studentId = entry.studentId.toString();
      if (day.seen.has(studentId)) continue;
      day.seen.add(studentId);
      day.entries.push(entry);
    }
  }

  return [...derived.values()].map(({ seen: _seen, ...record }) => record);
};
