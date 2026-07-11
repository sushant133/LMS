import type { CollegeStaffCategory } from "@phit-erp/shared";

/**
 * College Staff hub tabs.
 * - Teachers: existing Teacher module (embedded, unchanged APIs)
 * - Other tabs: non-teaching staff only
 */
export type CollegeStaffTabId =
  | "teachers"
  | "all"
  | "accountants"
  | "librarians"
  | "laboratory"
  | "security"
  | "housekeeping"
  | "receptionists"
  | "office-assistants"
  | "transport"
  | "it"
  | "other"
  | "reports";

export const COLLEGE_STAFF_TABS: Array<{
  id: CollegeStaffTabId;
  label: string;
  category?: CollegeStaffCategory;
  isTeachers?: boolean;
  isReports?: boolean;
}> = [
  { id: "teachers", label: "Teachers", isTeachers: true },
  { id: "all", label: "All Non-Teaching Staff" },
  { id: "accountants", label: "Accountants", category: "ACCOUNTANT" },
  { id: "librarians", label: "Librarians", category: "LIBRARIAN" },
  { id: "laboratory", label: "Laboratory Staff", category: "LABORATORY_STAFF" },
  { id: "security", label: "Security Guards", category: "SECURITY_GUARD" },
  { id: "housekeeping", label: "Sweepers / Housekeeping", category: "HOUSEKEEPING" },
  { id: "receptionists", label: "Receptionists", category: "RECEPTIONIST" },
  { id: "office-assistants", label: "Office Assistants", category: "OFFICE_ASSISTANT" },
  { id: "transport", label: "Drivers / Transport", category: "TRANSPORT" },
  { id: "it", label: "IT Staff", category: "IT_STAFF" },
  { id: "other", label: "Other Staff", category: "OTHER" },
  { id: "reports", label: "Reports", isReports: true },
];
