import type { StudentRecord } from "@phit-erp/shared";
import { saveAs } from "file-saver";
import { formatCurrencyNpr } from "lib/utils";
import * as XLSX from "xlsx";

const formatAddress = (address: StudentRecord["address"]): string =>
  [
    address.streetAddress,
    `Ward ${address.ward}`,
    address.municipality,
    address.district,
    address.province,
  ]
    .filter(Boolean)
    .join(", ");

interface StudentExportOptions {
  isCollege: boolean;
  primaryLabel: string;
  secondaryLabel: string;
  primaryMap: Map<string, string>;
  secondaryMap: Map<string, string>;
  includeFees?: boolean;
}

export const downloadStudentsExcel = (
  students: StudentRecord[],
  options: StudentExportOptions,
  filename = "students.xlsx",
): void => {
  const headers = [
    "Full Name",
    "Email",
    "Phone",
    "Roll No.",
    "Admission No.",
    options.primaryLabel,
    options.secondaryLabel,
    "Gender",
    "Date of Birth (BS)",
    "Admission Date (BS)",
    "Father Name",
    "Father Phone",
    "Mother Name",
    "Mother Phone",
    "Guardian Name",
    "Guardian Phone",
    "Address",
    ...(options.includeFees ? ["Total Fee (NPR)"] : []),
    "Remarks",
  ];

  const rows = students.map((student) => [
    student.user?.fullName ?? "Unknown student",
    student.user?.email ?? "",
    student.user?.phone ?? "",
    student.rollNumber,
    student.admissionNumber,
    options.primaryMap.get(
      (options.isCollege ? student.batchId : student.classId) ?? "",
    ) ?? "",
    options.secondaryMap.get(
      (options.isCollege ? student.yearId : student.sectionId) ?? "",
    ) ?? "",
    student.gender,
    student.dateOfBirthBs,
    student.admissionDateBs,
    student.fatherName,
    student.fatherPhone ?? "",
    student.motherName,
    student.motherPhone ?? "",
    student.guardianName,
    student.guardianPhone,
    formatAddress(student.address),
    ...(options.includeFees
      ? [
          student.hasScholarship
            ? "Scholarship"
            : formatCurrencyNpr(student.feesDueNpr),
        ]
      : []),
    student.remarks ?? "",
  ]);

  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Students");

  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  saveAs(blob, filename);
};
