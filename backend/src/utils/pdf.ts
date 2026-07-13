import PDFDocument from "pdfkit";
import type { Response } from "express";
import fs from "fs";
import path from "path";
import { collegeLogoExists, getCollegeLogoPath } from "./collegeLogo.js";
import { formatCurrencyNpr } from "./currency.js";

const FONTS_DIR = path.join(process.cwd(), "assets", "fonts");

const FONT_PATHS = {
  regular: path.join(FONTS_DIR, "NotoSans-Regular.ttf"),
  bold: path.join(FONTS_DIR, "NotoSans-Bold.ttf"),
  devanagari: path.join(FONTS_DIR, "NotoSansDevanagari-Regular.ttf")
} as const;

const fontsAvailable = (): boolean =>
  Object.values(FONT_PATHS).every((fontPath) => fs.existsSync(fontPath));

interface ReceiptData {
  schoolName: string;
  schoolNameNp?: string;
  receiptNumber: string;
  paidDateBs: string;
  studentName: string;
  admissionNumber: string;
  rollNumber?: number;
  className: string;
  sectionName: string;
  feeTitle: string;
  amountPaidNpr: number;
  discountNpr: number;
  scholarshipNpr?: number;
  lateFeeNpr: number;
  totalPaid: number;
  remainingDueNpr?: number;
  paymentMethod?: string;
  accountantName?: string;
  transactionNumber?: string;
  verificationCode?: string;
  feeBreakdown?: Array<{ feeType: string; title: string; amountNpr: number }>;
  isDuplicate?: boolean;
}

interface MarksheetData {
  schoolName: string;
  schoolNameNp?: string;
  schoolAddress?: string;
  principalName?: string;
  controllerOfExamination?: string;
  examName: string;
  academicYearBs?: string;
  studentName: string;
  registrationNumber?: string;
  className: string;
  sectionName: string;
  batchName?: string;
  yearName?: string;
  rollNumber: number;
  marks: Array<{
    subject: string;
    fullMarks: number;
    obtained: number;
    theory?: number;
    practical?: number;
    internal?: number;
    grade?: string;
    passFail?: string;
    remarks?: string;
  }>;
  totalObtained: number;
  totalFull: number;
  percentage: number;
  gpa: number;
  grade: string;
  passFailStatus?: string;
  publishDateBs?: string;
  printedDateBs?: string;
  verificationNumber?: string;
}

const registerPdfFonts = (doc: PDFKit.PDFDocument): { regular: string; bold: string; devanagari: string } => {
  if (fontsAvailable()) {
    doc.registerFont("NotoRegular", FONT_PATHS.regular);
    doc.registerFont("NotoBold", FONT_PATHS.bold);
    doc.registerFont("NotoDevanagari", FONT_PATHS.devanagari);
    return { regular: "NotoRegular", bold: "NotoBold", devanagari: "NotoDevanagari" };
  }

  return { regular: "Helvetica", bold: "Helvetica-Bold", devanagari: "Helvetica" };
};

const hasDevanagari = (text: string): boolean => /[\u0900-\u097F]/.test(text);

const drawCollegeLogo = (
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  size: number
): boolean => {
  if (!collegeLogoExists()) {
    return false;
  }

  doc.image(getCollegeLogoPath(), x, y, {
    fit: [size, size],
    align: "center",
    valign: "center"
  });
  return true;
};

const drawReceiptRow = (
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  fonts: { regular: string; bold: string },
  y: number,
  labelX = 50,
  valueX = 200
): number => {
  doc.font(fonts.bold).fontSize(10).text(label, labelX, y, { width: 140 });
  doc.font(fonts.regular).fontSize(10).text(value, valueX, y, { width: 345 });
  return y + 18;
};

/**
 * Generates a professional fee receipt PDF and streams it to response.
 */
