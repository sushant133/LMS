import { jsPDF } from "jspdf";
import type {
  LaboratoryEquipmentInput,
  LaboratoryEquipmentRecord,
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
  | "print-inventory"
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
  /** Disposable / Destroyable vs Non-Disposable / Non-Destroyable */
  itemKind: "DISPOSABLE" | "NON_DISPOSABLE";
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
  itemKind: "NON_DISPOSABLE",
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

export type LaboratoryInventoryPdfMeta = {
  institutionName?: string;
  title?: string;
  filename?: string;
};

const itemKindLabel = (kind?: string) => {
  if (kind === "DISPOSABLE") return "Disposable / Destroyable";
  if (kind === "NON_DISPOSABLE") return "Non-Disposable / Non-Destroyable";
  return kind?.replace(/_/g, " ") || "—";
};

const formatCost = (cost?: number) => {
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost <= 0) return "—";
  return cost.toLocaleString("en-NP");
};

const kindShort = (kind?: string) => {
  if (kind === "DISPOSABLE") return "Disposable";
  if (kind === "NON_DISPOSABLE") return "Non-disp.";
  return kind?.replace(/_/g, " ") || "—";
};

/**
 * Compact landscape table PDF of laboratory equipment inventory.
 * One row per item with all key fields — no card blocks, fits more on each page.
 */
