import type { CollegeStaffCategory } from "@phit-erp/shared";

export type CollegeStaffTabId =
  | "teachers"
  | "accountants"
  | "librarians"
  | "laboratory"
  | "security"
  | "housekeeping"
  | "receptionists"
  | "office-assistants"
  | "transport"
  | "it"
  | "other";

export const COLLEGE_STAFF_TABS: Array<{
  id: CollegeStaffTabId;
  label: string;
  category?: CollegeStaffCategory;
}> = [
  { id: "teachers", label: "Teachers" },
  { id: "accountants", label: "Accountants" },
  { id: "librarians", label: "Librarians" },
  { id: "laboratory", label: "Laboratory Staff" },
  { id: "security", label: "Security Guards", category: "SECURITY_GUARD" },
  {
    id: "housekeeping",
    label: "Sweepers / Housekeeping",
    category: "HOUSEKEEPING",
  },
  { id: "receptionists", label: "Receptionists", category: "RECEPTIONIST" },
  {
    id: "office-assistants",
    label: "Office Assistants",
    category: "OFFICE_ASSISTANT",
  },
  {
    id: "transport",
    label: "Drivers / Transport Staff",
    category: "TRANSPORT",
  },
  { id: "it", label: "IT Staff", category: "IT_STAFF" },
  { id: "other", label: "Other Staff", category: "OTHER" },
];

export const isGenericStaffTab = (
  tab: CollegeStaffTabId,
): tab is Exclude<
  CollegeStaffTabId,
  "teachers" | "accountants" | "librarians" | "laboratory"
> => !["teachers", "accountants", "librarians", "laboratory"].includes(tab);
