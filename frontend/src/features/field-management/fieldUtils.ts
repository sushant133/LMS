import type { FieldDutyStudentStatus, FieldPostingSection } from "@phit-erp/shared";
import {
  FIELD_POSTING_TYPE_LABELS,
  postingTypeToSection,
  postingTypesForSection,
} from "@phit-erp/shared";

export const FIELD_SHIFTS = ["MORNING", "DAY", "EVENING", "NIGHT", "FULL_DAY"] as const;

export const FIELD_STATUSES: FieldDutyStudentStatus[] = [
  "PRESENT",
  "ABSENT",
  "LATE",
  "LEAVE",
  "EMERGENCY_DUTY",
];

/** Short codes for traditional monthly register cells. */
export const fieldStatusToCode = (status?: string): string => {
  switch (status) {
    case "PRESENT":
      return "P";
    case "ABSENT":
      return "A";
    case "LATE":
      return "L";
    case "LEAVE":
      return "Lv";
    case "EMERGENCY_DUTY":
      return "E";
    default:
      return "";
  }
};

export const fieldCodeClass = (code: string) => {
  switch (code) {
    case "P":
      return "bg-emerald-100 text-emerald-900 font-semibold";
    case "A":
      return "bg-rose-100 text-rose-900 font-semibold";
    case "L":
      return "bg-amber-100 text-amber-900 font-semibold";
    case "Lv":
      return "bg-sky-100 text-sky-900 font-semibold";
    case "E":
      return "bg-violet-100 text-violet-900 font-semibold";
    default:
      return "text-slate-300";
  }
};

export const FIELD_REGISTER_LEGEND = [
  { code: "P", label: "Present", className: fieldCodeClass("P") },
  { code: "A", label: "Absent", className: fieldCodeClass("A") },
  { code: "L", label: "Late", className: fieldCodeClass("L") },
  { code: "Lv", label: "Leave", className: fieldCodeClass("Lv") },
  { code: "E", label: "Emergency duty", className: fieldCodeClass("E") },
] as const;

export const shiftLabel = (shift?: string) =>
  (shift || "—").replace(/_/g, " ");

