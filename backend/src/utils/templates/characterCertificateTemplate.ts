/**
 * Character Certificate — a faithful rebuild of the institution's printed
 * certificate, rendered as HTML and converted to PDF via Puppeteer.
 *
 * The page is A4 *landscape* and every element is absolutely positioned in
 * points taken off the original document, so the output lines up with the
 * pre-existing paper stock: ornamental leaf border, tiled house watermark,
 * seal on the left, photo box on the right, then heading, justified body and
 * the four signature blocks along the bottom.
 *
 * Sizes are in `pt` throughout — mixing px in here silently rescales the whole
 * layout because the PDF is produced at 72dpi.
 *
 * A DUPLICATE issuance adds a diagonal watermark plus a line under the heading;
 * the certificate number itself is unchanged by design.
 */
import { convertHtmlToPdf } from "../convertHtmlToPdf.js";
import { certificateBorderDataUri, certificateFontFaceCss } from "./certificateAssets.js";

export interface CharacterCertificateTemplateData {
  collegeName: string;
  collegeNameNp?: string;
  collegeAddress?: string;
  collegeLogoDataUri?: string;
  /** Small print under the address line, e.g. "(Affiliated To CTEVT)". */
  affiliationText?: string;
  headingText: string;
  certificateNumber: string;
  /** Institution's own register number printed top-left, e.g. "GM - 076/77 - 001". */
  issueNo?: string;
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
  /** Repeated across the page as the house watermark; defaults to an acronym. */
  watermarkText?: string;
}

/* ------------------------------------------------------------------ *
 * Page geometry (pt) — measured off the institution's own certificate
 * ------------------------------------------------------------------ */

const PAGE = { width: 841.89, height: 595.28 };
/** Inner edge of the ornamental border band. */
const FRAME_INSET = 48;
/** Body band: from its top (242.5pt) down to the issue date line (457.5pt). */
const BODY_MAX_HEIGHT = 205;

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Dotted leader the printed form uses wherever a value is left blank. */
const LEADER = "…………………………";

/**
 * Body markup: `**bold**` for the emphasised runs (programme name, conduct),
 * and any placeholder still unresolved becomes a dotted blank so the sheet can
 * be completed by hand rather than printing a stray `{{token}}`.
 */
const renderBodyText = (raw: string): string =>
  escapeHtml(raw)
    .replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, `<span class="cc-blank">${LEADER}</span>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>");

const renderBody = (body: string): string =>
  String(body ?? "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p class="cc-para">${renderBodyText(paragraph)}</p>`)
    .join("");

/** "Public Himal Institute of Technology" -> "PHIT". */
const watermarkFor = (data: CharacterCertificateTemplateData): string => {
  const explicit = data.watermarkText?.trim();
  if (explicit) return explicit;
  const skip = new Set(["of", "the", "and", "for", "pvt", "ltd", "pvt.", "ltd."]);
  const initials = data.collegeName
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !skip.has(word.toLowerCase()))
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  return initials.length >= 2 ? initials.slice(0, 6) : data.collegeName.slice(0, 4).toUpperCase();
};

/** Enough repetitions to tile the whole frame at any sensible acronym length. */
const watermarkRows = (label: string): string => {
  const safe = escapeHtml(label);
  const perRow = Math.max(12, Math.ceil(700 / Math.max(1, safe.length * 6)));
  const row = Array.from({ length: perRow }, () => safe).join(" ");
  return Array.from({ length: 56 }, () => `<div>${row}</div>`).join("");
};

/** The four signature blocks, centred on the columns used by the original. */
const SIGNATURE_COLUMNS: Array<{ center: number; lineWidth: number; label: string }> = [
  { center: 145, lineWidth: 100, label: "Prepared by" },
  { center: 308, lineWidth: 108, label: "Checked by" },
  { center: 481, lineWidth: 72, label: "Office Stamp" },
  { center: 667, lineWidth: 132, label: "" } // filled with the signatory label
];

/** A header line squeezed into a fixed-width band, Word-Art style. */
const fitLine = (className: string, targetWidth: number, text: string): string =>
  `<div class="cc-fitline ${className}"><span class="cc-fitbox" style="width:${targetWidth}pt;"><span data-fit-width="${targetWidth}">${escapeHtml(text)}</span></span></div>`;

