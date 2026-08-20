/**
 * Individual marksheet — server-rendered HTML converted to PDF via Puppeteer
 * (see convertHtmlToPdf.ts). Markup + styling are kept in lockstep with the
 * on-screen/print component at frontend/src/features/exams/ResultMarksheetView.tsx
 * and frontend/src/styles/marksheet.css, so "Download PDF" and the browser
 * "Print" button produce the same document. If either one changes, mirror
 * the change in the other.
 */
import { convertHtmlToPdf } from "../convertHtmlToPdf.js";

export interface MarksheetTemplateSubjectRow {
  subject: string;
  fullMarks: number;
  passMarks?: number;
  theory?: number;
  practical?: number;
  obtained: number;
  passFail?: string;
  remarks?: string;
}

export interface MarksheetTemplateData {
  collegeName: string;
  collegeNameNp?: string;
  collegeAddress?: string;
  collegeLogoDataUri?: string;
  controllerOfExamination?: string;
  examName: string;
  academicYearBs?: string;
  examHeldDateBs?: string;
  studentName: string;
  registrationNumber?: string;
  rollNumber: number;
  batchName?: string;
  yearName?: string;
  className?: string;
  sectionName?: string;
  marks: MarksheetTemplateSubjectRow[];
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

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const isPassStatus = (status?: string): boolean => String(status ?? "").toUpperCase().includes("PASS");

const infoRow = (label: string, value: string, extraClass = ""): string => `
  <div class="om-info-row">
    <dt>${escapeHtml(label)}</dt>
    <dd${extraClass ? ` class="${extraClass}"` : ""}>${value}</dd>
  </div>`;

export const buildMarksheetHtml = (data: MarksheetTemplateData): string => {
  const isPass = isPassStatus(data.passFailStatus);

  const studentRows = [infoRow("Student Name", escapeHtml(data.studentName))];
  if (data.registrationNumber) studentRows.push(infoRow("Registration No.", escapeHtml(data.registrationNumber)));
  studentRows.push(infoRow("Roll No.", escapeHtml(data.rollNumber)));
  if (data.batchName) studentRows.push(infoRow("Batch", escapeHtml(data.batchName)));
  if (data.yearName) studentRows.push(infoRow("Year", escapeHtml(data.yearName)));
  if (!data.batchName && data.className) studentRows.push(infoRow("Class", escapeHtml(data.className)));
  if (!data.yearName && data.sectionName) studentRows.push(infoRow("Section", escapeHtml(data.sectionName)));

  const examRows = [infoRow("Examination", escapeHtml(data.examName))];
  if (data.examHeldDateBs) examRows.push(infoRow("Exam Held Date", escapeHtml(data.examHeldDateBs)));
  if (data.publishDateBs) examRows.push(infoRow("Published Date", escapeHtml(data.publishDateBs)));
  if (data.passFailStatus) {
    examRows.push(
      infoRow("Result Status", escapeHtml(data.passFailStatus), isPass ? "om-status-pass" : "om-status-fail")
    );
  }

  const tableRows = data.marks
    .map((mark, index) => {
      const status = mark.passFail ?? "-";
      const statusIsPass = isPassStatus(status);
      return `
      <tr>
        <td class="col-sn">${index + 1}</td>
        <td class="col-subject">${escapeHtml(mark.subject)}</td>
        <td class="col-full">${escapeHtml(mark.fullMarks)}</td>
        <td class="col-pass">${mark.passMarks !== undefined ? escapeHtml(mark.passMarks) : "-"}</td>
        <td class="col-theory">${escapeHtml(mark.theory ?? 0)}</td>
        <td class="col-practical">${escapeHtml(mark.practical ?? 0)}</td>
        <td class="col-obtained">${escapeHtml(mark.obtained)}</td>
        <td class="col-status"><span class="om-badge ${statusIsPass ? "om-badge-pass" : "om-badge-fail"}">${escapeHtml(status)}</span></td>
        <td class="col-remarks">${escapeHtml(mark.remarks ?? "")}</td>
      </tr>`;
    })
    .join("");

  const metaParts: string[] = [];
  if (data.printedDateBs) metaParts.push(`Printed Date (BS): ${escapeHtml(data.printedDateBs)}`);
  if (data.verificationNumber) metaParts.push(`Verification No.: ${escapeHtml(data.verificationNumber)}`);

  const controller = escapeHtml(data.controllerOfExamination ?? "Controller of Examination");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Marksheet</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Noto+Sans+Devanagari:ital,wght@0,100..900;1,100..900&display=swap" rel="stylesheet"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }

  @page { size: A4 portrait; margin: 6mm 7mm; }

  body {
    font-family: "IBM Plex Sans", "Noto Sans Devanagari", "Times New Roman", "Segoe UI", serif;
  }

  .official-marksheet {
    --om-ink: #14213d;
    --om-muted: #4b5666;
    --om-soft: #f4f5f8;
    --om-row: #f8f9fb;
    --om-white: #ffffff;
    --om-accent: #a9812f;
    --om-accent-ink: #7c5e21;

    position: relative;
    width: 100%;
    color: var(--om-ink);
    font-size: 9.5pt;
    line-height: 1.25;
    background: var(--om-white);
    padding: 5mm 6mm;
    border: 1.5px solid var(--om-ink);
    box-shadow:
      inset 0 0 0 3px var(--om-white),
      inset 0 0 0 3.75px var(--om-accent),
      inset 0 0 0 4.5px var(--om-ink);
  }

  .om-header {
    text-align: center;
    margin: 0 0 6px;
    padding: 0 0 6px;
    border-bottom: 1.5px solid var(--om-ink);
    position: relative;
  }
  .om-header::after {
    content: "";
    position: absolute;
    left: 50%;
    bottom: -2.5px;
    transform: translateX(-50%);
    width: 64px;
    height: 2px;
    background: var(--om-accent);
  }
  .om-header-band { display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 4px; }
  .om-logo {
    width: 52px; height: 52px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
    border: 1.5px solid var(--om-ink);
    outline: 1px solid var(--om-accent);
    outline-offset: 2px;
    border-radius: 50%;
    padding: 2px;
    background: var(--om-white);
  }
  .om-logo img { width: 100%; height: 100%; object-fit: contain; }
  .om-logo-fallback { font-size: 1.25rem; font-weight: 700; color: var(--om-ink); }
  .om-header-text { min-width: 0; text-align: center; }
  .om-college-name {
    margin: 0; font-size: 18pt; font-weight: 800; letter-spacing: 0.02em;
    text-transform: uppercase; color: var(--om-ink); line-height: 1.15;
    font-family: "Times New Roman", "Noto Serif", Georgia, serif;
  }
  .om-college-name-np { margin: 2px 0 0; font-size: 9pt; color: var(--om-muted); font-weight: 500; }
  .om-college-address { margin: 2px 0 0; font-size: 7.5pt; color: var(--om-muted); }
  .om-title-block { margin-top: 5px; padding-top: 4px; border-top: 0.75px solid var(--om-accent); }
  .om-doc-title { margin: 0; font-size: 10pt; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase; color: var(--om-ink); }
  .om-doc-title-sub { margin: 1px 0 0; font-size: 7pt; letter-spacing: 0.16em; text-transform: uppercase; color: var(--om-accent-ink); font-weight: 600; }
  .om-exam-name { margin: 3px 0 0; font-size: 10pt; font-weight: 700; color: var(--om-ink); }
  .om-session { margin: 1px 0 0; font-size: 7.5pt; color: var(--om-muted); }

  .om-student-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 8px; margin: 0 0 6px; }
  .om-info-panel { margin: 0; padding: 5px 7px 4px; background: var(--om-white); border: 1px solid var(--om-ink); border-left: 2.5px solid var(--om-accent); }
  .om-info-panel-title { margin: 0 0 4px; padding-bottom: 2px; font-size: 7pt; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--om-ink); border-bottom: 1px solid var(--om-ink); }
  .om-info-list { margin: 0; padding: 0; }
  .om-info-row { display: grid; grid-template-columns: 100px 1fr; column-gap: 4px; margin: 0 0 2px; font-size: 8pt; align-items: baseline; }
  .om-info-row dt { margin: 0; font-weight: 600; color: var(--om-muted); }
  .om-info-row dd { margin: 0; font-weight: 700; color: var(--om-ink); word-break: break-word; }
  .om-status-pass, .om-status-fail { color: var(--om-ink) !important; font-weight: 700 !important; text-decoration: underline; text-underline-offset: 2px; text-decoration-color: var(--om-accent); }

  .om-marks-table-wrap { width: 100%; overflow: hidden; border: 1.25px solid var(--om-ink); }
  .om-marks-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 7.5pt; }
  .om-marks-table th, .om-marks-table td { border: 0.6px solid #444; padding: 3px 2px; vertical-align: middle; }
  .om-marks-table thead th {
    font-weight: 700; text-align: center;
    background: var(--om-ink); color: #ffffff; border-color: var(--om-ink);
    border-bottom: 2px solid var(--om-accent);
    letter-spacing: 0.02em; font-size: 7pt; text-transform: uppercase;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .om-marks-table tbody tr:nth-child(even) { background: var(--om-row); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .om-marks-table .col-sn, .om-marks-table .col-full, .om-marks-table .col-pass,
  .om-marks-table .col-theory, .om-marks-table .col-practical, .om-marks-table .col-obtained,
  .om-marks-table .col-status { text-align: center; }
  .om-marks-table .col-subject, .om-marks-table .col-remarks { text-align: left; padding-left: 4px; word-break: break-word; }
  .om-marks-table .col-obtained { font-weight: 700; color: var(--om-accent-ink); }
  .om-marks-table .col-sn { width: 4%; }
  .om-marks-table .col-subject { width: 19%; }
  .om-marks-table .col-full { width: 8%; }
  .om-marks-table .col-pass { width: 8%; }
  .om-marks-table .col-theory { width: 8%; }
  .om-marks-table .col-practical { width: 9%; }
  .om-marks-table .col-obtained { width: 9%; }
  .om-marks-table .col-status { width: 9%; }
  .om-marks-table .col-remarks { width: 26%; }

  .om-badge {
    display: inline-block; min-width: 2.2rem; padding: 0 4px;
    border: 1px solid var(--om-ink); border-radius: 2px;
    font-size: 6.5pt; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase;
    background: var(--om-white); color: var(--om-ink);
  }
  .om-badge-pass { background: var(--om-ink); color: #ffffff; border-color: var(--om-accent); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .om-badge-fail { background: var(--om-white); color: var(--om-ink); border: 1.25px solid var(--om-ink); text-decoration: underline; }

  .om-summary-row { display: grid; grid-template-columns: 1.35fr 0.65fr; gap: 8px; margin-top: 6px; align-items: stretch; }
  .om-summary { margin: 0; padding: 0; border: none; min-width: 0; }
  .om-summary-title { margin: 0 0 3px; font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--om-ink); }
  .om-summary-table { width: 100%; border-collapse: collapse; font-size: 8pt; border: 1px solid var(--om-ink); }
  .om-summary-table th, .om-summary-table td { border: 0.6px solid #555; padding: 3px 6px; text-align: left; }
  .om-summary-table th { width: 58%; font-weight: 600; background: var(--om-soft); color: var(--om-muted); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .om-summary-table td { font-weight: 700; color: var(--om-ink); text-align: right; }
  .om-summary-table tr:last-child th, .om-summary-table tr:last-child td { background: var(--om-soft); border-top: 1.25px solid var(--om-accent); font-weight: 700; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .om-gpa-card {
    display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
    padding: 6px 6px; background: var(--om-ink); color: var(--om-white);
    border: 1.75px solid var(--om-ink);
    box-shadow: inset 0 0 0 2.5px var(--om-white), inset 0 0 0 3.5px var(--om-accent);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .om-gpa-label { margin: 0; font-size: 6.5pt; letter-spacing: 0.14em; text-transform: uppercase; color: #cfd6e4; font-weight: 700; }
  .om-gpa-value { margin: 2px 0 0; font-size: 22pt; font-weight: 700; line-height: 1; letter-spacing: 0.02em; color: #ffffff; }
  .om-gpa-meta { margin: 2px 0 0; font-size: 7.5pt; color: #cfd6e4; }
  .om-gpa-grade { margin: 4px 0 0; display: inline-block; padding: 1px 8px; border: 1px solid var(--om-accent); font-size: 7.5pt; font-weight: 700; letter-spacing: 0.06em; color: #ffffff; text-transform: uppercase; }

  .om-footer { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; padding-top: 2px; }
  .om-footer-block { text-align: center; min-height: 44px; padding: 0 6px; }
  .om-footer-line { margin-top: 34px; border-top: 1.25px solid var(--om-ink); padding-top: 3px; font-size: 7pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--om-muted); }

  .om-meta { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-top: 8px; padding-top: 5px; border-top: 1px solid var(--om-ink); font-size: 6.5pt; color: var(--om-muted); }
  .om-meta-lines p { margin: 0 0 1px; }
  .om-meta-note { margin: 0; max-width: 52%; text-align: right; font-size: 6pt; line-height: 1.3; font-style: italic; }

  .om-watermark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 0; overflow: hidden; }
  .om-watermark span {
    font-size: 3.2rem; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase;
    color: rgba(20, 33, 61, 0.045); transform: rotate(-28deg); user-select: none; white-space: nowrap;
  }
  .official-marksheet > *:not(.om-watermark) { position: relative; z-index: 1; }
</style>
</head>
<body>
<article class="official-marksheet">
  <div class="om-watermark" aria-hidden="true"><span>OFFICIAL</span></div>

  <header class="om-header">
    <div class="om-header-band">
      <div class="om-logo">
        ${
          data.collegeLogoDataUri
            ? `<img src="${data.collegeLogoDataUri}" alt="${escapeHtml(data.collegeName)} logo"/>`
            : `<span class="om-logo-fallback">${escapeHtml(data.collegeName.slice(0, 1).toUpperCase())}</span>`
        }
      </div>
      <div class="om-header-text">
        <h1 class="om-college-name">${escapeHtml(data.collegeName)}</h1>
        ${data.collegeNameNp ? `<p class="om-college-name-np">${escapeHtml(data.collegeNameNp)}</p>` : ""}
        ${data.collegeAddress ? `<p class="om-college-address">${escapeHtml(data.collegeAddress)}</p>` : ""}
      </div>
    </div>
    <div class="om-title-block">
      <p class="om-doc-title">Official Marksheet</p>
      <p class="om-doc-title-sub">Statement of Marks</p>
      <p class="om-exam-name">${escapeHtml(data.examName)}</p>
      ${data.academicYearBs ? `<p class="om-session">Academic Session: ${escapeHtml(data.academicYearBs)}</p>` : ""}
    </div>
  </header>

  <section class="om-student-grid">
    <div class="om-info-panel">
      <p class="om-info-panel-title">Student particulars</p>
      <dl class="om-info-list">${studentRows.join("")}</dl>
    </div>
    <div class="om-info-panel">
      <p class="om-info-panel-title">Examination details</p>
      <dl class="om-info-list">${examRows.join("")}</dl>
    </div>
  </section>

  <div class="om-marks-table-wrap">
    <table class="om-marks-table">
      <thead>
        <tr>
          <th class="col-sn">SN</th>
          <th class="col-subject">Subject</th>
          <th class="col-full">Full Mark</th>
          <th class="col-pass">Pass Mark</th>
          <th class="col-theory">Theory</th>
          <th class="col-practical">Practical</th>
          <th class="col-obtained">Obtained Mark</th>
          <th class="col-status">Status</th>
          <th class="col-remarks">Remarks</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>

  <section class="om-summary-row">
    <div class="om-summary">
      <h2 class="om-summary-title">Result Summary</h2>
      <table class="om-summary-table">
        <tbody>
          <tr><th>Total Obtained Marks</th><td>${escapeHtml(data.totalObtained)}</td></tr>
          <tr><th>Total Full Marks</th><td>${escapeHtml(data.totalFull)}</td></tr>
          <tr><th>Percentage</th><td>${escapeHtml(data.percentage.toFixed(2))}%</td></tr>
          <tr><th>GPA</th><td>${escapeHtml(data.gpa.toFixed(2))}</td></tr>
          <tr><th>Final Grade</th><td>${escapeHtml(data.grade)}</td></tr>
          <tr><th>Overall Result</th><td class="${isPass ? "om-status-pass" : "om-status-fail"}">${escapeHtml(data.passFailStatus ?? "—")}</td></tr>
        </tbody>
      </table>
    </div>
    <aside class="om-gpa-card">
      <p class="om-gpa-label">Cumulative GPA</p>
      <p class="om-gpa-value">${escapeHtml(data.gpa.toFixed(2))}</p>
      <p class="om-gpa-meta">${escapeHtml(data.percentage.toFixed(2))}% overall</p>
      <p class="om-gpa-grade">Grade ${escapeHtml(data.grade)}</p>
    </aside>
  </section>

  <footer class="om-footer">
    <div class="om-footer-block"><div class="om-footer-line">Verified By</div></div>
    <div class="om-footer-block"><div class="om-footer-line">${controller}</div></div>
  </footer>

  <div class="om-meta">
    <div class="om-meta-lines">${metaParts.map((part) => `<p>${part}</p>`).join("")}</div>
    <p class="om-meta-note">Verify authenticity with the institution using the verification number when provided.</p>
  </div>
</article>
</body>
</html>`;
};

export const generateMarksheetPdfFromHtml = async (data: MarksheetTemplateData): Promise<Buffer> => {
  const html = buildMarksheetHtml(data);
  return await convertHtmlToPdf(html, { preferCSSPageSize: true, margin: undefined });
};
