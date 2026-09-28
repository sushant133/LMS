import { COLLEGE_LOGO_URL } from "@phit-erp/shared";
import { jsPDF } from "jspdf";

/**
 * Examination Attendance Sheet — one sheet (one or more pages) per subject.
 * The candidate list is identical on every sheet; only the subject, date and
 * time change. Drawn as vector text so rows never split across pages.
 */

export interface AttendanceSheetCandidate {
  symbolNo: string;
  name: string;
}

export interface AttendanceSheetSubject {
  name: string;
  code?: string;
  dateBs?: string;
  time?: string;
  hall?: string;
}

export interface AttendanceSheetInput {
  college: { name: string; address?: string };
  examName: string;
  program?: string;
  yearLabel: string;
  subjects: AttendanceSheetSubject[];
  candidates: AttendanceSheetCandidate[];
}

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN_X = 15;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
/** Students printed on every page of a subject's sheet. */
const ROWS_PER_PAGE = 20;
/** Tallest a row gets — enough room for a comfortable signature. */
const MAX_ROW_HEIGHT = 9;
const HEADER_ROW_HEIGHT = 8;
const PAGE_FOOTER_Y = PAGE_HEIGHT - 8;
/** Dotted signature lines sit here on every page; the labels print just below. */
const SIGNATURE_LINE_Y = PAGE_FOOTER_Y - 13;
/** Rows stop here, leaving room above the dotted lines to actually sign. */
const TABLE_BOTTOM = SIGNATURE_LINE_Y - 16;
/** Where the table starts on a continuation page (header + "continued" line), with slack. */
const CONTINUATION_TABLE_TOP = 50;
/** Room the Total / Present / Absent line needs under the last row. */
const TOTALS_HEIGHT = 9;

const COLUMNS = [
  { label: "SN", width: 12, align: "center" as const },
  { label: "Symbol No.", width: 32, align: "left" as const },
  { label: "Name of Student", width: 76, align: "left" as const },
  { label: "Signature", width: 36, align: "left" as const },
  { label: "Remarks", width: 24, align: "left" as const },
];

/**
 * Printed at the bottom of every page, theory and practical alike. Each entry is
 * the label's lines — the long title is broken where it reads naturally.
 */
const SIGNATORIES: string[][] = [
  ["Signature of Invigilator"],
  ["Signature of Principal /", "Vice Principal"],
  ["Signature of Director"],
];

let logoCache: Promise<string> | null = null;

/** The college logo as a data URI ("" when it cannot be loaded — the sheet prints without it). */
const loadLogo = (): Promise<string> => {
  logoCache ??= fetch(COLLEGE_LOGO_URL)
    .then((response) => (response.ok ? response.blob() : Promise.reject()))
    .then(
      (blob) =>
        new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => resolve("");
          reader.readAsDataURL(blob);
        }),
    )
    .catch(() => "");
  return logoCache;
};

/** Fit text into a width, trimming with an ellipsis rather than overflowing the cell. */
const fitText = (doc: jsPDF, text: string, maxWidth: number): string => {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 1 && doc.getTextWidth(`${trimmed}…`) > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
};

/** Institution header + sheet title. Returns the y where the particulars start. */
const drawHeader = (doc: jsPDF, input: AttendanceSheetInput, logo: string): number => {
  let y = 14;
  if (logo) {
    try {
      doc.addImage(logo, "PNG", MARGIN_X, 9, 20, 20);
    } catch {
      // Unreadable image — the header text still identifies the college.
    }
  }

  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(input.college.name.toUpperCase(), PAGE_WIDTH / 2, y, { align: "center" });
  y += 5.5;

  if (input.college.address) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.text(input.college.address, PAGE_WIDTH / 2, y, { align: "center" });
    y += 5;
  }

  // The exam name is the sheet's only title.
  y += 1;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(fitText(doc, input.examName, CONTENT_WIDTH - 50), PAGE_WIDTH / 2, y, {
    align: "center",
  });
  // Keep the rule clear of the 20 mm logo.
  y = Math.max(y + 3, 31);

  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, y, PAGE_WIDTH - MARGIN_X, y);
  doc.setLineWidth(0.2);
  return y + 6;
};