export async function exportLaboratoryInventoryPdf(
  items: LaboratoryEquipmentRecord[],
  meta?: LaboratoryInventoryPdfMeta,
): Promise<void> {
  if (!items.length) {
    throw new Error("No equipment to export");
  }

  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 7;
  const marginTop = 10;
  const marginBottom = 10;
  const usableWidth = pageWidth - marginX * 2;

  // Compact columns — full inventory details in one table row
  // SN Code Name Lab Cat Year Kind Brand Model Unit Qty Av Iss Stock Cond EqSt Storage Supplier Cost Date
  const colWeights = [6, 14, 28, 18, 14, 10, 12, 12, 12, 8, 8, 8, 8, 12, 10, 12, 14, 14, 12, 12];
  const weightSum = colWeights.reduce((a, b) => a + b, 0);
  const colW = colWeights.map((w) => (w / weightSum) * usableWidth);
  const headers = [
    "S.N.",
    "Code",
    "Equipment",
    "Laboratory",
    "Category",
    "Year",
    "Kind",
    "Brand",
    "Model",
    "Unit",
    "Qty",
    "Avl",
    "Iss",
    "Stock",
    "Cond.",
    "Eq.status",
    "Storage",
    "Supplier",
    "Cost",
    "Purch.",
  ];
  const colX: number[] = [];
  {
    let x = marginX;
    for (const w of colW) {
      colX.push(x);
      x += w;
    }
  }

  const rowH = 5.4;
  const headerH = 5.8;
  let y = marginTop;
  let pageNo = 1;

  const sorted = [...items].sort((a, b) => {
    const lab = (a.laboratoryName || "").localeCompare(b.laboratoryName || "");
    if (lab !== 0) return lab;
    return (a.name || "").localeCompare(b.name || "");
  });

  const totalQty = sorted.reduce((sum, item) => sum + (item.quantity || 0), 0);

  const fitText = (text: string, maxWidth: number) => {
    const t = (text || "—").replace(/\s+/g, " ").trim() || "—";
    if (doc.getTextWidth(t) <= maxWidth) return t;
    let out = t;
    while (out.length > 1 && doc.getTextWidth(`${out}…`) > maxWidth) {
      out = out.slice(0, -1);
    }
    return `${out}…`;
  };

  const drawFooter = () => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(
      "Laboratory equipment inventory · One row = one item · Confidential",
      marginX,
      pageHeight - 5,
    );
    doc.text(`Page ${pageNo}`, pageWidth - marginX, pageHeight - 5, {
      align: "right",
    });
  };

  const drawReportHeader = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(meta?.institutionName?.trim() || "Institution", marginX, y);
    y += 5;

    doc.setFontSize(10);
    doc.text(meta?.title?.trim() || "Laboratory Equipment Inventory", marginX, y);
    y += 4;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(
      `${sorted.length} item${sorted.length === 1 ? "" : "s"} · total qty ${totalQty} · All details in table`,
      marginX,
      y,
    );
    y += 4;

    doc.setDrawColor(148, 163, 184);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 3;
  };

  const ensureSpace = (needed: number) => {
    if (y + needed <= pageHeight - marginBottom) return false;
    drawFooter();
    doc.addPage();
    pageNo += 1;
    y = marginTop;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `${meta?.title?.trim() || "Laboratory Equipment Inventory"} (continued)`,
      marginX,
      y,
    );
    y += 5;
    return true;
  };

  const paintTableHeader = () => {
    doc.setFillColor(241, 245, 249);
    doc.rect(marginX, y, usableWidth, headerH, "F");
    doc.setDrawColor(148, 163, 184);
    doc.rect(marginX, y, usableWidth, headerH, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.2);
    doc.setTextColor(15, 23, 42);
    headers.forEach((h, i) => {
      const maxW = colW[i]! - 1.2;
      const numeric = i >= 10 && i <= 12 || i === 18;
      if (numeric) {
        doc.text(fitText(h, maxW), colX[i]! + colW[i]! - 0.8, y + 3.8, {
          align: "right",
        });
      } else if (i === 0) {
        doc.text(fitText(h, maxW), colX[i]! + colW[i]! / 2, y + 3.8, {
          align: "center",
        });
      } else {
        doc.text(fitText(h, maxW), colX[i]! + 0.6, y + 3.8);
      }
    });
    y += headerH;
  };

  const drawRow = (cells: string[], index: number) => {
    if (ensureSpace(rowH)) {
      paintTableHeader();
    }

    if (index % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(marginX, y, usableWidth, rowH, "F");
    }
    doc.setDrawColor(226, 232, 240);
    doc.rect(marginX, y, usableWidth, rowH, "S");
    let xLine = marginX;
    for (let i = 0; i < colW.length - 1; i++) {
      xLine += colW[i]!;
      doc.line(xLine, y, xLine, y + rowH);
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.2);
    doc.setTextColor(15, 23, 42);
    cells.forEach((value, i) => {
      const maxW = colW[i]! - 1.2;
      const text = fitText(value, maxW);
      const numeric = i >= 10 && i <= 12 || i === 18;
      if (numeric) {
        doc.text(text, colX[i]! + colW[i]! - 0.8, y + 3.6, { align: "right" });
      } else if (i === 0) {
        doc.text(text, colX[i]! + colW[i]! / 2, y + 3.6, { align: "center" });
      } else if (i === 1) {
        doc.setFont("helvetica", "bold");
        doc.text(text, colX[i]! + 0.6, y + 3.6);
        doc.setFont("helvetica", "normal");
      } else {
        doc.text(text, colX[i]! + 0.6, y + 3.6);
      }
    });
    y += rowH;
  };

  drawReportHeader();
  paintTableHeader();

  sorted.forEach((item, index) => {
    drawRow(
      [
        String(index + 1),
        item.itemCode?.trim() || "—",
        item.name?.trim() || "—",
        item.laboratoryName?.trim() || "—",
        item.categoryName?.trim() || "—",
        item.yearLevel ?? "All",
        kindShort(item.itemKind),
        item.brand?.trim() || "—",
        item.equipmentModel?.trim() || "—",
        item.unit?.trim() || "pcs",
        String(item.quantity ?? 0),
        String(item.availableQuantity ?? 0),
        String(item.issuedQuantity ?? 0),
        item.status || "—",
        item.condition || "—",
        item.equipmentStatus || "—",
        item.storageLocation?.trim() || "—",
        item.supplier?.trim() || "—",
        formatCost(item.purchaseCost),
        item.purchaseDateBs?.trim() || "—",
      ],
      index,
    );
  });

  drawFooter();

  const filename =
    meta?.filename?.trim() ||
    (items.length === 1
      ? `lab-equipment-${(items[0].name || "item")
          .replace(/[^\w\s\-().]+/g, "")
          .trim()
          .replace(/\s+/g, "-")
          .slice(0, 60)}.pdf`
      : "laboratory-inventory-all.pdf");

  doc.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
