import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { PDFOptions } from "puppeteer";
import { ApiError } from "./apiError.js";

const FONTS_DIR = path.join(process.cwd(), "assets", "fonts");

const resolveFontPath = (...candidates: string[]): string | null => {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
};

const moduleFontsDir = (): string => {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, "..", "..", "assets", "fonts");
  } catch {
    return FONTS_DIR;
  }
};

const DEVANAGARI_FONT = (): string | null =>
  resolveFontPath(
    path.join(FONTS_DIR, "NotoSansDevanagari-Regular.ttf"),
    path.join(moduleFontsDir(), "NotoSansDevanagari-Regular.ttf")
  );

const LATIN_FONT = (): string | null =>
  resolveFontPath(
    path.join(FONTS_DIR, "NotoSans-Regular.ttf"),
    path.join(moduleFontsDir(), "NotoSans-Regular.ttf")
  );

/**
 * Inject self-hosted @font-face rules so Puppeteer never depends on Google Fonts
 * (network blocks/timeouts used to force the PDFKit fallback, which then crashed
 * on Devanagari layout for words like अक्षरेपी).
 */
const injectLocalFonts = (html: string, keepDocumentFonts = false): string => {
  const faces: string[] = [];

  const devPath = DEVANAGARI_FONT();
  if (devPath) {
    const b64 = fs.readFileSync(devPath).toString("base64");
    faces.push(`
      @font-face {
        font-family: 'Noto Sans Devanagari';
        font-style: normal;
        font-weight: 400 700;
        font-display: block;
        src: url(data:font/ttf;base64,${b64}) format('truetype');
      }
    `);
  }

  const latinPath = LATIN_FONT();
  if (latinPath) {
    const b64 = fs.readFileSync(latinPath).toString("base64");
    faces.push(`
      @font-face {
        font-family: 'Noto Sans';
        font-style: normal;
        font-weight: 400;
        font-display: block;
        src: url(data:font/ttf;base64,${b64}) format('truetype');
      }
    `);
  }

  if (faces.length === 0 && !keepDocumentFonts) return html;

  // A document that ships its own @font-face rules (the character certificate)
  // still wants Noto available for Devanagari, but must keep its own families.
  const styleBlock = `<style data-local-pdf-fonts="1">
    ${faces.join("\n")}
    ${
      keepDocumentFonts
        ? ""
        : `body, body * {
      font-family: 'Noto Sans Devanagari', 'Noto Sans', 'Nirmala UI', Mangal, sans-serif !important;
    }`
    }
  </style>`;

  // Drop remote Google Fonts imports so setContent does not hang offline
  const cleaned = html
    .replace(/@import\s+url\(['"]?https?:\/\/fonts\.googleapis\.com[^'"]*['"]?\);?/gi, "")
    .replace(/<link[^>]+fonts\.googleapis\.com[^>]*>/gi, "");

  if (/<\/head>/i.test(cleaned)) {
    return cleaned.replace(/<\/head>/i, `${styleBlock}</head>`);
  }
  return `${styleBlock}${cleaned}`;
};

/**
 * 503 so the real, actionable reason reaches the browser — the generic error
 * branch replaces plain Error messages with "Internal server error".
 */
export class BrowserPdfUnavailableError extends ApiError {
  constructor(cause: unknown) {
    super(
      503,
      "The certificate could not be rendered: Chromium is not available on the server. " +
        "Run `npx puppeteer browsers install chrome` on the server, or set PUPPETEER_EXECUTABLE_PATH " +
        "to an installed Chrome/Chromium binary, then try again. " +
        `(${cause instanceof Error ? cause.message : String(cause)})`
    );
    this.name = "BrowserPdfUnavailableError";
    this.cause = cause;
  }
}

/**
 * Convert HTML string to PDF Buffer.
 *
 * Prefer Puppeteer when available (exact HTML layout + embedded local Noto fonts).
 * Falls back to a minimal PDFKit document only if Chromium cannot launch.
 *
 * `pdfOptions` overrides the default page.pdf() options — e.g. a template that
 * defines its own `@page` margin should pass `{ preferCSSPageSize: true, margin: undefined }`
 * so Puppeteer honors the CSS instead of the default fixed margins.
 *
 * `keepDocumentFonts` leaves the document's own font-family declarations alone;
 * without it every element is forced onto Noto Sans.
 *
 * `requireBrowser` disables the text fallback. Designed documents (certificates,
 * marksheets) are *worse* than useless as a stripped-tags text dump — it prints
 * as a multi-page wall of words that reads like a corrupt file — so they ask for
 * a real error the UI can show instead.
 */
