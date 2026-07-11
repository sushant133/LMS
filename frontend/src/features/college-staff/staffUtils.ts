import type { CollegeStaffCategory, CollegeStaffInput } from "@phit-erp/shared";
import {
  COLLEGE_STAFF_CATEGORY_LABELS,
  COLLEGE_STAFF_CATEGORY_ROLES,
} from "@phit-erp/shared";

export const emptyAddress = {
  province: "",
  district: "",
  municipality: "",
  ward: "",
  streetAddress: "",
};

export const createDefaultStaff = (
  category: CollegeStaffCategory = "OTHER",
): CollegeStaffInput => ({
  fullName: "",
  email: "",
  phone: "",
  enableLogin: true,
  staffId: "",
  photoUrl: "",
  gender: "Male",
  dateOfBirthBs: "",
  address: { ...emptyAddress },
  emergencyContactName: "",
  emergencyContactPhone: "",
  joinedDateBs: "",
  designation: COLLEGE_STAFF_CATEGORY_LABELS[category]
    .replace(/s$/, "")
    .replace(/ \/ .*$/, ""),
  department: "",
  category,
  customRoleLabel: "",
  qualification: "",
  experienceYears: 0,
  employmentType: "FULL_TIME",
  basicSalaryNpr: 0,
  remarks: "",
  status: "ACTIVE",
});

export const staffReportOptions = [
  { value: "DIRECTORY", label: "Staff Directory" },
  { value: "ROLE_WISE", label: "Role-wise Staff Report" },
  { value: "DEPARTMENT_WISE", label: "Department-wise Report" },
  { value: "ACTIVE", label: "Active Staff Report" },
  { value: "INACTIVE", label: "Inactive Staff Report" },
  { value: "LOGIN_ACCOUNTS", label: "Login Account Report" },
  { value: "EMAIL_DELIVERY", label: "Email Delivery Report" },
] as const;

export const categoryLoginRoleLabel = (category: CollegeStaffCategory): string => {
  return COLLEGE_STAFF_CATEGORY_ROLES[category] ?? "COLLEGE_STAFF";
};

export const categoryDisplayLabel = (
  category: CollegeStaffCategory | string,
  customRoleLabel?: string,
): string => {
  if (category === "OTHER" && customRoleLabel?.trim()) {
    return customRoleLabel.trim();
  }
  return (
    COLLEGE_STAFF_CATEGORY_LABELS[category as CollegeStaffCategory] ?? String(category)
  );
};

/** Normalize number fields before Zod parse (empty/NaN from NumberInput). */
export const sanitizeStaffFormNumbers = <
  T extends { experienceYears?: number; basicSalaryNpr?: number },
>(
  form: T,
): T => ({
  ...form,
  experienceYears:
    form.experienceYears == null || Number.isNaN(form.experienceYears)
      ? 0
      : form.experienceYears,
  basicSalaryNpr:
    form.basicSalaryNpr == null || Number.isNaN(form.basicSalaryNpr)
      ? 0
      : form.basicSalaryNpr,
});

export const staffPhotoSrc = (photoUrl?: string | null): string | undefined => {
  if (!photoUrl) return undefined;
  if (photoUrl.startsWith("http://") || photoUrl.startsWith("https://") || photoUrl.startsWith("data:")) {
    return photoUrl;
  }
  return photoUrl.startsWith("/") ? photoUrl : `/${photoUrl}`;
};

export const emailStatusStyle: Record<string, string> = {
  SENT: "bg-emerald-100 text-emerald-800",
  FAILED: "bg-rose-100 text-rose-800",
  PENDING: "bg-amber-100 text-amber-800",
  SKIPPED: "bg-slate-100 text-slate-600",
};

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "message\nNo data";
  const headers = Object.keys(rows[0]!);
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ].join("\n");
}

export async function exportRowsToExcel(rows: Record<string, unknown>[], filename: string) {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ message: "No data" }]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Staff");
  XLSX.writeFile(book, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

export async function exportElementToPdf(elementId: string, filename: string) {
  const element = document.getElementById(elementId);
  if (!element) throw new Error("Report preview not found");
  const html2pdf = (await import("html2pdf.js")).default;
  await html2pdf()
    .set({
      margin: 10,
      filename: filename.endsWith(".pdf") ? filename : `${filename}.pdf`,
      html2canvas: { scale: 2 },
      jsPDF: { unit: "mm", format: "a4", orientation: "landscape" },
    })
    .from(element)
    .save();
}
