import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import type { DailyAttendanceRecord, DailyAttendanceStudentReportRow } from "@phit-erp/shared";

interface AttendanceStudentLookup {
  _id: string;
  fullName: string;
  rollNumber: number;
  admissionNumber: string;
}

const statusAbbreviation: Record<string, string> = {
  PRESENT: "P",
  ABSENT: "A",
  LATE: "L",
  LEAVE: "LV",
  MEDICAL_LEAVE: "ML"
};

const writeWorkbook = (rows: Array<Array<string | number>>, sheetName: string, filename: string) => {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName);
  const buffer = XLSX.write(book, { bookType: "xlsx", type: "array" });
  saveAs(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }),
    filename
  );
};

const writeMultiSheetWorkbook = (
  sheets: Array<{ name: string; rows: Array<Array<string | number>> }>,
  filename: string
) => {
  const book = XLSX.utils.book_new();
  sheets.forEach((sheet) => {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name.slice(0, 31));
  });
  const buffer = XLSX.write(book, { bookType: "xlsx", type: "array" });
  saveAs(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }),
    filename
  );
};

export const downloadDailyAttendanceExcel = (
  records: DailyAttendanceRecord[],
  filename = "daily-attendance-report.xlsx"
) => {
  const rows: Array<Array<string | number>> = [
    ["Date (BS)", "Class/Batch", "Section/Year", "Teacher ID", "Present", "Absent", "Late", "Leave", "Medical Leave"]
  ];

  records.forEach((record) => {
    const counts = { present: 0, absent: 0, late: 0, leave: 0, medical: 0 };
    record.entries.forEach((entry) => {
      if (entry.status === "PRESENT") counts.present += 1;
      if (entry.status === "ABSENT") counts.absent += 1;
      if (entry.status === "LATE") counts.late += 1;
      if (entry.status === "LEAVE") counts.leave += 1;
      if (entry.status === "MEDICAL_LEAVE") counts.medical += 1;
    });

    rows.push([
      record.dateBs,
      record.classId ?? record.batchId ?? "",
      record.sectionId ?? record.yearId ?? "",
      record.teacherId,
      counts.present,
      counts.absent,
      counts.late,
      counts.leave,
      counts.medical
    ]);
  });

  writeWorkbook(rows, "Daily Attendance", filename);
};

export const downloadStudentAttendanceExcel = (
  rows: DailyAttendanceStudentReportRow[],
  filename = "student-attendance-report.xlsx"
) => {
  const sheetRows: Array<Array<string | number>> = [
    [
      "Student",
      "Roll",
      "Registration",
      "Total Days",
      "Present",
      "Absent",
      "Late",
      "Leave",
      "Medical Leave",
      "Percentage",
      "Defaulter"
    ]
  ];

  rows.forEach((row) => {
    sheetRows.push([
      row.fullName,
      row.rollNumber,
      row.admissionNumber,
      row.totalDays,
      row.present,
      row.absent,
      row.late,
      row.leave,
      row.medicalLeave,
      row.percentage,
      row.isDefaulter ? "Yes" : "No"
    ]);
  });

  writeWorkbook(sheetRows, "Student Attendance", filename);
};

export const downloadClassSummaryExcel = (
  rows: Array<{ label: string; present: number; absent: number; percentage: number }>,
  filename = "class-attendance-summary.xlsx"
) => {
  const sheetRows: Array<Array<string | number>> = [["Class", "Present", "Absent", "Attendance %"]];
  rows.forEach((row) => {
    sheetRows.push([row.label, row.present, row.absent, row.percentage]);
  });
  writeWorkbook(sheetRows, "Class Summary", filename);
};