export const buildCharacterCertificateHtml = (
  data: CharacterCertificateTemplateData
): string => {
  const borderUri = certificateBorderDataUri();
  const watermark = watermarkFor(data);

  const signatureBlocks = SIGNATURE_COLUMNS.map((column, index) => {
    const label = index === SIGNATURE_COLUMNS.length - 1 ? data.signatoryLabel : column.label;
    return `<div class="cc-sign" style="left:${column.center - column.lineWidth / 2}pt;width:${column.lineWidth}pt;">
      <div class="cc-sign-line"></div>
      <div class="cc-sign-label">${escapeHtml(label)}</div>
    </div>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Character Certificate — ${escapeHtml(data.studentName)}</title>
<style>
${certificateFontFaceCss()}

  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${PAGE.width}pt;
    height: ${PAGE.height}pt;
    background: #ffffff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  .cc-page {
    position: relative;
    width: ${PAGE.width}pt;
    height: ${PAGE.height}pt;
    overflow: hidden;
  }

  /* Ornamental border, drawn edge-to-edge behind everything else. */
  .cc-border {
    position: absolute; inset: 0;
    background-image: url("${borderUri}");
    background-size: 100% 100%;
    background-repeat: no-repeat;
  }

  /*
   * Tiled house watermark across the full sheet inside the ornamental border,
   * including behind the body — there is no scrim panel any more, so the mark
   * reads continuously from top to bottom.
   *
   * Weight and tone are chosen for PAPER, not screen: a hairline at #ededed
   * drops out entirely on most laser printers, so this is set bold at a mid
   * light grey, which survives printing while staying clearly secondary to the
   * certificate wording.
   */
  .cc-watermark {
    position: absolute;
    left: ${FRAME_INSET}pt; right: ${FRAME_INSET}pt;
    top: ${FRAME_INSET}pt; bottom: ${FRAME_INSET}pt;
    overflow: hidden;
    color: #d4d4d4;
    font-family: 'Calibri', 'CC Sans', sans-serif;
    font-size: 9pt;
    font-weight: 700;
    line-height: 18pt;
    letter-spacing: 1pt;
    word-spacing: 12pt;
    white-space: nowrap;
    user-select: none;
    /* Keep the tint when the browser/printer would otherwise drop backgrounds. */
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  .cc-layer { position: absolute; inset: 0; }

  /* --- header ------------------------------------------------------ */

  .cc-issue-no {
    position: absolute; left: 57.5pt; top: 50pt;
    padding: 1.5pt 7pt;
    border: 0.6pt solid #c9a227; border-radius: 8pt;
    background: #ffffff;
    font-family: 'Calibri', 'CC Sans', sans-serif;
    font-size: 10pt; font-weight: 700; letter-spacing: 0.3pt;
    color: #1f2d5a; white-space: nowrap;
  }

  /*
   * Word Art squeezes each header line into a fixed-width band. The outer box
   * carries that fixed width so centring is stable, and the inner span — which
   * may start out much wider — is scaled down into it from its left edge.
   */
  .cc-fitline { position: absolute; left: 0; width: ${PAGE.width}pt; text-align: center; }
  .cc-fitbox { display: inline-block; vertical-align: top; }
  .cc-fitbox > span { display: inline-block; white-space: nowrap; transform-origin: left center; }

  .cc-college {
    top: 68pt;
    font-family: 'Arial Black', 'CC Display', 'Arial', sans-serif;
    font-size: 44pt; line-height: 46pt; color: #0070c0;
    letter-spacing: 0.4pt;
    /* Softer than the old hard grey offset — reads as depth, not a misprint. */
    text-shadow: 1.4pt 1.4pt 1.2pt rgba(31, 45, 90, 0.28);
  }
  .cc-address {
    top: 115.5pt;
    font-family: 'Times New Roman', 'CC Serif', serif;
    font-weight: 700; font-size: 24pt; line-height: 27pt; color: #1f2d5a;
    letter-spacing: 0.3pt;
  }
  .cc-affiliation {
    top: 145pt;
    font-family: 'Times New Roman', 'CC Serif', serif;
    font-weight: 700; font-size: 12pt; line-height: 14pt; color: #444444;
    letter-spacing: 0.5pt;
  }

  /* Gold rule separating the letterhead from the certificate itself. */
  .cc-header-rule {
    position: absolute; left: 250pt; top: 178pt; width: 342pt; height: 3pt;
  }
  .cc-header-rule::before,
  .cc-header-rule::after {
    content: ""; position: absolute; left: 0; right: 0; height: 0.6pt;
    background: linear-gradient(90deg, rgba(201,162,39,0) 0%, #c9a227 22%, #c9a227 78%, rgba(201,162,39,0) 100%);
  }
  .cc-header-rule::after { top: 2.4pt; }

  .cc-seal {
    position: absolute; left: 73.5pt; top: 143.5pt; width: 80.5pt; height: 71pt;
  }
  .cc-seal img { width: 100%; height: 100%; object-fit: contain; }

  .cc-photo-box {
    position: absolute; left: 668pt; top: 143pt; width: 76pt; height: 73pt;
    border: 0.75pt solid #8a8a8a; border-radius: 2pt;
    background: #ffffff;
  }
  .cc-photo-box span {
    position: absolute; left: 0; right: 0; top: 30pt;
    text-align: center;
    font-family: 'Calibri', 'CC Sans', sans-serif;
    font-size: 7.5pt; letter-spacing: 0.6pt; color: #b0b0b0;
  }

  .cc-heading {
    top: 195pt;
    font-family: 'Algerian', 'CC Heading', 'Cinzel', serif;
    font-size: 29pt; line-height: 31pt; color: #b8121b;
    font-style: italic; letter-spacing: 0.6pt;
    text-shadow: 0.8pt 0.8pt 0.8pt rgba(0, 0, 0, 0.20);
  }

  /* Small diamond flourish centred under the heading. */
  .cc-heading-flourish {
    position: absolute; left: 0; width: ${PAGE.width}pt; top: 226pt;
    text-align: center; font-size: 9pt; color: #c9a227; letter-spacing: 3pt;
  }

  .cc-duplicate-note {
    position: absolute; left: 0; width: ${PAGE.width}pt; top: 233pt;
    text-align: center;
    font-family: 'Calibri', 'CC Sans', sans-serif;
    font-size: 10pt; font-weight: 700; letter-spacing: 0.12em; color: #b22222;
  }

  /* --- body -------------------------------------------------------- */

  .cc-body {
    position: absolute;
    left: 62.6pt; top: 242.5pt; width: 721.4pt;
    font-family: 'Lucida Calligraphy', 'CC Script', cursive;
    font-size: 15pt; line-height: 24pt; color: #14181f;
  }
  .cc-para { margin: 0 0 11pt; text-align: justify; text-justify: inter-word; }
  .cc-para:last-child { margin-bottom: 0; }
  /* Names, programme and conduct — the values a reader scans for. */
  .cc-para strong {
    font-weight: 700; color: #1f2d5a;
    border-bottom: 0.5pt dotted rgba(31, 45, 90, 0.45);
    padding-bottom: 0.4pt;
  }
  .cc-blank { letter-spacing: 0.6pt; color: #555555; }

  .cc-issue-date {
    position: absolute; left: 85pt; top: 457.5pt;
    font-family: 'Lucida Calligraphy', 'CC Script', cursive;
    font-size: 13pt; color: #14181f; white-space: nowrap;
  }

  /* --- signature row ----------------------------------------------- */

  .cc-sign {
    position: absolute; top: 508pt; text-align: center;
    font-family: 'Calibri', 'CC Sans', sans-serif;
    font-size: 10pt; color: #14181f;
  }
  /* A drawn rule prints cleaner than a row of ellipsis characters. */
  .cc-sign-line {
    height: 0; border-top: 0.75pt solid #555555; margin-bottom: 4pt;
  }
  .cc-sign-label {
    line-height: 12pt; white-space: nowrap;
    font-weight: 700; letter-spacing: 0.3pt; color: #1f2d5a;
  }

  /* --- duplicate marking ------------------------------------------- */

  .cc-duplicate-stamp {
    position: absolute; left: 0; top: 250pt; width: ${PAGE.width}pt;
    text-align: center;
    font-family: 'Arial Black', 'CC Display', sans-serif;
    font-size: 96pt; letter-spacing: 0.12em;
    color: rgba(178, 34, 34, 0.10);
    transform: rotate(-18deg);
  }
</style>
</head>
<body>
<div class="cc-page">
  <div class="cc-border"></div>
  <div class="cc-watermark" aria-hidden="true">${watermarkRows(watermark)}</div>

  ${data.isDuplicate ? `<div class="cc-duplicate-stamp" aria-hidden="true">DUPLICATE</div>` : ""}

  <div class="cc-layer">
    <div class="cc-issue-no">Issue No. : ${escapeHtml(data.issueNo || data.certificateNumber)}</div>

    ${
      data.collegeLogoDataUri
        ? `<div class="cc-seal"><img src="${data.collegeLogoDataUri}" alt=""/></div>`
        : ""
    }
    <div class="cc-photo-box"><span>PHOTO</span></div>

    ${fitLine("cc-college", 624, data.collegeName)}
    ${data.collegeAddress ? fitLine("cc-address", 242, data.collegeAddress) : ""}
    ${data.affiliationText ? fitLine("cc-affiliation", 104, data.affiliationText) : ""}

    <div class="cc-header-rule" aria-hidden="true"></div>

    ${fitLine("cc-heading", 345, data.headingText)}
    <div class="cc-heading-flourish" aria-hidden="true">&#10022;&#160;&#10022;&#160;&#10022;</div>
    ${
      data.isDuplicate
        ? `<div class="cc-duplicate-note">DUPLICATE COPY — ISSUE NO. ${escapeHtml(data.issueNumber)}</div>`
        : ""
    }

    <div class="cc-body">${renderBody(data.body)}</div>

    <div class="cc-issue-date">Issue Date: ${escapeHtml(data.issueDateBs)}${
      data.issueDateBs ? " B.S." : ""
    }</div>

    ${signatureBlocks}
  </div>
</div>

<script>
  /*
   * The original certificate sets its heading lines with Word Art, which
   * squeezes each line to a fixed width. Reproduce that by scaling every
   * .cc-fitline horizontally to its measured target width, so a longer or
   * shorter institution name still fills the same band instead of wrapping.
   */
  (function () {
    var PT = 96 / 72;
    function fit() {
      var spans = document.querySelectorAll(".cc-fitbox > span[data-fit-width]");
      for (var i = 0; i < spans.length; i++) {
        var span = spans[i];
        var target = parseFloat(span.getAttribute("data-fit-width")) * PT;
        span.style.transform = "none";
        var natural = span.offsetWidth;
        if (!natural || !target) continue;
        var scale = target / natural;
        if (scale > 1.25) scale = 1.25;
        if (scale < 0.3) scale = 0.3;
        span.style.transform = "scaleX(" + scale.toFixed(4) + ")";
      }
    }
    /*
     * The body sits in a fixed band between the heading and the issue date.
     * A wordier certificate is stepped down a point at a time rather than
     * allowed to run over the signature row.
     */
    function shrinkBody() {
      var body = document.querySelector(".cc-body");
      if (!body) return;
      var limit = ${BODY_MAX_HEIGHT} * PT;
      // Floor at 10.5pt — below that the script face stops being readable, and
      // a certificate that wordy should be shortened rather than shrunk further.
      for (var size = 15; size >= 10.5 && body.scrollHeight > limit; size -= 0.5) {
        body.style.fontSize = size + "pt";
        body.style.lineHeight = (size * ${(24 / 15).toFixed(4)}) + "pt";
      }
    }

    function layout() {
      fit();
      shrinkBody();
    }

    layout();
    // Measuring before the embedded fonts land gives fallback metrics, which
    // would leave the name several times too wide once the real font swaps in.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  })();
</script>
</body>
</html>`;
};

export const generateCharacterCertificatePdf = async (
  data: CharacterCertificateTemplateData
): Promise<Buffer> => {
  const html = buildCharacterCertificateHtml(data);
  return await convertHtmlToPdf(html, {
    preferCSSPageSize: true,
    landscape: true,
    margin: undefined,
    // The certificate ships its own fonts; the global Noto override would
    // otherwise replace every one of them.
    keepDocumentFonts: true,
    // Never degrade to the plain-text fallback: it emits a multi-page wall of
    // words (watermark tiles included) that reads as a corrupt certificate.
    requireBrowser: true
  });
};
