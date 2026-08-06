/**
 * Character Certificate — server-rendered HTML converted to PDF via Puppeteer
 * (see convertHtmlToPdf.ts). Visual language is deliberately kept in the same
 * family as marksheetTemplate.ts (same ink/accent palette, header band, and
 * footer signature blocks) so both documents read as one institution.
 *
 * A DUPLICATE issuance prints an extra watermark plus a banner under the title;
 * the certificate number itself is unchanged by design.
 */
import { convertHtmlToPdf } from "../convertHtmlToPdf.js";

export interface CharacterCertificateTemplateData {
  collegeName: string;
  collegeNameNp?: string;
  collegeAddress?: string;
  collegeLogoDataUri?: string;
  headingText: string;
  certificateNumber: string;
  /** Body with placeholders already resolved; blank lines separate paragraphs. */
  body: string;
  studentName: string;
  registrationNumber?: string;
  admissionNumber?: string;
  batchName?: string;
  yearName?: string;
  programName?: string;
  passedOutDateBs?: string;
  conduct?: string;
  purpose?: string;
  remarks?: string;
  issueDateBs: string;
  issuedByName?: string;
  signatoryLabel: string;
  isDuplicate: boolean;
  /** 1-based issuance number; printed on duplicates only. */
  issueNumber: number;
  printedDateBs?: string;
}

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const infoRow = (label: string, value?: string): string =>
  value
    ? `<div class="cc-info-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
    : "";

/** Blank-line-separated blocks become paragraphs; single newlines stay as breaks. */
const renderBody = (body: string): string =>
  String(body ?? "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map(
      (paragraph) =>
        `<p class="cc-body-para">${escapeHtml(paragraph).replace(/\n/g, "<br/>")}</p>`
    )
    .join("");

export const buildCharacterCertificateHtml = (
  data: CharacterCertificateTemplateData
): string => {
  const detailRows = [
    infoRow("Registration No.", data.registrationNumber),
    infoRow("Admission No.", data.admissionNumber),
    infoRow("Programme", data.programName),
    infoRow("Batch", data.batchName),
    infoRow("Passed Out", data.passedOutDateBs ? `${data.passedOutDateBs} B.S.` : undefined),
    infoRow("Conduct", data.conduct)
  ]
    .filter(Boolean)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Character Certificate — ${escapeHtml(data.studentName)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  :root {
    --cc-ink: #14213d;
    --cc-accent: #b8860b;
    --cc-muted: #55607a;
    --cc-line: #c8cfdd;
    --cc-white: #ffffff;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: 'Noto Sans', 'Noto Sans Devanagari', system-ui, -apple-system, sans-serif;
    color: var(--cc-ink);
    background: var(--cc-white);
  }

  .character-certificate {
    position: relative;
    min-height: 267mm;
    padding: 10mm 11mm 8mm;
    border: 2.5px solid var(--cc-ink);
    box-shadow: inset 0 0 0 1.5px var(--cc-white), inset 0 0 0 3.5px var(--cc-accent);
    display: flex;
    flex-direction: column;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  .cc-watermark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 0; overflow: hidden; }
  .cc-watermark span {
    font-size: 3.4rem; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase;
    color: rgba(20, 33, 61, 0.045); transform: rotate(-28deg); user-select: none; white-space: nowrap;
  }
  .cc-watermark.cc-watermark-duplicate span {
    font-size: 4.6rem; color: rgba(178, 34, 34, 0.10); letter-spacing: 0.22em;
  }
  .character-certificate > *:not(.cc-watermark) { position: relative; z-index: 1; }

  .cc-header-band { display: flex; align-items: center; gap: 12px; padding-bottom: 8px; border-bottom: 2px solid var(--cc-ink); }
  .cc-logo { width: 58px; height: 58px; flex: 0 0 58px; display: flex; align-items: center; justify-content: center; border: 1.25px solid var(--cc-line); overflow: hidden; }
  .cc-logo img { width: 100%; height: 100%; object-fit: contain; }
  .cc-logo-fallback { font-size: 22pt; font-weight: 700; color: var(--cc-ink); }
  .cc-header-text { flex: 1; text-align: center; }
  .cc-college-name { margin: 0; font-size: 17pt; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; }
  .cc-college-name-np { margin: 1px 0 0; font-size: 10.5pt; font-weight: 600; color: var(--cc-muted); }
  .cc-college-address { margin: 2px 0 0; font-size: 8.5pt; color: var(--cc-muted); }

  .cc-title-block { text-align: center; margin-top: 14px; }
  .cc-doc-title {
    margin: 0; display: inline-block; padding: 5px 26px;
    font-size: 15pt; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
    color: var(--cc-white); background: var(--cc-ink);
    box-shadow: inset 0 0 0 1.5px var(--cc-white), inset 0 0 0 2.5px var(--cc-accent);
  }
  .cc-duplicate-banner {
    margin: 8px auto 0; display: inline-block; padding: 3px 16px;
    font-size: 9pt; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
    color: #b22222; border: 1.5px dashed #b22222;
  }
  .cc-cert-no { margin: 9px 0 0; font-size: 9pt; font-weight: 700; letter-spacing: 0.06em; }
  .cc-cert-no span { color: var(--cc-accent); }

  .cc-info-panel { margin-top: 14px; border: 1px solid var(--cc-line); padding: 8px 12px; }
  .cc-info-list { margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 2px 22px; }
  .cc-info-row { display: flex; gap: 6px; font-size: 9pt; padding: 1.5px 0; border-bottom: 1px dotted var(--cc-line); }
  .cc-info-row dt { margin: 0; min-width: 96px; font-weight: 600; color: var(--cc-muted); }
  .cc-info-row dd { margin: 0; font-weight: 600; }

  .cc-body { margin-top: 16px; flex: 1; }
  .cc-body-para { margin: 0 0 11px; font-size: 11pt; line-height: 1.95; text-align: justify; text-justify: inter-word; }
  .cc-body-para:first-child { text-indent: 26px; }

  .cc-extra { margin-top: 6px; border-top: 1px solid var(--cc-line); padding-top: 7px; }
  .cc-extra p { margin: 0 0 3px; font-size: 9pt; }
  .cc-extra strong { color: var(--cc-muted); font-weight: 600; }

  .cc-footer { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 26px; }
  .cc-footer-block { text-align: center; min-height: 52px; padding: 0 6px; }
  .cc-footer-line { margin-top: 40px; border-top: 1.25px solid var(--cc-ink); padding-top: 3px; font-size: 7.5pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--cc-muted); }

  .cc-meta { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-top: 14px; padding-top: 5px; border-top: 1px solid var(--cc-ink); font-size: 6.5pt; color: var(--cc-muted); }
  .cc-meta-lines p { margin: 0 0 1px; }
  .cc-meta-note { margin: 0; max-width: 54%; text-align: right; font-size: 6pt; line-height: 1.35; font-style: italic; }
</style>
</head>
<body>
<article class="character-certificate">
  <div class="cc-watermark${data.isDuplicate ? " cc-watermark-duplicate" : ""}" aria-hidden="true">
    <span>${data.isDuplicate ? "DUPLICATE" : "OFFICIAL"}</span>
  </div>

  <header class="cc-header-band">
    <div class="cc-logo">
      ${
        data.collegeLogoDataUri
          ? `<img src="${data.collegeLogoDataUri}" alt="${escapeHtml(data.collegeName)} logo"/>`
          : `<span class="cc-logo-fallback">${escapeHtml(data.collegeName.slice(0, 1).toUpperCase())}</span>`
      }
    </div>
    <div class="cc-header-text">
      <h1 class="cc-college-name">${escapeHtml(data.collegeName)}</h1>
      ${data.collegeNameNp ? `<p class="cc-college-name-np">${escapeHtml(data.collegeNameNp)}</p>` : ""}
      ${data.collegeAddress ? `<p class="cc-college-address">${escapeHtml(data.collegeAddress)}</p>` : ""}
    </div>
    <div class="cc-logo" style="visibility:hidden"></div>
  </header>

  <div class="cc-title-block">
    <p class="cc-doc-title">${escapeHtml(data.headingText)}</p>
    ${
      data.isDuplicate
        ? `<div><span class="cc-duplicate-banner">Duplicate copy — issue no. ${escapeHtml(data.issueNumber)}</span></div>`
        : ""
    }
    <p class="cc-cert-no">Certificate No.: <span>${escapeHtml(data.certificateNumber)}</span></p>
  </div>

  ${detailRows ? `<section class="cc-info-panel"><dl class="cc-info-list">${detailRows}</dl></section>` : ""}

  <section class="cc-body">${renderBody(data.body)}</section>

  ${
    data.purpose || data.remarks
      ? `<section class="cc-extra">
          ${data.purpose ? `<p><strong>Purpose:</strong> ${escapeHtml(data.purpose)}</p>` : ""}
          ${data.remarks ? `<p><strong>Remarks:</strong> ${escapeHtml(data.remarks)}</p>` : ""}
        </section>`
      : ""
  }

  <footer class="cc-footer">
    <div class="cc-footer-block"><div class="cc-footer-line">Date: ${escapeHtml(data.issueDateBs)} B.S.</div></div>
    <div class="cc-footer-block"><div class="cc-footer-line">${escapeHtml(data.signatoryLabel)}</div></div>
  </footer>

  <div class="cc-meta">
    <div class="cc-meta-lines">
      <p>Certificate No.: ${escapeHtml(data.certificateNumber)}</p>
      <p>Issued on: ${escapeHtml(data.issueDateBs)} B.S.${data.issuedByName ? ` &middot; Issued by: ${escapeHtml(data.issuedByName)}` : ""}</p>
      ${data.printedDateBs ? `<p>Printed on: ${escapeHtml(data.printedDateBs)} B.S.</p>` : ""}
      ${data.isDuplicate ? `<p>Issue type: DUPLICATE (issue no. ${escapeHtml(data.issueNumber)})</p>` : "<p>Issue type: ORIGINAL</p>"}
    </div>
    <p class="cc-meta-note">This is a computer-generated character certificate. Verify authenticity with the institution using the certificate number above.</p>
  </div>
</article>
</body>
</html>`;
};

export const generateCharacterCertificatePdf = async (
  data: CharacterCertificateTemplateData
): Promise<Buffer> => {
  const html = buildCharacterCertificateHtml(data);
  return await convertHtmlToPdf(html, { preferCSSPageSize: true, margin: undefined });
};
