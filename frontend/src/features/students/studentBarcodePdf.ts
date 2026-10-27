import JsBarcode from "jsbarcode";

export type StudentBarcodeRow = {
  name: string;
  rollNumber: string;
  primary: string;
  secondary: string;
  admissionNumber: string;
};

type BarcodeListOptions = {
  institutionName: string;
  institutionAddress?: string;
  /** "Batch" / "Class" */
  primaryLabel: string;
  /** "Year" / "Section" */
  secondaryLabel: string;
  /** Active filters, e.g. "Batch: 2081 · Year: 1st Year" */
  scopeLine?: string;
  filename: string;
};

const rollKey = (roll: string): [number, string] => {
  const trimmed = roll.trim();
  if (!trimmed) return [Number.POSITIVE_INFINITY, ""];
  const lead = Number.parseInt(trimmed, 10);
  return [Number.isFinite(lead) ? lead : Number.POSITIVE_INFINITY - 1, trimmed.toLowerCase()];
};

/** Batch, then year, then roll number — so each group reads in roll order. */
export const sortByRollNumber = (rows: StudentBarcodeRow[]): StudentBarcodeRow[] =>
  [...rows].sort((a, b) => {
    const group =
      a.primary.localeCompare(b.primary, undefined, { numeric: true }) ||
      a.secondary.localeCompare(b.secondary, undefined, { numeric: true });
    if (group) return group;
    const [aNum, aText] = rollKey(a.rollNumber);
    const [bNum, bText] = rollKey(b.rollNumber);
    if (aNum !== bNum) return aNum - bNum;
    if (aText !== bText) return aText.localeCompare(bText, undefined, { numeric: true });
    return a.name.localeCompare(b.name);
  });

/** CODE128 barcode for `value` as a PNG data URL (sharp at print size). */
const barcodePng = (value: string): string | null => {
  try {
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, value, {
      format: "CODE128",
      width: 3,
      height: 90,
      margin: 0,
      displayValue: false,
      background: "#ffffff",
      lineColor: "#000000",
    });
    return canvas.toDataURL("image/png");
  } catch {
    // Characters CODE128 cannot encode — the row still prints, without bars
    return null;
  }
};

/**
 * Student list with a scannable admission-number barcode per student, as a
 * real A4 PDF (drawn with jsPDF, not a screenshot): name, batch, year,
 * admission no. and its CODE128 barcode. Heading row repeats on every page.
 */
