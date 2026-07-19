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

export const postingTypeLabel = (type?: string) => {
  if (!type) return "—";
  return FIELD_POSTING_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
};

export const sectionLabel = (section: FieldPostingSection) =>
  section === "HOSPITAL" ? "Hospital Posting" : "Community / PHC Posting";

export const defaultPostingTypeForSection = (section: FieldPostingSection) =>
  section === "HOSPITAL" ? "HOSPITAL" : "COMMUNITY";

export const postingTypeOptionsForSection = (section: FieldPostingSection) =>
  postingTypesForSection(section).map((value) => ({
    value,
    label: postingTypeLabel(value),
  }));

export { postingTypeToSection, postingTypesForSection };
