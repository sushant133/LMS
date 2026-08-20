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
  schoolAddress?: string;
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

const registerPdfFonts = (doc: PDFKit.PDFDocument): { regular: string; bold: string; devanagari: string } => {
  if (fontsAvailable()) {
    doc.registerFont("NotoRegular", FONT_PATHS.regular);
    doc.registerFont("NotoBold", FONT_PATHS.bold);
    doc.registerFont("NotoDevanagari", FONT_PATHS.devanagari);
    return { regular: "NotoRegular", bold: "NotoBold", devanagari: "NotoDevanagari" };
  }

  return { regular: "Helvetica", bold: "Helvetica-Bold", devanagari: "Helvetica" };
};

const hasDevanagari = (text: string): boolean => /[ऀ-ॿ]/.test(text);

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

  // Header band — college name + address + document title
  const headerTop = 40;
  const logoSize = 64;
  const logoInset = 14;
  const hasNp =
    Boolean(data.schoolNameNp) &&
    fonts.devanagari !== fonts.regular &&
    hasDevanagari(data.schoolNameNp ?? "");
  const hasAddress = Boolean(data.schoolAddress?.trim());
  // Grow header height when nameNp and/or address are present
  const headerHeight = 88 + (hasNp ? 8 : 0) + (hasAddress ? 16 : 0);
  doc
    .roundedRect(50, headerTop, contentWidth, headerHeight, 8)
    .lineWidth(1)
    .strokeColor("#0c2d6b")
    .stroke();

  drawCollegeLogo(doc, 50 + logoInset, headerTop + 12, logoSize);

  let headerY = headerTop + 16;
  doc.font(fonts.bold).fontSize(18).fillColor("#0f172a").text(data.schoolName, 50, headerY, {
    align: "center",
    width: contentWidth
  });
  headerY += 22;

  if (hasNp && data.schoolNameNp) {
    doc.font(fonts.devanagari).fontSize(12).fillColor("#334155").text(data.schoolNameNp, 50, headerY, {
      align: "center",
      width: contentWidth
    });
    headerY += 16;
  }

  if (hasAddress && data.schoolAddress) {
    doc
      .font(fonts.regular)
      .fontSize(9)
      .fillColor("#475569")
      .text(data.schoolAddress.trim(), 50, headerY, {
        align: "center",
        width: contentWidth
      });
    headerY += 14;
  }

  doc
    .font(fonts.regular)
    .fontSize(10)
    .fillColor("#0c2d6b")
    .text("OFFICIAL FEE RECEIPT", 50, headerY, {
      align: "center",
      width: contentWidth,
      characterSpacing: 1.2
    });

  let y = headerTop + headerHeight + 20;

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
    .text("Thank you for your payment.", 50, y, {
      align: "center",
      width: contentWidth
    });

  doc.end();
}