export const statusClass = (status: string) => {
  switch (status) {
    case "PRESENT":
    case "EMERGENCY_DUTY":
      return "bg-emerald-100 text-emerald-800";
    case "ABSENT":
      return "bg-rose-100 text-rose-800";
    case "LATE":
      return "bg-amber-100 text-amber-900";
    case "LEAVE":
      return "bg-sky-100 text-sky-800";
    case "LOCKED":
    case "SUBMITTED":
      return "bg-slate-800 text-white";
    case "DRAFT":
      return "bg-amber-100 text-amber-900";
    case "PENDING":
      return "bg-violet-100 text-violet-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
};

/** BS month YYYY-MM from a BS date or today fallback. */
export const monthBsFromDate = (dateBs?: string) => {
  if (dateBs && /^\d{4}-\d{2}/.test(dateBs)) return dateBs.slice(0, 7);
  return "";
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

export const postingTypeLabel = (type?: string) => {
  if (!type) return "—";
  return FIELD_POSTING_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
};

export const sectionLabel = (section: FieldPostingSection) =>
  section === "HOSPITAL" ? "Hospital Posting" : "Community / PHC Posting";

export const defaultPostingTypeForSection = (section: FieldPostingSection) =>
  section === "HOSPITAL" ? "HOSPITAL" : "COMMUNITY";

export const postingTypeOptionsForSection = (section: FieldPostingSection) => {
  const types = [...postingTypesForSection(section)];
  // Always expose Hospital on both create forms (Community and Hospital tabs).
  if (!types.includes("HOSPITAL")) {
    // After Community / PHC options so community types stay first on that tab
    const insertAt = section === "COMMUNITY_PHC" ? Math.min(2, types.length) : 0;
    types.splice(insertAt, 0, "HOSPITAL");
  }
  return types.map((value) => ({
    value,
    label: postingTypeLabel(value),
  }));
};

export { postingTypeToSection, postingTypesForSection };

export type FieldDailySheetRow = {
  studentId: string;
  fullName: string;
  rollNumber?: number;
  admissionNumber?: string;
  status: string;
  remarks?: string;
};

export type FieldDailySheet = {
  dateBs: string;
  shift: string;
  siteName: string;
  batchName?: string;
  yearName?: string;
  notes?: string;
  recordStatus?: string;
  entries: FieldDailySheetRow[];
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const dailyStatusBg = (code: string): string => {
  switch (code) {
    case "P":
      return "#d1fae5";
    case "A":
      return "#fee2e2";
    case "L":
      return "#fef3c7";
    case "Lv":
      return "#e0f2fe";
    case "E":
      return "#ede9fe";
    default:
      return "#fff";
  }
};

/** Landscape-style daily attendance register print (one date + shift). */
export const openFieldDailyRegisterPrint = (
  sheet: FieldDailySheet,
  institutionHeaderHtml: string,
  institutionHeaderCss: string,
): boolean => {
  const win = window.open("", "_blank");
  if (!win) return false;

  const entries = [...sheet.entries].sort((a, b) => {
    const ra = a.rollNumber ?? 9999;
    const rb = b.rollNumber ?? 9999;
    if (ra !== rb) return ra - rb;
    return a.fullName.localeCompare(b.fullName);
  });

  const counts = { P: 0, A: 0, L: 0, Lv: 0, E: 0 };
  const body = entries
    .map((row, i) => {
      const code = fieldStatusToCode(row.status);
      if (code === "P") counts.P += 1;
      else if (code === "A") counts.A += 1;
      else if (code === "L") counts.L += 1;
      else if (code === "Lv") counts.Lv += 1;
      else if (code === "E") counts.E += 1;
      return `<tr>
        <td class="sn">${i + 1}</td>
        <td class="roll">${row.rollNumber ?? ""}</td>
        <td class="name">${escapeHtml(row.fullName || "—")}</td>
        <td>${escapeHtml(row.admissionNumber || "")}</td>
        <td class="code" style="background:${dailyStatusBg(code)}">${escapeHtml(code || "")}</td>
        <td>${escapeHtml(row.remarks || "")}</td>
      </tr>`;
    })
    .join("");

  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="utf-8"/>
    <title>Field Daily Attendance — ${escapeHtml(sheet.dateBs)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: system-ui, sans-serif; padding: 10mm 8mm; color: #0f172a; }
      h1 { font-size: 16px; margin: 8px 0 2px; }
      h2 { font-size: 13px; margin: 0 0 8px; color: #334155; font-weight: 600; }
      .meta { font-size: 11px; color: #475569; margin-bottom: 10px; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th, td { border: 1px solid #94a3b8; padding: 4px 6px; }
      th { background: #f1f5f9; font-weight: 600; }
      td.sn, td.roll, td.code { text-align: center; }
      td.name { font-weight: 600; }
      td.code { font-weight: 700; }
      thead { display: table-header-group; }
      tr { page-break-inside: avoid; }
      .legend { margin-top: 10px; font-size: 10px; color: #475569; }
      .sig { display: flex; justify-content: space-between; margin-top: 28px; gap: 16px; }
      .sig div { flex: 1; text-align: center; font-size: 10px; }
      .sig-line { border-top: 1px solid #64748b; margin: 22px 12px 4px; }
      @page { size: A4 portrait; margin: 10mm; }
      ${institutionHeaderCss}
    </style>
  </head><body>
    ${institutionHeaderHtml}
    <h1>Field Daily Attendance Register</h1>
    <h2>${escapeHtml(sheet.siteName || "Field posting")}</h2>
    <div class="meta">
      Date (BS): <strong>${escapeHtml(sheet.dateBs)}</strong>
      · Shift: <strong>${escapeHtml(shiftLabel(sheet.shift))}</strong>
      ${sheet.batchName ? ` · Batch: ${escapeHtml(sheet.batchName)}` : ""}
      ${sheet.yearName ? ` · Year: ${escapeHtml(sheet.yearName)}` : ""}
      ${sheet.recordStatus ? ` · Status: ${escapeHtml(sheet.recordStatus)}` : ""}
      · ${entries.length} student(s)
      · P ${counts.P} · A ${counts.A} · L ${counts.L} · Lv ${counts.Lv} · E ${counts.E}
    </div>
    ${sheet.notes ? `<p class="meta">Notes: ${escapeHtml(sheet.notes)}</p>` : ""}
    <table>
      <thead>
        <tr>
          <th>#</th><th>Roll</th><th>Student</th><th>Admission</th><th>Status</th><th>Remarks</th>
        </tr>
      </thead>
      <tbody>${body || `<tr><td colspan="6">No students on this day's register.</td></tr>`}</tbody>
    </table>
    <p class="legend">P = Present · A = Absent · L = Late · Lv = Leave · E = Emergency duty</p>
    <div class="sig">
      <div><div class="sig-line"></div>Prepared by</div>
      <div><div class="sig-line"></div>Verified by</div>
      <div><div class="sig-line"></div>Approved by</div>
    </div>
    <script>window.onload=function(){window.print()}</script>
  </body></html>`);
  win.document.close();
  return true;
};