export const downloadStudentBarcodeListPdf = async (
  unsortedRows: StudentBarcodeRow[],
  options: BarcodeListOptions,
): Promise<void> => {
  const rows = sortByRollNumber(unsortedRows);
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 12;
  const marginTop = 12;
  const marginBottom = 14;

  // Columns (mm) — total = page width minus margins (186)
  const columns = [
    { key: "sn", label: "S.N.", width: 10, align: "center" as const },
    { key: "roll", label: "Roll no.", width: 14, align: "center" as const },
    { key: "name", label: "Student name", width: 42, align: "left" as const },
    { key: "primary", label: options.primaryLabel, width: 27, align: "left" as const },
    { key: "secondary", label: options.secondaryLabel, width: 21, align: "left" as const },
    { key: "admission", label: "Admission no.", width: 29, align: "left" as const },
    { key: "barcode", label: "Admission no. barcode", width: 43, align: "center" as const },
  ];
  const tableWidth = columns.reduce((sum, c) => sum + c.width, 0);
  const headerRowHeight = 8;
  const rowHeight = 17;
  const cellPadding = 2;

  let pageNo = 1;
  let y = marginTop;

  const drawPageHeader = (first: boolean) => {
    y = marginTop;
    if (first) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text(options.institutionName.toUpperCase(), pageWidth / 2, y + 4, {
        align: "center",
      });
      y += 8;
      if (options.institutionAddress) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text(options.institutionAddress, pageWidth / 2, y + 2, { align: "center" });
        y += 5;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Student list — admission number barcodes (by roll no.)", pageWidth / 2, y + 3, {
        align: "center",
      });
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      const meta = [
        options.scopeLine,
        `${rows.length} student${rows.length === 1 ? "" : "s"}`,
        `Generated ${new Date().toLocaleDateString()}`,
      ]
        .filter(Boolean)
        .join("  ·  ");
      doc.text(meta, pageWidth / 2, y + 2, { align: "center" });
      y += 6;
    }
    // Column headings (repeated on every page)
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(148, 163, 184);
    doc.rect(marginX, y, tableWidth, headerRowHeight, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    let x = marginX;
    for (const column of columns) {
      const textX =
        column.align === "center" ? x + column.width / 2 : x + cellPadding;
      doc.text(column.label, textX, y + 5.3, {
        align: column.align === "center" ? "center" : "left",
      });
      x += column.width;
      if (x < marginX + tableWidth) doc.line(x, y, x, y + headerRowHeight);
    }
    y += headerRowHeight;
  };

  const drawFooter = () => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Page ${pageNo}`, pageWidth - marginX, pageHeight - 6, { align: "right" });
    doc.setTextColor(15, 23, 42);
  };

  drawPageHeader(true);

  rows.forEach((row, index) => {
    if (y + rowHeight > pageHeight - marginBottom) {
      drawFooter();
      doc.addPage();
      pageNo += 1;
      drawPageHeader(false);
    }

    if (index % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(marginX, y, tableWidth, rowHeight, "F");
    }
    doc.setDrawColor(203, 213, 225);
    doc.rect(marginX, y, tableWidth, rowHeight, "S");

    const values: Record<string, string> = {
      sn: String(index + 1),
      roll: row.rollNumber || "—",
      name: row.name || "—",
      primary: row.primary || "—",
      secondary: row.secondary || "—",
      admission: row.admissionNumber || "—",
    };

    let x = marginX;
    for (const column of columns) {
      if (column.key === "admission") {
        // One line, never split: shrink the type until the number fits
        const text = values.admission ?? "";
        let size = 9;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(size);
        while (size > 6 && doc.getTextWidth(text) > column.width - cellPadding * 2) {
          size -= 0.5;
          doc.setFontSize(size);
        }
        doc.text(text, x + cellPadding, y + rowHeight / 2 + 1.2);
      } else if (column.key !== "barcode") {
        doc.setFont(
          "helvetica",
          column.key === "name" || column.key === "roll" ? "bold" : "normal",
        );
        doc.setFontSize(9);
        // Wrap to the column; at most 3 lines fit the row
        const lines = (doc.splitTextToSize(values[column.key] ?? "", column.width - cellPadding * 2) as string[]).slice(0, 3);
        const blockHeight = lines.length * 3.8;
        const textY = y + (rowHeight - blockHeight) / 2 + 3;
        doc.text(
          lines,
          column.align === "center" ? x + column.width / 2 : x + cellPadding,
          textY,
          { align: column.align === "center" ? "center" : "left" },
        );
      } else if (row.admissionNumber) {
        const png = barcodePng(row.admissionNumber);
        if (png) {
          // Bars, then the number in human-readable form underneath
          const barWidth = column.width - 6;
          doc.addImage(png, "PNG", x + 3, y + 2, barWidth, 10, undefined, "FAST");
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.5);
          doc.text(row.admissionNumber, x + column.width / 2, y + 15.2, { align: "center" });
        } else {
          doc.setFontSize(8);
          doc.text("Cannot encode", x + column.width / 2, y + rowHeight / 2 + 1, {
            align: "center",
          });
        }
      } else {
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text("No admission no.", x + column.width / 2, y + rowHeight / 2 + 1, {
          align: "center",
        });
        doc.setTextColor(15, 23, 42);
      }
      x += column.width;
      if (x < marginX + tableWidth) {
        doc.setDrawColor(203, 213, 225);
        doc.line(x, y, x, y + rowHeight);
      }
    }
    y += rowHeight;
  });

  drawFooter();
  const name = options.filename.toLowerCase().endsWith(".pdf")
    ? options.filename
    : `${options.filename}.pdf`;
  doc.save(name);
};
