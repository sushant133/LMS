import { jsPDF } from "jspdf";
import type {
  LibraryBookRecord,
  LibraryBorrowerType,
  LibraryCopyStatus,
  LibraryIssueRecord,
  LibraryIssueStatus,
} from "@phit-erp/shared";

export const ACTIVE_LIBRARY_ISSUE_STATUSES: LibraryIssueStatus[] = [
  "ISSUED",
  "OVERDUE",
];

export const isActiveLibraryIssue = (issue: LibraryIssueRecord): boolean =>
  ACTIVE_LIBRARY_ISSUE_STATUSES.includes(issue.status);

export const filterLibraryIssues = (
  issues: LibraryIssueRecord[],
  query: string,
): LibraryIssueRecord[] => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return issues;

  return issues.filter((issue) => {
    const bookTitle = issue.bookTitle?.toLowerCase() ?? "";
    const borrowerName = issue.borrowerName?.toLowerCase() ?? "";
    const bookCode = issue.bookCode?.toLowerCase() ?? "";
    const issuedBy = issue.issuedByName?.toLowerCase() ?? "";
    return (
      bookTitle.includes(normalized) ||
      borrowerName.includes(normalized) ||
      bookCode.includes(normalized) ||
      issuedBy.includes(normalized)
    );
  });
};

export type IssuedBooksFilter = {
  searchQuery?: string;
  batchId?: string;
  yearId?: string;
  classId?: string;
  sectionId?: string;
  status?: "ALL" | "ISSUED" | "OVERDUE";
  borrowerType?: "ALL" | LibraryBorrowerType;
};

export const borrowerTypeLabel = (type?: LibraryBorrowerType | string): string => {
  if (type === "TEACHER") return "Teacher";
  if (type === "STAFF") return "Staff";
  if (type === "STUDENT") return "Student";
  return "Borrower";
};

/** Filter issued-book rows by name/code search and academic placement. */
export const filterIssuedBooks = (
  issues: LibraryIssueRecord[],
  filters: IssuedBooksFilter,
): LibraryIssueRecord[] => {
  let list = issues;

  if (filters.status && filters.status !== "ALL") {
    list = list.filter((issue) => issue.status === filters.status);
  }
  if (filters.borrowerType && filters.borrowerType !== "ALL") {
    list = list.filter((issue) => issue.borrowerType === filters.borrowerType);
  }
  if (filters.batchId) {
    list = list.filter((issue) => issue.studentBatchId === filters.batchId);
  }
  if (filters.yearId) {
    list = list.filter((issue) => issue.studentYearId === filters.yearId);
  }
  if (filters.classId) {
    list = list.filter((issue) => issue.studentClassId === filters.classId);
  }
  if (filters.sectionId) {
    list = list.filter((issue) => issue.studentSectionId === filters.sectionId);
  }

  const q = filters.searchQuery?.trim().toLowerCase() ?? "";
  if (!q) return list;

  return list.filter((issue) => {
    const bookTitle = issue.bookTitle?.toLowerCase() ?? "";
    const borrowerName = issue.borrowerName?.toLowerCase() ?? "";
    const bookCode = issue.bookCode?.toLowerCase() ?? "";
    const issuedBy = issue.issuedByName?.toLowerCase() ?? "";
    const batch = issue.studentBatchName?.toLowerCase() ?? "";
    const year = issue.studentYearName?.toLowerCase() ?? "";
    const klass = issue.studentClassName?.toLowerCase() ?? "";
    return (
      bookTitle.includes(q) ||
      borrowerName.includes(q) ||
      bookCode.includes(q) ||
      issuedBy.includes(q) ||
      batch.includes(q) ||
      year.includes(q) ||
      klass.includes(q)
    );
  });
};

/** Human-readable issuer label: "Library Staff (Name)" / "Admin (Name)". */
export const formatIssuedByLabel = (
  issue: Pick<LibraryIssueRecord, "issuedByName" | "issuedByRole">,
): string => {
  const name = issue.issuedByName?.trim();
  if (!name) return "—";

  const role = issue.issuedByRole ?? "";
  if (role === "LIBRARY_STAFF") {
    return `Library Staff (${name})`;
  }
  if (role === "COLLEGE_ADMIN" || role === "SUPER_ADMIN") {
    return `Admin (${name})`;
  }
  if (role) {
    return `${role.replace(/_/g, " ")} (${name})`;
  }
  return name;
};

export type FilterOption = { _id: string; name: string };