export async function convertHtmlToPdf(
  html: string,
  pdfOptions?: Partial<PDFOptions> & {
    keepDocumentFonts?: boolean;
    requireBrowser?: boolean;
  }
): Promise<Buffer> {
  try {
    return await convertWithPuppeteer(html, pdfOptions);
  } catch (error) {
    if (pdfOptions?.requireBrowser) {
      console.error("[convertHtmlToPdf] Chromium render failed:", error);
      throw new BrowserPdfUnavailableError(error);
    }
    console.warn(
      "[convertHtmlToPdf] Puppeteer unavailable or failed, using PDFKit text fallback:",
      error instanceof Error ? (error.stack ?? error.message) : error
    );
    return convertWithPdfKitFallback(html);
  }
}

/**
 * Explicit Chrome binary for hosts where the bundled download is missing
 * (slim containers, CI images, Windows boxes with a system Chrome).
 */
const chromeExecutablePath = (): string | undefined => {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN
  ];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && fs.existsSync(trimmed)) return trimmed;
  }
  return undefined;
};

async function convertWithPuppeteer(
  html: string,
  pdfOptions?: Partial<PDFOptions> & {
    keepDocumentFonts?: boolean;
    requireBrowser?: boolean;
  }
): Promise<Buffer> {
  // Dynamic import so the app still boots if puppeteer is not installed.
  const puppeteer = await import("puppeteer");
  const { keepDocumentFonts, requireBrowser: _requireBrowser, ...pageOptions } = pdfOptions ?? {};
  const preparedHtml = injectLocalFonts(html, keepDocumentFonts);
  const executablePath = chromeExecutablePath();

  const browser = await puppeteer.default.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--font-render-hinting=none",
      "--disable-gpu"
    ]
  });

  try {
    const page = await browser.newPage();
    // domcontentloaded: no wait on external network (fonts are embedded)
    await page.setContent(preparedHtml, {
      waitUntil: "domcontentloaded",
      timeout: 30_000
    });

    try {
      // String form avoids needing DOM lib types in the Node tsconfig
      await page.evaluate("document.fonts.ready");
      await new Promise((r) => setTimeout(r, 200));
    } catch {
      // ignore font wait failures — embedded fonts usually already applied
    }

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      // Symmetric margins so header text centers on the page
      margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
      preferCSSPageSize: false,
      ...pageOptions
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

/**
 * Safely write a line of text. fontkit/PDFKit can throw on some Devanagari
 * mark combinations (xCoordinate null). Never let one bad line kill the PDF.
 */
const safeTextLine = (
  doc: PDFKit.PDFDocument,
  line: string,
  font: string,
  fallbackFont: string
): void => {
  if (!line) {
    doc.moveDown(0.4);
    return;
  }
  try {
    doc.font(font).fontSize(11).text(line, { align: "left", lineGap: 2, continued: false });
  } catch (primaryErr) {
    try {
      // Retry with latin/Helvetica — may show tofu for Nepali but PDF still opens
      doc.font(fallbackFont).fontSize(11).text(line, { align: "left", lineGap: 2, continued: false });
    } catch {
      console.warn(
        "[convertHtmlToPdf] skipped PDFKit line due to font layout error:",
        primaryErr instanceof Error ? primaryErr.message : primaryErr
      );
      doc.moveDown(0.6);
    }
  }
};

/**
 * Last-resort fallback: strip tags and write plain text so callers still get a PDF.
 * Prefer Puppeteer for faithful Goshwara layout.
 */
function convertWithPdfKitFallback(html: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const devPath = DEVANAGARI_FONT();
    const regPath = LATIN_FONT();

    const doc = new PDFDocument({ size: "A4", margin: 40, autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let primaryFont = "Helvetica";
    let fallbackFont = "Helvetica";

    try {
      if (devPath) {
        doc.registerFont("Devanagari", devPath);
        primaryFont = "Devanagari";
      }
      if (regPath) {
        doc.registerFont("Regular", regPath);
        fallbackFont = "Regular";
        if (primaryFont === "Helvetica") primaryFont = "Regular";
      }
    } catch (fontErr) {
      console.warn(
        "[convertHtmlToPdf] font registration failed, using Helvetica:",
        fontErr instanceof Error ? fontErr.message : fontErr
      );
      primaryFont = "Helvetica";
      fallbackFont = "Helvetica";
    }

    const text = html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|h\d|li|td|th)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();

    // Line-by-line so a single GPOS crash cannot wipe the whole document
    const lines = text.length > 0 ? text.split("\n") : ["(empty document)"];
    for (const line of lines) {
      safeTextLine(doc, line.trimEnd(), primaryFont, fallbackFont);
    }

    doc.end();
  });
}