/** "Label : value" pairs in two columns, like the board's sheet. */
const drawParticulars = (
  doc: jsPDF,
  input: AttendanceSheetInput,
  subject: AttendanceSheetSubject,
  startY: number,
): number => {
  const subjectLabel = subject.code ? `${subject.name} (${subject.code})` : subject.name;
  // The institute's name and address are already in the page header.
  const left: Array<[string, string]> = [
    ["Course/Program", input.program || "—"],
    ["Subject", subjectLabel],
    ["Year/Part", input.yearLabel],
  ];
  const right: Array<[string, string]> = [
    ["Examination Date", subject.dateBs ? `${subject.dateBs} BS` : ""],
    ["Time", subject.time ?? ""],
  ];
  if (subject.hall) right.push(["Exam Hall", subject.hall]);

  const leftWidth = 116;
  const rightX = MARGIN_X + leftWidth + 6;
  const rightWidth = CONTENT_WIDTH - leftWidth - 6;

  doc.setFontSize(10);
  const drawPair = (x: number, y: number, width: number, label: string, value: string): number => {
    doc.setFont("helvetica", "normal");
    const prefix = `${label} : `;
    doc.text(prefix, x, y);
    const prefixWidth = doc.getTextWidth(prefix);
    doc.setFont("helvetica", "bold");
    const lines = doc.splitTextToSize(value || " ", width - prefixWidth) as string[];
    doc.text(lines, x + prefixWidth, y);
    return lines.length;
  };

  let leftY = startY;
  for (const [label, value] of left) {
    leftY += drawPair(MARGIN_X, leftY, leftWidth, label, value) * 4.6 + 1.6;
  }
  let rightY = startY;
  for (const [label, value] of right) {
    rightY += drawPair(rightX, rightY, rightWidth, label, value) * 4.6 + 1.6;
  }
  return Math.max(leftY, rightY) + 1;
};

