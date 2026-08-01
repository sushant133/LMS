import type {
  AttendanceRegisterCell,
  AttendanceRegisterResponse,
  AttendanceRegisterRowSummary,
} from "@phit-erp/shared";

export const REGISTER_CODE_COLORS: Record<string, string> = {
  P: "bg-emerald-100 text-emerald-800",
  A: "bg-red-100 text-red-800",
  L: "bg-blue-100 text-blue-800",
  Late: "bg-orange-100 text-orange-800",
  H: "bg-slate-200 text-slate-700",
  HD: "bg-amber-100 text-amber-900",
  OD: "bg-indigo-100 text-indigo-800",
  F: "bg-violet-100 text-violet-800",
  N: "bg-violet-100 text-violet-800",
  E: "bg-violet-100 text-violet-800",
  M: "bg-violet-100 text-violet-800",
};

export const REGISTER_CODE_PRINT_COLORS: Record<string, string> = {
  P: "#d1fae5",
  A: "#fee2e2",
  L: "#dbeafe",
  Late: "#ffedd5",
  H: "#e2e8f0",
  HD: "#fef3c7",
  OD: "#e0e7ff",
  F: "#ede9fe",
};

export const cellClass = (cell?: AttendanceRegisterCell | null): string => {
  if (!cell?.code) return "text-slate-300";
  return REGISTER_CODE_COLORS[cell.code] ?? "bg-slate-50 text-slate-700";
};

export const shiftMonthBs = (monthBs: string, delta: number): string => {
  const [y, m] = monthBs.split("-").map(Number);
  if (!y || !m) return monthBs;
  let year = y;
  let month = m + delta;
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
};

export const summaryLine = (s: AttendanceRegisterRowSummary): string =>
  `P:${s.present} A:${s.absent} L:${s.leave} ${s.percentage}%`;

export const buildRegisterCsv = (data: AttendanceRegisterResponse): string => {
  const dayHeaders = data.days.map((d) => String(d.dayOfMonth));
  const header = [
    "SN",
    "Name",
    "Code",
    "Roll",
    "Department",
    "Designation",
    "Batch",
    "Year",
    ...dayHeaders,
    "Present",
    "Absent",
    "Leave",
    "Late",
    "Holiday",
    "Half Day",
    "Official Duty",
    "Field Duty",
    "Percentage",
  ];
  const lines = [header.join(",")];
  for (const row of data.rows) {
    const dayCells = data.days.map(
      (d) => row.cells[d.dateBs]?.code ?? "",
    );
    lines.push(
      [
        row.sn,
        csvEscape(row.fullName),
        csvEscape(row.code ?? ""),
        row.rollNumber ?? "",
        csvEscape(row.department ?? ""),
        csvEscape(row.designation ?? ""),
        csvEscape(row.batchName ?? row.className ?? ""),
        csvEscape(row.yearName ?? row.sectionName ?? ""),
        ...dayCells,
        row.summary.present,
        row.summary.absent,
        row.summary.leave,
        row.summary.late,
        row.summary.holiday,
        row.summary.halfDay,
        row.summary.officialDuty,
        row.summary.fieldDuty,
        row.summary.percentage,
      ].join(","),
    );
  }
  return lines.join("\n");
};

const csvEscape = (value: string): string => {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
};

export const downloadTextFile = (
  content: string,
  filename: string,
  mime: string,
): void => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};