const buildStudentDailyMatrixRows = (
  records: DailyAttendanceRecord[],
  students: AttendanceStudentLookup[]
): Array<Array<string | number>> => {
  const dates = [...new Set(records.map((record) => record.dateBs))].sort();
  const studentLookup = new Map(students.map((student) => [student._id, student]));
  const matrix = new Map<
    string,
    {
      fullName: string;
      rollNumber: number;
      admissionNumber: string;
      statuses: Record<string, string>;
      counts: { present: number; absent: number; late: number; leave: number; medicalLeave: number };
    }
  >();

  records.forEach((record) => {
    record.entries.forEach((entry) => {
      const student = studentLookup.get(entry.studentId);
      const existing = matrix.get(entry.studentId) ?? {
        fullName: student?.fullName ?? entry.studentId,
        rollNumber: student?.rollNumber ?? 0,
        admissionNumber: student?.admissionNumber ?? "",
        statuses: {},
        counts: { present: 0, absent: 0, late: 0, leave: 0, medicalLeave: 0 }
      };

      existing.statuses[record.dateBs] = statusAbbreviation[entry.status] ?? entry.status;
      if (entry.status === "PRESENT") existing.counts.present += 1;
      if (entry.status === "ABSENT") existing.counts.absent += 1;
      if (entry.status === "LATE") existing.counts.late += 1;
      if (entry.status === "LEAVE") existing.counts.leave += 1;
      if (entry.status === "MEDICAL_LEAVE") existing.counts.medicalLeave += 1;

      matrix.set(entry.studentId, existing);
    });
  });

  const header = [
    "Student",
    "Roll",
    "Registration",
    ...dates,
    "Present",
    "Absent",
    "Late",
    "Leave",
    "Medical Leave",
    "Attendance %"
  ];

  const rows = [...matrix.values()]
    .sort((left, right) => left.rollNumber - right.rollNumber || left.fullName.localeCompare(right.fullName))
    .map((row) => {
      const markedDays = row.counts.present + row.counts.absent + row.counts.late + row.counts.leave + row.counts.medicalLeave;
      const percentage =
        markedDays === 0
          ? 0
          : Number((((row.counts.present + row.counts.late) / markedDays) * 100).toFixed(2));

      return [
        row.fullName,
        row.rollNumber,
        row.admissionNumber,
        ...dates.map((date) => row.statuses[date] ?? ""),
        row.counts.present,
        row.counts.absent,
        row.counts.late,
        row.counts.leave,
        row.counts.medicalLeave,
        percentage
      ];
    });

  return [header, ...rows];
};

export const buildAttendanceStudentLookup = (
  studentRows: DailyAttendanceStudentReportRow[]
): AttendanceStudentLookup[] =>
  studentRows.map((row) => ({
    _id: row.studentId,
    fullName: row.fullName,
    rollNumber: row.rollNumber,
    admissionNumber: row.admissionNumber
  }));

export const downloadOverallAttendanceWorkbook = (
  records: DailyAttendanceRecord[],
  studentRows: DailyAttendanceStudentReportRow[],
  filename = "overall-attendance.xlsx"
): void => {
  const dailySummaryRows: Array<Array<string | number>> = [
    ["Date (BS)", "Class/Batch", "Section/Year", "Teacher ID", "Present", "Absent", "Late", "Leave", "Medical Leave"]
  ];

  records.forEach((record) => {
    const counts = { present: 0, absent: 0, late: 0, leave: 0, medical: 0 };
    record.entries.forEach((entry) => {
      if (entry.status === "PRESENT") counts.present += 1;
      if (entry.status === "ABSENT") counts.absent += 1;
      if (entry.status === "LATE") counts.late += 1;
      if (entry.status === "LEAVE") counts.leave += 1;
      if (entry.status === "MEDICAL_LEAVE") counts.medical += 1;
    });

    dailySummaryRows.push([
      record.dateBs,
      record.classId ?? record.batchId ?? "",
      record.sectionId ?? record.yearId ?? "",
      record.teacherId,
      counts.present,
      counts.absent,
      counts.late,
      counts.leave,
      counts.medical
    ]);
  });

  const studentSummaryRows: Array<Array<string | number>> = [
    [
      "Student",
      "Roll",
      "Registration",
      "Total Days",
      "Present",
      "Absent",
      "Late",
      "Leave",
      "Medical Leave",
      "Percentage",
      "Defaulter"
    ],
    ...studentRows.map((row) => [
      row.fullName,
      row.rollNumber,
      row.admissionNumber,
      row.totalDays,
      row.present,
      row.absent,
      row.late,
      row.leave,
      row.medicalLeave,
      row.percentage,
      row.isDefaulter ? "Yes" : "No"
    ])
  ];

  writeMultiSheetWorkbook(
    [
      { name: "Daily Summary", rows: dailySummaryRows },
      { name: "Student Summary", rows: studentSummaryRows },
      { name: "Student Daily Detail", rows: buildStudentDailyMatrixRows(records, buildAttendanceStudentLookup(studentRows)) }
    ],
    filename
  );
};