const drawTableHeader = (doc: jsPDF, y: number): number => {
  doc.setFillColor(226, 232, 240);
  doc.rect(MARGIN_X, y, CONTENT_WIDTH, HEADER_ROW_HEIGHT, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  let x = MARGIN_X;
  for (const column of COLUMNS) {
    doc.rect(x, y, column.width, HEADER_ROW_HEIGHT);
    doc.text(column.label, x + column.width / 2, y + 5.4, { align: "center" });
    x += column.width;
  }
  return y + HEADER_ROW_HEIGHT;
};

const drawRow = (
  doc: jsPDF,
  y: number,
  rowHeight: number,
  index: number,
  candidate: AttendanceSheetCandidate,
) => {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const values = [String(index + 1), candidate.symbolNo, candidate.name.toUpperCase(), "", ""];
  // Vertically centred baseline for 10pt text.
  const baseline = y + rowHeight / 2 + 1.3;
  let x = MARGIN_X;
  COLUMNS.forEach((column, i) => {
    doc.rect(x, y, column.width, rowHeight);
    const value = values[i] ?? "";
    if (value) {
      const text = fitText(doc, value, column.width - 4);
      if (column.align === "center") {
        doc.text(text, x + column.width / 2, baseline, { align: "center" });
      } else {
        doc.text(text, x + 2, baseline);
      }
    }
    x += column.width;
  });
};

/** Total / Present / Absent line under the last row of a subject's sheet. */
const drawTotals = (doc: jsPDF, input: AttendanceSheetInput, y: number) => {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Total Candidates: ${input.candidates.length}`, MARGIN_X, y);
  doc.text("Present: ..............", MARGIN_X + 70, y);
  doc.text("Absent: ..............", MARGIN_X + 125, y);
};

/** The three signature lines, fixed at the bottom of every page. */
const drawSignatures = (doc: jsPDF) => {
  const blockWidth = CONTENT_WIDTH / 3;
  SIGNATORIES.forEach((lines, i) => {
    const centerX = MARGIN_X + i * blockWidth + blockWidth / 2;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("........................................", centerX, SIGNATURE_LINE_Y, {
      align: "center",
    });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    lines.forEach((line, lineIndex) => {
      doc.text(line, centerX, SIGNATURE_LINE_Y + 5 + lineIndex * 4, { align: "center" });
    });
  });
};

/** Page number only — subject and date are already in the page header. */
const drawPageFooter = (doc: jsPDF, page: number, totalPages: number) => {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`Page ${page} of ${totalPages}`, PAGE_WIDTH - MARGIN_X, PAGE_FOOTER_Y, { align: "right" });
  doc.setTextColor(15, 23, 42);
};

export const buildAttendanceSheetPdf = async (input: AttendanceSheetInput): Promise<jsPDF> => {
  const logo = await loadLogo();
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  input.subjects.forEach((subject, subjectIndex) => {
    if (subjectIndex > 0) doc.addPage();

    const headerBottom = drawHeader(doc, input, logo);
    const particularsBottom = drawParticulars(doc, input, subject, headerBottom);

    // Exactly ROWS_PER_PAGE students per page. Rows are as tall as the first
    // page allows (it carries the particulars), capped for a tidy table, with
    // room kept under the last row for the totals line.
    const rowHeight = Math.min(
      MAX_ROW_HEIGHT,
      (TABLE_BOTTOM - particularsBottom - HEADER_ROW_HEIGHT - TOTALS_HEIGHT) / ROWS_PER_PAGE,
    );
    const pages: number[] = [];
    for (let left = input.candidates.length; left > 0; left -= ROWS_PER_PAGE) {
      pages.push(Math.min(left, ROWS_PER_PAGE));
    }
    if (pages.length === 0) pages.push(0);
    const totalPages = pages.length;

    let cursor = 0;
    let y = particularsBottom;
    pages.forEach((rowCount, pageIndex) => {
      if (pageIndex > 0) {
        doc.addPage();
        y = drawHeader(doc, input, logo);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text(
          fitText(
            doc,
            `Subject: ${subject.name}${subject.dateBs ? `   ·   Date: ${subject.dateBs} BS` : ""}   (continued)`,
            CONTENT_WIDTH,
          ),
          MARGIN_X,
          y,
        );
        y = Math.max(y + 4, CONTINUATION_TABLE_TOP - 0.01);
      }
      y = drawTableHeader(doc, y);
      for (let i = 0; i < rowCount; i += 1) {
        const candidate = input.candidates[cursor];
        if (candidate) drawRow(doc, y, rowHeight, cursor, candidate);
        cursor += 1;
        y += rowHeight;
      }
      drawSignatures(doc);
      drawPageFooter(doc, pageIndex + 1, totalPages);
    });

    drawTotals(doc, input, y + 7);
  });

  return doc;
};

/**
 * A tab to print into, opened synchronously on the click — browsers block
 * window.open once the PDF has been built asynchronously.
 */
export const openPrintWindow = (): Window | null => {
  const win = window.open("", "_blank");
  if (win) {
    win.document.title = "Preparing attendance sheet…";
    win.document.body.style.cssText = "font-family:sans-serif;padding:24px;color:#475569";
    win.document.body.textContent = "Preparing attendance sheet…";
  }
  return win;
};

/**
 * Print the PDF in its own tab through the browser's PDF viewer, so every A4
 * page prints full size exactly as the downloaded file. (Printing from a hidden
 * iframe let the viewer size pages from the invisible frame and cut them off.)
 * Falls back to a download when the tab could not be opened.
 */
export const printPdf = (doc: jsPDF, win: Window | null, filename: string): void => {
  doc.autoPrint();
  const url = URL.createObjectURL(doc.output("blob"));
  if (win && !win.closed) {
    win.location.href = url;
  } else {
    doc.save(filename);
  }
  // Keep the blob alive while the viewer loads and the print dialog is open.
  window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
};
