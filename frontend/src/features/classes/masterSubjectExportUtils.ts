import { COLLEGE_YEAR_NAMES, type MasterSubjectRecord } from "@phit-erp/shared";
import { saveAs } from "file-saver";
import * as XLSX from "xlsx";

const yearLevelLabel = (level: number): string => COLLEGE_YEAR_NAMES[level - 1] ?? `Year ${level}`;

const HEADERS = [
  "S.N.",
  "Subject Name",
  "Subject Code",
  "Year Level",
  "Year",
  "Credit Hours",
  "Theory Marks",
  "Practical Marks",
  "Internal Marks",
  "Pass Marks",
  "Full Marks",
  "Status"
] as const;

const toRows = (subjects: MasterSubjectRecord[]): (string | number)[][] => {
  const sorted = [...subjects].sort((a, b) => {
    if (a.yearLevel !== b.yearLevel) {
      return a.yearLevel - b.yearLevel;
    }
    return a.name.localeCompare(b.name);
  });

  return sorted.map((subject, index) => [
    index + 1,
    subject.name,
    subject.code,
    subject.yearLevel,
    yearLevelLabel(subject.yearLevel),
    subject.creditHours ?? "",
    subject.theoryMarks,
    subject.practicalMarks ?? "",
    subject.internalMarks ?? "",
    subject.passMarks,
    subject.fullMarks,
    subject.isActive ? "Active" : "Inactive"
  ]);
};

const buildFilename = (extension: "xlsx" | "csv", base = "master-subject-list"): string => {
  const date = new Date().toISOString().slice(0, 10);
  return `${base}-${date}.${extension}`;
};

export const downloadMasterSubjectsExcel = (
  subjects: MasterSubjectRecord[],
  filename = buildFilename("xlsx")
): void => {
  const rows = toRows(subjects);
  const worksheet = XLSX.utils.aoa_to_sheet([HEADERS as unknown as string[], ...rows]);

  worksheet["!cols"] = [
    { wch: 6 },
    { wch: 28 },
    { wch: 14 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 }
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Master Subjects");

  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  saveAs(blob, filename);
};

export const downloadMasterSubjectsCsv = (
  subjects: MasterSubjectRecord[],
  filename = buildFilename("csv")
): void => {
  const rows = toRows(subjects);
  const worksheet = XLSX.utils.aoa_to_sheet([HEADERS as unknown as string[], ...rows]);
  const csv = XLSX.utils.sheet_to_csv(worksheet);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  saveAs(blob, filename);
};
