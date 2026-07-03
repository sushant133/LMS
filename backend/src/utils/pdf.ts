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
  examName: string;
  studentName: string;
  className: string;
  sectionName: string;
  rollNumber: number;
  marks: Array<{
    subject: string;
    fullMarks: number;
    obtained: number;
  }>;
  totalObtained: number;
  totalFull: number;
  percentage: number;
  gpa: number;
  grade: string;
  publishDateBs?: string;
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

/**
 * Generates a basic marksheet PDF.
 */
export async function generateMarksheetPDF(data: MarksheetData, res: Response): Promise<void> {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const fonts = registerPdfFonts(doc);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="marksheet-${data.studentName.replace(/\s+/g, "-")}.pdf"`);

  doc.pipe(res);

  doc.font(fonts.bold).fontSize(16).fillColor("#0f172a").text(data.schoolName, { align: "center" });
  doc.font(fonts.regular).fontSize(12).text(`Marksheet - ${data.examName}`, { align: "center" });
  doc.moveDown();

  doc.fontSize(11);
  doc.text(`Student: ${data.studentName}`);
  doc.text(`Class: ${data.className} | Section: ${data.sectionName} | Roll: ${data.rollNumber}`);
  doc.moveDown();

  doc.font(fonts.bold);
  doc.text("Subject", 50, doc.y, { continued: true });
  doc.text("Full Marks", 250, doc.y, { continued: true });
  doc.text("Obtained", 350, doc.y);
  doc.moveDown(0.2);

  doc.font(fonts.regular);
  data.marks.forEach((m) => {
    doc.text(m.subject, 50, doc.y, { continued: true });
    doc.text(String(m.fullMarks), 250, doc.y, { continued: true });
    doc.text(String(m.obtained), 350, doc.y);
  });

  doc.moveDown(0.5);
  doc.font(fonts.bold);
  doc.text(`Total: ${data.totalObtained} / ${data.totalFull}`);
  doc.text(`Percentage: ${data.percentage.toFixed(2)}%`);
  doc.text(`GPA: ${data.gpa.toFixed(2)}   Grade: ${data.grade}`);

  if (data.publishDateBs) {
    doc.moveDown();
    doc.font(fonts.regular).text(`Published: ${data.publishDateBs}`);
  }

  doc.end();
}