export const uniqueBatchOptionsFromIssues = (
  issues: LibraryIssueRecord[],
): FilterOption[] => {
  const map = new Map<string, string>();
  for (const issue of issues) {
    if (issue.studentBatchId) {
      map.set(
        issue.studentBatchId,
        issue.studentBatchName?.trim() || "Batch",
      );
    }
  }
  return [...map.entries()]
    .map(([id, name]) => ({ _id: id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const uniqueYearOptionsFromIssues = (
  issues: LibraryIssueRecord[],
  batchId?: string,
): FilterOption[] => {
  const map = new Map<string, string>();
  for (const issue of issues) {
    if (batchId && issue.studentBatchId !== batchId) continue;
    if (issue.studentYearId) {
      map.set(issue.studentYearId, issue.studentYearName?.trim() || "Year");
    }
  }
  return [...map.entries()]
    .map(([id, name]) => ({ _id: id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const uniqueClassOptionsFromIssues = (
  issues: LibraryIssueRecord[],
): FilterOption[] => {
  const map = new Map<string, string>();
  for (const issue of issues) {
    if (issue.studentClassId) {
      map.set(
        issue.studentClassId,
        issue.studentClassName?.trim() || "Class",
      );
    }
  }
  return [...map.entries()]
    .map(([id, name]) => ({ _id: id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const uniqueSectionOptionsFromIssues = (
  issues: LibraryIssueRecord[],
  classId?: string,
): FilterOption[] => {
  const map = new Map<string, string>();
  for (const issue of issues) {
    if (classId && issue.studentClassId !== classId) continue;
    if (issue.studentSectionId) {
      map.set(
        issue.studentSectionId,
        issue.studentSectionName?.trim() || "Section",
      );
    }
  }
  return [...map.entries()]
    .map(([id, name]) => ({ _id: id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

const COPY_STATUS_LABEL: Record<LibraryCopyStatus, string> = {
  AVAILABLE: "Available",
  ISSUED: "Issued",
  LOST: "Lost",
  DAMAGED: "Damaged",
  MAINTENANCE: "Maintenance",
};

export type LibraryInventoryPdfMeta = {
  institutionName?: string;
  institutionAddress?: string;
  title?: string;
  filename?: string;
};

/**
 * Full library inventory PDF (jsPDF text layout).
 * Includes every book and every physical copy with all details.
 * Avoids html2canvas truncation on long multi-page reports.
 */
export async function exportLibraryInventoryPdf(
  books: LibraryBookRecord[],
  meta?: LibraryInventoryPdfMeta,
): Promise<void> {
  if (!books.length) {
    throw new Error("No books to export");
  }

  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 10;
  const marginTop = 12;
  const marginBottom = 12;
  const usableWidth = pageWidth - marginX * 2;

  // SN | Code | Status | Shelf | Condition | Publication | Price
  const colWeights = [10, 28, 24, 36, 30, 40, 22];
  const weightSum = colWeights.reduce((a, b) => a + b, 0);
  const colW = colWeights.map((w) => (w / weightSum) * usableWidth);
  const headers = [
    "S.N.",
    "Book code",
    "Status",
    "Shelf location",
    "Condition",
    "Publication",
    "Price (NPR)",
  ];
  const colX: number[] = [];
  {
    let x = marginX;
    for (const w of colW) {
      colX.push(x);
      x += w;
    }
  }

  const rowH = 6.5;
  let y = marginTop;
  let pageNo = 1;

  const totalCopies = books.reduce(
    (sum, book) => sum + (book.copies?.length ?? book.totalCopies ?? 0),
    0,
  );

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
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      "Library inventory · Each row is one physical copy with its unique book code",
      marginX,
      pageHeight - 6,
    );
    doc.text(`Page ${pageNo}`, pageWidth - marginX, pageHeight - 6, {
      align: "right",
    });
  };

  const drawReportHeader = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.text(meta?.institutionName?.trim() || "Institution", marginX, y);
    y += 5;

    const address = meta?.institutionAddress?.trim() || "";
    if (address) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text(address, marginX, y);
      y += 5;
    } else {
      y += 1;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(meta?.title?.trim() || "Library Book Inventory", marginX, y);
    y += 5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(
      `${books.length} book${books.length === 1 ? "" : "s"} · ${totalCopies} physical cop${
        totalCopies === 1 ? "y" : "ies"
      } · Full details with all copy codes`,
      marginX,
      y,
    );
    y += 6;

    doc.setDrawColor(148, 163, 184);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 5;
  };

  const ensureSpace = (needed: number) => {
    if (y + needed <= pageHeight - marginBottom) return;
    drawFooter();
    doc.addPage();
    pageNo += 1;
    y = marginTop;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `${meta?.title?.trim() || "Library Book Inventory"} (continued)`,
      marginX,
      y,
    );
    y += 6;
  };

  const paintCopyTableHeader = () => {
    doc.setFillColor(241, 245, 249);
    doc.rect(marginX, y, usableWidth, rowH, "F");
    doc.setDrawColor(203, 213, 225);
    doc.rect(marginX, y, usableWidth, rowH, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    headers.forEach((h, i) => {
      const maxW = colW[i]! - 2;
      if (i === headers.length - 1) {
        doc.text(fitText(h, maxW), colX[i]! + colW[i]! - 1.2, y + 4.4, {
          align: "right",
        });
      } else if (i === 0) {
        doc.text(fitText(h, maxW), colX[i]! + colW[i]! / 2, y + 4.4, {
          align: "center",
        });
      } else {
        doc.text(fitText(h, maxW), colX[i]! + 1, y + 4.4);
      }
    });
    y += rowH;
  };

  const drawCopyTableHeader = () => {
    ensureSpace(rowH + 2);
    paintCopyTableHeader();
  };

  const drawCopyRow = (cells: string[], index: number) => {
    const pageBefore = pageNo;
    ensureSpace(rowH);
    // New page mid-table: re-print column headers so every page is complete
    if (pageNo !== pageBefore) {
      paintCopyTableHeader();
      ensureSpace(rowH);
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
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    cells.forEach((value, i) => {
      const maxW = colW[i]! - 2.2;
      const text = fitText(value, maxW);
      if (i === cells.length - 1) {
        doc.text(text, colX[i]! + colW[i]! - 1.2, y + 4.4, { align: "right" });
      } else if (i === 0) {
        doc.text(text, colX[i]! + colW[i]! / 2, y + 4.4, { align: "center" });
      } else if (i === 1) {
        doc.setFont("helvetica", "bold");
        doc.text(text, colX[i]! + 1, y + 4.4);
        doc.setFont("helvetica", "normal");
      } else {
        doc.text(text, colX[i]! + 1, y + 4.4);
      }
    });
    y += rowH;
  };

  const formatPrice = (price?: number) => {
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      return "—";
    }
    return price.toLocaleString("en-NP");
  };

  drawReportHeader();

  books.forEach((book, bookIndex) => {
    const copies = book.copies ?? [];
    // Book block needs title + meta lines + table header at minimum
    ensureSpace(28);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `Book ${bookIndex + 1}: ${fitText(book.title || "Untitled", usableWidth - 20)}`,
      marginX,
      y,
    );
    y += 5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);

    const metaLines = [
      `Author: ${book.author?.trim() || "—"}   ·   ISBN: ${book.isbn?.trim() || "—"}   ·   Category: ${book.category?.trim() || "—"}`,
      `Year / type: ${book.yearLevel ?? "All Years"}   ·   Default shelf: ${book.shelfLocation?.trim() || "—"}   ·   Stock status: ${book.status}`,
      `Copies: total ${book.totalCopies} · available ${book.availableCopies} · issued ${book.issuedCopies} · listed codes ${copies.length}`,
    ];

    for (const line of metaLines) {
      ensureSpace(5);
      const wrapped = doc.splitTextToSize(line, usableWidth);
      for (const wline of wrapped) {
        ensureSpace(4.5);
        doc.text(wline, marginX, y);
        y += 4.2;
      }
    }

    y += 2;

    if (copies.length === 0) {
      ensureSpace(6);
      doc.setTextColor(146, 64, 14);
      doc.text(
        "No coded physical copies registered for this title.",
        marginX,
        y,
      );
      y += 8;
      return;
    }

    drawCopyTableHeader();

    copies.forEach((copy, copyIndex) => {
      drawCopyRow(
        [
          String(copyIndex + 1),
          copy.bookCode?.trim() || "—",
          COPY_STATUS_LABEL[copy.status] ?? copy.status,
          copy.shelfLocation?.trim() || "—",
          copy.condition?.trim() || "—",
          copy.publication?.trim() || "—",
          formatPrice(copy.priceNpr),
        ],
        copyIndex,
      );
    });

    // Tight gap before next book — do not force a new page between titles
    y += 4;
  });

  drawFooter();

  const filename =
    meta?.filename?.trim() ||
    (books.length === 1
      ? `library-book-${(books[0]?.title || "book")
          .replace(/[^\w\s\-().]+/g, "")
          .trim()
          .replace(/\s+/g, "-")
          .slice(0, 60)}.pdf`
      : "library-inventory-all-books.pdf");

  doc.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