export async function generateFeeReceiptPDF(data: ReceiptData, res: Response): Promise<void> {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const fonts = registerPdfFonts(doc);
  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - 100;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="receipt-${data.receiptNumber}.pdf"`);

  doc.pipe(res);

  if (data.isDuplicate) {
    doc.save();
    doc.rotate(-35, { origin: [pageWidth / 2, 400] });
    doc.fontSize(72).fillColor("#e2e8f0").text("DUPLICATE", 80, 320, { align: "center", width: pageWidth - 160 });
    doc.restore();
    doc.fillColor("#0f172a");
  }

  // Header band
  const headerTop = 40;
  const logoSize = 64;
  const logoInset = 14;
  doc
    .roundedRect(50, headerTop, contentWidth, 88, 8)
    .lineWidth(1)
    .strokeColor("#0c2d6b")
    .stroke();

  drawCollegeLogo(doc, 50 + logoInset, headerTop + 12, logoSize);

  doc.font(fonts.bold).fontSize(18).fillColor("#0f172a").text(data.schoolName, 50, headerTop + 16, {
    align: "center",
    width: contentWidth
  });

  if (data.schoolNameNp && fonts.devanagari !== fonts.regular && hasDevanagari(data.schoolNameNp)) {
    doc.font(fonts.devanagari).fontSize(13).fillColor("#334155").text(data.schoolNameNp, 50, headerTop + 42, {
      align: "center",
      width: contentWidth
    });
  }

  doc
    .font(fonts.regular)
    .fontSize(10)
    .fillColor("#0c2d6b")
    .text("OFFICIAL FEE RECEIPT", 50, headerTop + (data.schoolNameNp ? 64 : 52), {
      align: "center",
      width: contentWidth,
      characterSpacing: 1.2
    });

  let y = headerTop + 108;

  // Receipt meta
  doc.font(fonts.bold).fontSize(11).fillColor("#0f172a").text("Receipt Information", 50, y);
  y += 22;

  y = drawReceiptRow(doc, "Receipt No.", data.receiptNumber, fonts, y);
  y = drawReceiptRow(doc, "Payment Date (BS)", data.paidDateBs, fonts, y);
  if (data.paymentMethod) {
    y = drawReceiptRow(doc, "Payment Method", data.paymentMethod.replace(/_/g, " "), fonts, y);
  }
  if (data.transactionNumber) {
    y = drawReceiptRow(doc, "Transaction No.", data.transactionNumber, fonts, y);
  }
  if (data.verificationCode) {
    y = drawReceiptRow(doc, "Verification Code", data.verificationCode, fonts, y);
  }

  y += 8;
  doc.font(fonts.bold).fontSize(11).fillColor("#0f172a").text("Student Information", 50, y);
  y += 22;

  y = drawReceiptRow(doc, "Student Name", data.studentName, fonts, y);
  y = drawReceiptRow(doc, "Admission No.", data.admissionNumber, fonts, y);
  if (data.rollNumber) y = drawReceiptRow(doc, "Roll No.", String(data.rollNumber), fonts, y);
  y = drawReceiptRow(doc, "Class / Section", `${data.className} / ${data.sectionName}`, fonts, y);

  y += 10;

  // Fee breakdown table
  doc.font(fonts.bold).fontSize(11).fillColor("#0f172a").text("Fee Breakdown", 50, y);
  y += 18;

  const tableTop = y;
  const colDesc = 50;
  const colAmount = 430;
  const tableWidth = contentWidth;

  doc.rect(colDesc, tableTop, tableWidth, 22).fill("#eef3fb");
  doc.fillColor("#0f172a").font(fonts.bold).fontSize(10);
  doc.text("Description", colDesc + 10, tableTop + 6);
  doc.text("Amount (NPR)", colAmount, tableTop + 6, { width: 115, align: "right" });

  y = tableTop + 22;
  const breakdown =
    data.feeBreakdown && data.feeBreakdown.length > 0
      ? data.feeBreakdown
      : [{ feeType: "FEE", title: data.feeTitle, amountNpr: data.amountPaidNpr }];

  breakdown.forEach((item, index) => {
    const rowHeight = 22;
    if (index % 2 === 0) {
      doc.rect(colDesc, y, tableWidth, rowHeight).fill("#f8fafc");
    }
    doc.fillColor("#0f172a").font(fonts.regular).fontSize(10);
    doc.text(item.title, colDesc + 10, y + 6, { width: 360 });
    doc.text(formatCurrencyNpr(item.amountNpr), colAmount, y + 6, { width: 115, align: "right" });
    y += rowHeight;
  });

  doc.rect(colDesc, tableTop, tableWidth, y - tableTop).strokeColor("#cbd5e1").lineWidth(1).stroke();

  y += 14;

  // Summary rows
  const summaryItems: Array<{ label: string; value: string; emphasis?: boolean }> = [
    { label: "Amount Paid", value: formatCurrencyNpr(data.amountPaidNpr) }
  ];

  if (data.discountNpr > 0) summaryItems.push({ label: "Discount", value: `- ${formatCurrencyNpr(data.discountNpr)}` });
  if ((data.scholarshipNpr ?? 0) > 0) {
    summaryItems.push({ label: "Scholarship", value: `- ${formatCurrencyNpr(data.scholarshipNpr!)}` });
  }
  if (data.lateFeeNpr > 0) summaryItems.push({ label: "Late Fine", value: `+ ${formatCurrencyNpr(data.lateFeeNpr)}` });
  if ((data.remainingDueNpr ?? 0) > 0) {
    summaryItems.push({ label: "Remaining Due", value: formatCurrencyNpr(data.remainingDueNpr!) });
  }

  summaryItems.forEach((item) => {
    doc.font(fonts.regular).fontSize(10).fillColor("#334155");
    doc.text(item.label, 300, y, { width: 120, align: "right" });
    doc.font(fonts.bold).fillColor("#0f172a").text(item.value, 430, y, { width: 115, align: "right" });
    y += 18;
  });

  y += 4;
  doc.roundedRect(280, y, 265, 30, 6).fill("#0c2d6b");
  doc.font(fonts.bold).fontSize(12).fillColor("#ffffff");
  doc.text("Total Received", 295, y + 9, { width: 120 });
  doc.text(formatCurrencyNpr(data.totalPaid), 430, y + 9, { width: 100, align: "right" });

  y += 48;

  if (data.accountantName) {
    doc.font(fonts.regular).fontSize(10).fillColor("#334155").text(`Issued by: ${data.accountantName}`, 50, y);
    y += 24;
  }

  doc
    .moveTo(50, y)
    .lineTo(pageWidth - 50, y)
    .strokeColor("#e2e8f0")
    .lineWidth(1)
    .stroke();

  y += 12;
  doc
    .font(fonts.regular)
    .fontSize(9)
    .fillColor("#64748b")
    .text("This is a computer-generated receipt. Thank you for your payment.", 50, y, {
      align: "center",
      width: contentWidth
    });

  doc.end();
}

/**
 * Single-page A4 marksheet PDF — B&W-first premium layout.
 * Black double frame, aligned columns, black table header, compact spacing.
 */
export async function generateMarksheetPDF(data: MarksheetData, res: Response): Promise<void> {
  const margin = 28;
  const doc = new PDFDocument({ size: "A4", margin, autoFirstPage: true });
  const fonts = registerPdfFonts(doc);
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const contentWidth = pageWidth - margin * 2;
  const leftX = margin;
  const INK = "#000000";
  const MUTED = "#333333";
  const LINE = "#444444";
  const SOFT = "#f2f2f2";
  const ROW = "#f7f7f7";

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="marksheet-${data.studentName.replace(/\s+/g, "-")}.pdf"`);

  doc.pipe(res);

  // Double black frame (premium in mono print)
  doc.rect(16, 16, pageWidth - 32, pageHeight - 32).lineWidth(1.6).strokeColor(INK).stroke();
  doc.rect(21, 21, pageWidth - 42, pageHeight - 42).lineWidth(0.7).strokeColor(INK).stroke();

  let y = margin;

  // Logo + college header (compact)
  const logoSize = 42;
  const logoX = leftX + contentWidth / 2 - logoSize / 2;
  doc.circle(logoX + logoSize / 2, y + logoSize / 2, logoSize / 2 + 1.5).lineWidth(1.2).strokeColor(INK).stroke();
  if (!drawCollegeLogo(doc, logoX, y, logoSize)) {
    doc
      .font(fonts.bold)
      .fontSize(16)
      .fillColor(INK)
      .text(data.schoolName.slice(0, 1).toUpperCase(), logoX, y + 12, {
        width: logoSize,
        align: "center"
      });
  }

  y += logoSize + 6;
  doc.font(fonts.bold).fontSize(12).fillColor(INK).text(data.schoolName.toUpperCase(), leftX, y, {
    align: "center",
    width: contentWidth
  });
  y += 14;

  if (data.schoolNameNp && fonts.devanagari !== fonts.regular && hasDevanagari(data.schoolNameNp)) {
    doc.font(fonts.devanagari).fontSize(9).fillColor(MUTED).text(data.schoolNameNp, leftX, y, {
      align: "center",
      width: contentWidth
    });
    y += 11;
  }

  if (data.schoolAddress) {
    doc.font(fonts.regular).fontSize(7.5).fillColor(MUTED).text(data.schoolAddress, leftX, y, {
      align: "center",
      width: contentWidth
    });
    y += 10;
  }

  doc.moveTo(leftX, y).lineTo(leftX + contentWidth, y).lineWidth(1.2).strokeColor(INK).stroke();
  y += 6;
  doc.font(fonts.bold).fontSize(10).fillColor(INK).text("OFFICIAL MARKSHEET", leftX, y, {
    align: "center",
    width: contentWidth,
    characterSpacing: 2
  });
  y += 11;
  doc.font(fonts.bold).fontSize(7).fillColor(MUTED).text("STATEMENT OF MARKS", leftX, y, {
    align: "center",
    width: contentWidth,
    characterSpacing: 1.2
  });
  y += 10;
  doc.font(fonts.bold).fontSize(9.5).fillColor(INK).text(data.examName, leftX, y, {
    align: "center",
    width: contentWidth
  });
  y += 11;
  if (data.academicYearBs) {
    doc.font(fonts.regular).fontSize(7.5).fillColor(MUTED).text(`Academic Session: ${data.academicYearBs}`, leftX, y, {
      align: "center",
      width: contentWidth
    });
    y += 9;
  }
  doc.moveTo(leftX, y).lineTo(leftX + contentWidth, y).lineWidth(0.8).strokeColor(INK).stroke();
  y += 8;

  // Two equal info panels
  const panelGap = 8;
  const panelW = (contentWidth - panelGap) / 2;
  const panelPad = 6;
  const panelTop = y;

  const leftLines: Array<[string, string]> = [["Student Name", data.studentName]];
  if (data.registrationNumber) leftLines.push(["Registration No.", data.registrationNumber]);
  leftLines.push(["Roll No.", String(data.rollNumber)]);
  if (data.batchName) leftLines.push(["Batch", data.batchName]);
  if (data.yearName) leftLines.push(["Year", data.yearName]);
  if (!data.batchName && data.className) leftLines.push(["Class", data.className]);
  if (!data.yearName && data.sectionName) leftLines.push(["Section", data.sectionName]);

  const rightLines: Array<[string, string]> = [["Examination", data.examName]];
  if (data.publishDateBs) rightLines.push(["Published Date", data.publishDateBs]);
  if (data.passFailStatus) rightLines.push(["Result Status", data.passFailStatus]);
  rightLines.push(["GPA", data.gpa.toFixed(2)]);
  rightLines.push(["Percentage", `${data.percentage.toFixed(2)}%`]);

  const rowH = 11;
  const panelH = Math.max(leftLines.length, rightLines.length) * rowH + 18;

  const drawPanel = (x: number, title: string, rows: Array<[string, string]>) => {
    doc.rect(x, panelTop, panelW, panelH).lineWidth(0.9).strokeColor(INK).stroke();
    doc
      .moveTo(x, panelTop + 14)
      .lineTo(x + panelW, panelTop + 14)
      .lineWidth(0.6)
      .strokeColor(INK)
      .stroke();
    doc.font(fonts.bold).fontSize(6.5).fillColor(INK).text(title.toUpperCase(), x + panelPad, panelTop + 4, {
      width: panelW - panelPad * 2,
      characterSpacing: 0.6
    });
    let rowY = panelTop + 17;
    rows.forEach(([label, value]) => {
      doc.font(fonts.regular).fontSize(7.5).fillColor(MUTED).text(label, x + panelPad, rowY, { width: 78 });
      doc.font(fonts.bold).fontSize(7.5).fillColor(INK).text(value, x + panelPad + 78, rowY, {
        width: panelW - panelPad * 2 - 78
      });
      rowY += rowH;
    });
  };

  drawPanel(leftX, "Student particulars", leftLines);
  drawPanel(leftX + panelW + panelGap, "Examination details", rightLines);
  y = panelTop + panelH + 8;

  // Marks table — fixed column alignment
  const columns = [
    { label: "SN", x: leftX, width: 18, align: "center" as const },
    { label: "Subject", x: leftX + 18, width: 100, align: "left" as const },
    { label: "Th", x: leftX + 118, width: 26, align: "center" as const },
    { label: "Pr", x: leftX + 144, width: 26, align: "center" as const },
    { label: "In", x: leftX + 170, width: 26, align: "center" as const },
    { label: "Total", x: leftX + 196, width: 32, align: "center" as const },
    { label: "Full", x: leftX + 228, width: 28, align: "center" as const },
    { label: "Grade", x: leftX + 256, width: 30, align: "center" as const },
    { label: "Status", x: leftX + 286, width: 36, align: "center" as const },
    { label: "Remarks", x: leftX + 322, width: contentWidth - 322, align: "left" as const }
  ];

  // Shrink row height if many subjects so everything fits one page
  const subjectCount = Math.max(data.marks.length, 1);
  const spaceForTable = pageHeight - y - 175; // reserve summary + signatures + meta
  const headerHeight = 14;
  const maxRowH = 13;
  const minRowH = 10;
  const rowHeight = Math.min(
    maxRowH,
    Math.max(minRowH, Math.floor((spaceForTable - headerHeight) / subjectCount))
  );

  const tableTop = y;
  doc.rect(leftX, tableTop, contentWidth, headerHeight).fill(INK);
  doc.fillColor("#ffffff").font(fonts.bold).fontSize(6.5);
  columns.forEach((column) => {
    doc.text(column.label, column.x + 1, tableTop + 3.5, {
      width: column.width - 2,
      align: column.align
    });
  });

  y = tableTop + headerHeight;
  data.marks.forEach((mark, index) => {
    if (index % 2 === 1) {
      doc.rect(leftX, y, contentWidth, rowHeight).fill(ROW);
    }
    doc.rect(leftX, y, contentWidth, rowHeight).lineWidth(0.35).strokeColor(LINE).stroke();
    const values = [
      String(index + 1),
      mark.subject,
      String(mark.theory ?? 0),
      String(mark.practical ?? 0),
      String(mark.internal ?? 0),
      String(mark.obtained),
      String(mark.fullMarks),
      mark.grade ?? "-",
      mark.passFail ?? "-",
      mark.remarks && mark.remarks !== "-" ? mark.remarks : "—"
    ];
    columns.forEach((column, columnIndex) => {
      const isBold = columnIndex === 5 || columnIndex === 7;
      doc
        .fillColor(INK)
        .font(isBold ? fonts.bold : fonts.regular)
        .fontSize(7)
        .text(values[columnIndex] ?? "—", column.x + 1, y + (rowHeight - 8) / 2, {
          width: column.width - 2,
          align: column.align,
          lineBreak: false,
          ellipsis: true
        });
    });
    y += rowHeight;
  });
  // Outer table border
  doc
    .rect(leftX, tableTop, contentWidth, y - tableTop)
    .lineWidth(0.9)
    .strokeColor(INK)
    .stroke();

  // Summary + GPA side by side
  y += 8;
  const summaryW = contentWidth * 0.64;
  const gpaW = contentWidth - summaryW - 8;
  const gpaX = leftX + summaryW + 8;
  const summaryTop = y;

  doc.font(fonts.bold).fontSize(7).fillColor(INK).text("RESULT SUMMARY", leftX, y, { characterSpacing: 0.8 });
  y += 10;

  const summaryRows: Array<[string, string]> = [
    ["Total Obtained Marks", String(data.totalObtained)],
    ["Total Full Marks", String(data.totalFull)],
    ["Percentage", `${data.percentage.toFixed(2)}%`],
    ["GPA", data.gpa.toFixed(2)],
    ["Final Grade", data.grade],
    ["Overall Result", data.passFailStatus ?? "—"]
  ];

  summaryRows.forEach(([label, value], idx) => {
    const rh = 11;
    const bg = idx % 2 === 0 ? SOFT : "#ffffff";
    doc.rect(leftX, y, summaryW, rh).fillAndStroke(bg, LINE);
    if (idx === summaryRows.length - 1) {
      doc.rect(leftX, y, summaryW, rh).lineWidth(1).strokeColor(INK).stroke();
    }
    doc.font(fonts.regular).fontSize(7.5).fillColor(MUTED).text(label, leftX + 5, y + 2, {
      width: summaryW * 0.58
    });
    doc.font(fonts.bold).fontSize(7.5).fillColor(INK).text(value, leftX + summaryW * 0.58, y + 2, {
      width: summaryW * 0.4,
      align: "right"
    });
    y += rh;
  });

  const gpaH = Math.max(y - summaryTop, 78);
  // Outlined GPA card (not solid black — readable B&W)
  doc.rect(gpaX, summaryTop, gpaW, gpaH).lineWidth(1.4).strokeColor(INK).stroke();
  doc.rect(gpaX + 3, summaryTop + 3, gpaW - 6, gpaH - 6).lineWidth(0.6).strokeColor(INK).stroke();
  doc.font(fonts.bold).fontSize(6.5).fillColor(MUTED).text("CUMULATIVE GPA", gpaX, summaryTop + 10, {
    width: gpaW,
    align: "center",
    characterSpacing: 0.8
  });
  doc.font(fonts.bold).fontSize(20).fillColor(INK).text(data.gpa.toFixed(2), gpaX, summaryTop + 24, {
    width: gpaW,
    align: "center"
  });
  doc.font(fonts.regular).fontSize(7.5).fillColor(MUTED).text(`${data.percentage.toFixed(2)}% overall`, gpaX, summaryTop + 50, {
    width: gpaW,
    align: "center"
  });
  doc.font(fonts.bold).fontSize(8).fillColor(INK).text(`GRADE ${data.grade}`, gpaX, summaryTop + 62, {
    width: gpaW,
    align: "center"
  });

  y = Math.max(y, summaryTop + gpaH) + 16;

  // Signatures — aligned two columns
  const half = contentWidth / 2;
  if (data.principalName) {
    doc.font(fonts.regular).fontSize(7.5).fillColor(INK).text(data.principalName, leftX, y, {
      width: half - 16,
      align: "center"
    });
  }
  doc
    .moveTo(leftX + 8, y + 28)
    .lineTo(leftX + half - 20, y + 28)
    .lineWidth(1)
    .strokeColor(INK)
    .stroke();
  doc.font(fonts.bold).fontSize(6.5).fillColor(MUTED).text("PRINCIPAL SIGNATURE", leftX, y + 31, {
    width: half - 16,
    align: "center",
    characterSpacing: 0.5
  });

  const controller = data.controllerOfExamination ?? "Controller of Examination";
  doc
    .moveTo(leftX + half + 12, y + 28)
    .lineTo(leftX + contentWidth - 8, y + 28)
    .lineWidth(1)
    .strokeColor(INK)
    .stroke();
  doc.font(fonts.bold).fontSize(6.5).fillColor(MUTED).text(controller.toUpperCase(), leftX + half, y + 31, {
    width: half - 8,
    align: "center",
    characterSpacing: 0.3
  });

  y += 48;
  doc.moveTo(leftX, y).lineTo(leftX + contentWidth, y).lineWidth(0.7).strokeColor(INK).stroke();
  y += 5;

  doc.font(fonts.regular).fontSize(6.5).fillColor(MUTED);
  const metaParts: string[] = [];
  if (data.printedDateBs) metaParts.push(`Printed Date (BS): ${data.printedDateBs}`);
  if (data.verificationNumber) metaParts.push(`Verification No.: ${data.verificationNumber}`);
  if (metaParts.length) {
    doc.text(metaParts.join("   |   "), leftX, y, { width: contentWidth });
    y += 9;
  }
  doc
    .font(fonts.regular)
    .fontSize(6)
    .fillColor(MUTED)
    .text(
      "Computer-generated official marksheet. Authenticity may be verified with the institution using the verification number.",
      leftX,
      y,
      { width: contentWidth }
    );

  doc.end();
}