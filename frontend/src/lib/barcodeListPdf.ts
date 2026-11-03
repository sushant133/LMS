import JsBarcode from "jsbarcode";

export type BarcodeListColumn = {
  label: string;
  /** Width in mm. Text columns plus the code and barcode columns must total 186 (A4 portrait). */
  width: number;
  bold?: boolean;
  align?: "left" | "center";
};

export type BarcodeListRow = {
  /** One value per text column, in column order. */
  cells: string[];
  /** The ID printed in its own column and encoded as the barcode. */
  code: string;
};

type BarcodeListOptions = {
  title: string;
  institutionName: string;
  institutionAddress?: string;
  scopeLine?: string;
  filename: string;
  /** Text columns before the code (S.N. is added automatically). */
  columns: BarcodeListColumn[];
  /** e.g. "Teacher code" / "Employee ID" */
  codeLabel: string;
  codeWidth: number;
  barcodeWidth: number;
  /** "teacher" / "staff member" — used in the count line */
  noun: string;
};

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
 * A4 PDF list with a scannable CODE128 barcode of each person's ID (teacher code,
 * staff employee ID), drawn with jsPDF like the student barcode list. Sorted by ID;
 * the heading row repeats on every page.
 */
export const downloadCodeBarcodeListPdf = async (
  unsortedRows: BarcodeListRow[],
  options: BarcodeListOptions,
): Promise<void> => {
  const rows = [...unsortedRows].sort(
    (a, b) =>
      (a.code ? 0 : 1) - (b.code ? 0 : 1) ||
      a.code.localeCompare(b.code, undefined, { numeric: true }) ||
      (a.cells[0] ?? "").localeCompare(b.cells[0] ?? ""),
  );
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 12;
  const marginTop = 12;
  const marginBottom = 14;

  type Column = { key: string; label: string; width: number; align: "left" | "center"; bold?: boolean };
  const columns: Column[] = [
    { key: "sn", label: "S.N.", width: 10, align: "center" },
    ...options.columns.map((column, index) => ({
      key: `c${index}`,
      label: column.label,
      width: column.width,
      align: column.align ?? "left",
      bold: column.bold,
    })),
    { key: "code", label: options.codeLabel, width: options.codeWidth, align: "left" },
    { key: "barcode", label: `${options.codeLabel} barcode`, width: options.barcodeWidth, align: "center" },
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
      doc.text(options.institutionName.toUpperCase(), pageWidth / 2, y + 4, { align: "center" });
      y += 8;
      if (options.institutionAddress) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text(options.institutionAddress, pageWidth / 2, y + 2, { align: "center" });
        y += 5;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(options.title, pageWidth / 2, y + 3, { align: "center" });
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      const meta = [
        options.scopeLine,
        `${rows.length} ${options.noun}${rows.length === 1 ? "" : "s"}`,
        `Generated ${new Date().toLocaleDateString()}`,
      ]
        .filter(Boolean)
        .join("  ·  ");
      doc.text(meta, pageWidth / 2, y + 2, { align: "center" });
      y += 6;
    }
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(148, 163, 184);
    doc.rect(marginX, y, tableWidth, headerRowHeight, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    let x = marginX;
    for (const column of columns) {
      const textX = column.align === "center" ? x + column.width / 2 : x + cellPadding;
      doc.text(column.label, textX, y + 5.3, { align: column.align });
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

    let x = marginX;
    for (const column of columns) {
      if (column.key === "code") {
        // One line, never split: shrink the type until the ID fits
        const text = row.code || "—";
        let size = 9;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(size);
        while (size > 6 && doc.getTextWidth(text) > column.width - cellPadding * 2) {
          size -= 0.5;
          doc.setFontSize(size);
        }
        doc.text(text, x + cellPadding, y + rowHeight / 2 + 1.2);
      } else if (column.key === "barcode") {
        const png = row.code ? barcodePng(row.code) : null;
        if (png) {
          doc.addImage(png, "PNG", x + 3, y + 2, column.width - 6, 10, undefined, "FAST");
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.5);
          doc.text(row.code, x + column.width / 2, y + 15.2, { align: "center" });
        } else {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.setTextColor(100, 116, 139);
          doc.text(row.code ? "Cannot encode" : `No ${options.codeLabel}`, x + column.width / 2, y + rowHeight / 2 + 1, {
            align: "center",
          });
          doc.setTextColor(15, 23, 42);
        }
      } else {
        const value =
          column.key === "sn" ? String(index + 1) : row.cells[Number(column.key.slice(1))] || "—";
        doc.setFont("helvetica", column.bold ? "bold" : "normal");
        doc.setFontSize(9);
        const lines = (doc.splitTextToSize(value, column.width - cellPadding * 2) as string[]).slice(0, 3);
        const textY = y + (rowHeight - lines.length * 3.8) / 2 + 3;
        doc.text(lines, column.align === "center" ? x + column.width / 2 : x + cellPadding, textY, {
          align: column.align,
        });
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
  doc.save(options.filename.toLowerCase().endsWith(".pdf") ? options.filename : `${options.filename}.pdf`);
};
