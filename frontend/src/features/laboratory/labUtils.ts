import type {
  LaboratoryEquipmentInput,
  LaboratoryInput,
  LaboratoryReportType,
  LaboratoryStockRequestStatus,
} from "@phit-erp/shared";

/**
 * Must stay in sync with `@phit-erp/shared` LABORATORY_YEAR_LEVELS.
 * Defined locally so Vite always has a concrete named export (file: package
 * re-exports can fail as "does not provide an export named …" in dev).
 */
export const LABORATORY_YEAR_LEVELS = [
  "1st Year",
  "2nd Year",
  "3rd Year",
  "All Years",
] as const;

export type LaboratoryYearLevel = (typeof LABORATORY_YEAR_LEVELS)[number];

export type LabTab =
  | "dashboard"
  | "labs"
  | "inventory"
  | "requests"
  | "issues"
  | "reports"
  | "staff";

/**
 * Optional templates that only seed default equipment groups when a lab is created.
 * The real lab identity is the Laboratory name the user types.
 */
export const labTypeOptions = [
  { value: "OTHER", label: "General / Custom (no preset groups)" },
  { value: "COMPUTER", label: "Computer equipment groups" },
  { value: "PHYSICS", label: "Physics equipment groups" },
  { value: "CHEMISTRY", label: "Chemistry equipment groups" },
  { value: "BIOLOGY", label: "Biology equipment groups" },
] as const;

/** Equipment category options shown in Add/Edit equipment (itemKind). */
export const itemKindOptions = [
  { value: "DISPOSABLE", label: "Disposable / Destroyable" },
  { value: "NON_DISPOSABLE", label: "Non-Disposable / Non-Destroyable" },
] as const;

export const conditionOptions = [
  { value: "NEW", label: "New" },
  { value: "GOOD", label: "Good" },
  { value: "FAIR", label: "Fair" },
  { value: "DAMAGED", label: "Damaged" },
] as const;

export const equipmentStatusOptions = [
  { value: "AVAILABLE", label: "Available" },
  { value: "IN_USE", label: "In Use" },
  { value: "UNDER_MAINTENANCE", label: "Under Maintenance" },
  { value: "DISPOSED", label: "Disposed" },
] as const;

export const stockActionOptions = [
  { value: "INCREASE", label: "Increase stock" },
  { value: "REDUCE", label: "Reduce stock" },
  { value: "CONSUME", label: "Mark consumed" },
  { value: "DAMAGE", label: "Mark damaged" },
  { value: "DISPOSE", label: "Mark disposed" },
  { value: "LOST", label: "Mark lost" },
  { value: "MAINTENANCE", label: "Send to maintenance" },
] as const;

export const requestStatusStyles: Record<LaboratoryStockRequestStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-sky-100 text-sky-800",
  PURCHASED: "bg-indigo-100 text-indigo-800",
  RECEIVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-rose-100 text-rose-800",
};

export const issueStatusStyles: Record<string, string> = {
  ISSUED: "bg-sky-100 text-sky-800",
  RETURNED: "bg-brand-100 text-brand-800",
  OVERDUE: "bg-rose-100 text-rose-800",
};

export const reportTypeOptions: Array<{ value: LaboratoryReportType; label: string }> = [
  { value: "LABORATORY_INVENTORY", label: "Laboratory-wise Inventory" },
  { value: "EQUIPMENT", label: "Equipment-wise Report" },
  { value: "CATEGORY", label: "Category-wise Report" },
  { value: "STOCK_MOVEMENT", label: "Stock Movement Report" },
  { value: "LOW_STOCK", label: "Low Stock Report" },
  { value: "OUT_OF_STOCK", label: "Out of Stock Report" },
  { value: "DAMAGED", label: "Damaged Equipment Report" },
  { value: "PURCHASE_REQUEST", label: "Purchase Request Report" },
  { value: "INVENTORY_VALUATION", label: "Inventory Valuation Report" },
  { value: "LABORATORY_ASSETS", label: "Laboratory-wise Asset Report" },
];

export const defaultLabForm: LaboratoryInput = {
  type: "OTHER",
  customName: "",
  name: "",
  code: "",
  yearLevel: "1st Year",
  department: "",
  academicProgram: "",
  description: "",
  location: "",
  roomNumber: "",
  inChargeTeacherId: "",
  remarks: "",
  isActive: true,
};

export const defaultEquipmentForm: LaboratoryEquipmentInput = {
  laboratoryId: "",
  categoryId: "",
  name: "",
  itemCode: "",
  itemKind: "NON_DISPOSABLE",
  yearLevel: "1st Year",
  brand: "",
  equipmentModel: "",
  unit: "pcs",
  quantity: 1,
  minimumStockLevel: 0,
  maximumStockLevel: 0,
  purchaseDateBs: "",
  supplier: "",
  purchaseCost: 0,
  storageLocation: "",
  condition: "GOOD",
  equipmentStatus: "AVAILABLE",
  description: "",
  remarks: "",
};

export const defaultIssueForm = {
  equipmentId: "",
  teacherId: "",
  quantity: 1,
  issuedDateBs: "",
  dueDateBs: "",
};

export type StockRequestFormState = {
  laboratoryId: string;
  equipmentId: string;
  equipmentName: string;
  categoryName: string;
  currentStock: number;
  minimumStock: number;
  requiredQuantity: number;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  remarks: string;
};

export const defaultRequestForm: StockRequestFormState = {
  laboratoryId: "",
  equipmentId: "",
  equipmentName: "",
  categoryName: "",
  currentStock: 0,
  minimumStock: 0,
  requiredQuantity: 1,
  priority: "MEDIUM",
  remarks: "",
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
  if (rows.length === 0) {
    return "message\nNo data";
  }
  const headers = Object.keys(rows[0]!);
  const escape = (value: unknown) => {
    const text = value == null ? "" : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(",")),
  ].join("\n");
}

export async function exportRowsToExcel(rows: Record<string, unknown>[], filename: string) {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ message: "No data" }]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Report");
  XLSX.writeFile(book, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

export async function exportElementToPdf(elementId: string, filename: string) {
  const element = document.getElementById(elementId);
  if (!element) {
    throw new Error("Report preview not found");
  }
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
