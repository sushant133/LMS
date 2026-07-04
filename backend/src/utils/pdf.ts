import PDFDocument from "pdfkit";
import type { Response } from "express";
import fs from "fs";
import path from "path";
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
  feeBreakdown?: Array<{ feeType: string; title: string; amountNpr: number }>;
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

  // Header band
  const headerTop = 40;
  doc
    .roundedRect(50, headerTop, contentWidth, 88, 8)
    .lineWidth(1)
    .strokeColor("#059669")
    .stroke();

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
    .fillColor("#059669")
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

  doc.rect(colDesc, tableTop, tableWidth, 22).fill("#ecfdf5");
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
  doc.roundedRect(280, y, 265, 30, 6).fill("#059669");
  doc.font(fonts.bold).fontSize(12).fillColor("#ffffff");
  doc.text("Total Received", 295, y + 9, { width: 120 });
  doc.text(formatCurrencyNpr(data.totalPaid), 430, y + 9, { width: 100, align: "right" });

  y += 48;

  if (data.accountantName) {
    doc.font(fonts.regular).fontSize(10).fillColor("#334155").text(`Received by: ${data.accountantName}`, 50, y);
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

const drawMarksheetInfoRow = (
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  fonts: { regular: string; bold: string },
  x: number,
  y: number,
  labelWidth: number,
  valueWidth: number
): number => {
  doc.font(fonts.bold).fontSize(9).fillColor("#000000").text(`${label}:`, x, y, { width: labelWidth });
  doc.font(fonts.regular).fontSize(9).text(value, x + labelWidth, y, { width: valueWidth });
  return y + 14;
};

/**
 * Generates an official A4 marksheet PDF matching the HTML preview layout.
 */
export async function generateMarksheetPDF(data: MarksheetData, res: Response): Promise<void> {
  const margin = 42;
  const doc = new PDFDocument({ size: "A4", margin });
  const fonts = registerPdfFonts(doc);
  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - margin * 2;
  const leftX = margin;
  const rightX = margin + contentWidth / 2 + 8;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="marksheet-${data.studentName.replace(/\s+/g, "-")}.pdf"`);

  doc.pipe(res);

  let y = margin;

  doc.rect(leftX + contentWidth / 2 - 28, y, 56, 56).lineWidth(1).strokeColor("#000000").stroke();
  doc
    .font(fonts.bold)
    .fontSize(18)
    .fillColor("#000000")
    .text(data.schoolName.slice(0, 1).toUpperCase(), leftX + contentWidth / 2 - 28, y + 16, {
      width: 56,
      align: "center"
    });

  y += 64;
  doc.font(fonts.bold).fontSize(16).text(data.schoolName, leftX, y, { align: "center", width: contentWidth });
  y += 20;

  if (data.schoolNameNp && fonts.devanagari !== fonts.regular && hasDevanagari(data.schoolNameNp)) {
    doc.font(fonts.devanagari).fontSize(11).text(data.schoolNameNp, leftX, y, { align: "center", width: contentWidth });
    y += 14;
  }

  if (data.schoolAddress) {
    doc.font(fonts.regular).fontSize(9).text(data.schoolAddress, leftX, y, { align: "center", width: contentWidth });
    y += 14;
  }

  doc.moveTo(leftX, y).lineTo(leftX + contentWidth, y).lineWidth(1).strokeColor("#000000").stroke();
  y += 10;

  doc.font(fonts.bold).fontSize(12).text("OFFICIAL MARKSHEET", leftX, y, { align: "center", width: contentWidth });
  y += 16;
  doc.font(fonts.bold).fontSize(10).text(data.examName, leftX, y, { align: "center", width: contentWidth });
  y += 14;
  if (data.academicYearBs) {
    doc.font(fonts.regular).fontSize(9).text(`Academic Session: ${data.academicYearBs}`, leftX, y, {
      align: "center",
      width: contentWidth
    });
    y += 16;
  }

  doc.moveTo(leftX, y).lineTo(leftX + contentWidth, y).lineWidth(0.5).strokeColor("#000000").stroke();
  y += 12;

  const columnWidth = contentWidth / 2 - 12;
  let leftY = y;
  let rightY = y;

  leftY = drawMarksheetInfoRow(doc, "Student Name", data.studentName, fonts, leftX, leftY, 88, columnWidth - 88);
  if (data.registrationNumber) {
    leftY = drawMarksheetInfoRow(doc, "Registration No.", data.registrationNumber, fonts, leftX, leftY, 88, columnWidth - 88);
  }
  leftY = drawMarksheetInfoRow(doc, "Roll No.", String(data.rollNumber), fonts, leftX, leftY, 88, columnWidth - 88);
  if (data.batchName) {
    leftY = drawMarksheetInfoRow(doc, "Batch", data.batchName, fonts, leftX, leftY, 88, columnWidth - 88);
  }
  if (data.yearName) {
    leftY = drawMarksheetInfoRow(doc, "Year", data.yearName, fonts, leftX, leftY, 88, columnWidth - 88);
  }

  rightY = drawMarksheetInfoRow(doc, "Examination", data.examName, fonts, rightX, rightY, 88, columnWidth - 88);
  if (data.publishDateBs) {
    rightY = drawMarksheetInfoRow(doc, "Published Date", data.publishDateBs, fonts, rightX, rightY, 88, columnWidth - 88);
  }
  if (data.passFailStatus) {
    rightY = drawMarksheetInfoRow(doc, "Result Status", data.passFailStatus, fonts, rightX, rightY, 88, columnWidth - 88);
  }
  rightY = drawMarksheetInfoRow(doc, "GPA", data.gpa.toFixed(2), fonts, rightX, rightY, 88, columnWidth - 88);
  rightY = drawMarksheetInfoRow(doc, "Percentage", `${data.percentage.toFixed(2)}%`, fonts, rightX, rightY, 88, columnWidth - 88);

  y = Math.max(leftY, rightY) + 8;

  const columns = [
    { label: "SN", x: leftX, width: 18, align: "center" as const },
    { label: "Subject", x: leftX + 18, width: 88, align: "left" as const },
    { label: "Th", x: leftX + 106, width: 24, align: "center" as const },
    { label: "Pr", x: leftX + 130, width: 24, align: "center" as const },
    { label: "In", x: leftX + 154, width: 24, align: "center" as const },
    { label: "Total", x: leftX + 178, width: 30, align: "center" as const },
    { label: "Full", x: leftX + 208, width: 30, align: "center" as const },
    { label: "Grade", x: leftX + 238, width: 34, align: "center" as const },
    { label: "Status", x: leftX + 272, width: 38, align: "center" as const },
    { label: "Remarks", x: leftX + 310, width: contentWidth - 310, align: "left" as const }
  ];

  const headerHeight = 18;
  const tableTop = y;
  doc.rect(leftX, tableTop, contentWidth, headerHeight).fillAndStroke("#ffffff", "#000000");
  doc.fillColor("#000000").font(fonts.bold).fontSize(7.5);
  columns.forEach((column) => {
    doc.text(column.label, column.x + 2, tableTop + 5, {
      width: column.width - 4,
      align: column.align
    });
  });

  y = tableTop + headerHeight;
  doc.font(fonts.regular).fontSize(7.5);
  data.marks.forEach((mark, index) => {
    const rowHeight = 16;
    doc.rect(leftX, y, contentWidth, rowHeight).strokeColor("#000000").lineWidth(0.5).stroke();
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
      mark.remarks ?? "-"
    ];
    columns.forEach((column, columnIndex) => {
      doc.text(values[columnIndex] ?? "-", column.x + 2, y + 4, {
        width: column.width - 4,
        align: column.align,
        lineBreak: false
      });
    });
    y += rowHeight;
  });

  y += 10;
  doc.font(fonts.bold).fontSize(9).text("Result Summary", leftX, y);
  y += 14;

  const summaryRows: Array<[string, string]> = [
    ["Total Obtained Marks", String(data.totalObtained)],
    ["Total Full Marks", String(data.totalFull)],
    ["Percentage", `${data.percentage.toFixed(2)}%`],
    ["GPA", data.gpa.toFixed(2)],
    ["Final Grade", data.grade],
    ["Result", data.passFailStatus ?? "-"]
  ];

  summaryRows.forEach(([label, value]) => {
    doc.font(fonts.bold).fontSize(9).text(label, leftX, y, { width: 150 });
    doc.font(fonts.regular).fontSize(9).text(value, leftX + 155, y, { width: 120 });
    y += 13;
  });

  y += 18;
  const footerTop = y;
  const third = contentWidth / 3;

  doc.moveTo(leftX, footerTop + 40).lineTo(leftX + third - 20, footerTop + 40).strokeColor("#000000").stroke();
  doc.font(fonts.regular).fontSize(8).text("Principal Signature", leftX, footerTop + 44, { width: third - 20, align: "center" });
  if (data.principalName) {
    doc.font(fonts.regular).fontSize(8).text(data.principalName, leftX, footerTop + 24, { width: third - 20, align: "center" });
  }

  const controller = data.controllerOfExamination ?? "Controller of Examination";
  doc
    .moveTo(leftX + third + 10, footerTop + 40)
    .lineTo(leftX + third * 2 - 10, footerTop + 40)
    .stroke();
  doc.text(controller, leftX + third, footerTop + 44, { width: third, align: "center" });

  const sealX = leftX + third * 2 + 20;
  doc.rect(sealX, footerTop, 70, 70).lineWidth(1).dash(2, { space: 2 }).strokeColor("#000000").stroke();
  doc.undash();
  doc.text("College Seal", sealX, footerTop + 28, { width: 70, align: "center" });

  y = footerTop + 82;
  doc.moveTo(leftX, y).lineTo(leftX + contentWidth, y).lineWidth(0.5).strokeColor("#000000").stroke();
  y += 8;

  doc.font(fonts.regular).fontSize(8).fillColor("#000000");
  if (data.printedDateBs) {
    doc.text(`Printed Date: ${data.printedDateBs}`, leftX, y);
  }
  if (data.verificationNumber) {
    doc.text(`Verification No.: ${data.verificationNumber}`, leftX + 180, y);
  }

  const qrX = leftX + contentWidth - 52;
  doc.rect(qrX, y - 4, 48, 48).lineWidth(0.5).strokeColor("#000000").stroke();
  doc.fontSize(7).text("QR Code", qrX, y + 16, { width: 48, align: "center" });

  doc.end();
}