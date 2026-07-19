import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Convert HTML string to PDF Buffer.
 *
 * Prefer Puppeteer when available (exact HTML layout + Noto Devanagari web fonts).
 * Falls back to a minimal PDFKit document embedding the HTML as print-ready text
 * only if Chromium cannot launch (keeps production from hard-failing).
 */
export async function convertHtmlToPdf(html: string): Promise<Buffer> {
  try {
    return await convertWithPuppeteer(html);
  } catch (error) {
    console.warn(
      "[convertHtmlToPdf] Puppeteer unavailable or failed, using PDFKit text fallback:",
      error instanceof Error ? error.message : error
    );
    return convertWithPdfKitFallback(html);
  }
}

async function convertWithPuppeteer(html: string): Promise<Buffer> {
  // Dynamic import so the app still boots if puppeteer is not installed.
  const puppeteer = await import("puppeteer");
  const browser = await puppeteer.default.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--font-render-hinting=none"
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, {
      waitUntil: "load",
      timeout: 30_000
    });
    // Allow Google Fonts to finish applying (evaluate in browser context)
    try {
      await page.evaluate("document.fonts.ready");
      await new Promise((r) => setTimeout(r, 400));
    } catch {
      // ignore font wait failures
    }

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      // Symmetric margins so header text centers on the page
      margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
      preferCSSPageSize: false
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

/**
 * Last-resort fallback: strip tags and write plain text so callers still get a PDF.
 * Prefer installing puppeteer for faithful Goshwara layout.
 */
function convertWithPdfKitFallback(html: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const FONTS_DIR = path.join(process.cwd(), "assets", "fonts");
    const devPath = path.join(FONTS_DIR, "NotoSansDevanagari-Regular.ttf");
    const regPath = path.join(FONTS_DIR, "NotoSans-Regular.ttf");

    // Also try module-relative assets (dist layout)
    const here = path.dirname(fileURLToPath(import.meta.url));
    const altDev = path.resolve(here, "..", "..", "assets", "fonts", "NotoSansDevanagari-Regular.ttf");

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let font = "Helvetica";
    if (fs.existsSync(devPath)) {
      doc.registerFont("Devanagari", devPath);
      font = "Devanagari";
    } else if (fs.existsSync(altDev)) {
      doc.registerFont("Devanagari", altDev);
      font = "Devanagari";
    } else if (fs.existsSync(regPath)) {
      doc.registerFont("Regular", regPath);
      font = "Regular";
    }

    const text = html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|h\d|li)>/gi, "\n")
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

    doc.font(font).fontSize(11).text(text, { align: "left", lineGap: 2 });
    doc.end();
  });
}
