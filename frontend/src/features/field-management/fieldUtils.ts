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
