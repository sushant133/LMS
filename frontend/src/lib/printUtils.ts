import { parseErrorMessage } from "lib/utils";

export type PrintMode = "printing-bulk-results" | "printing-marksheet";
type PageFormat = "a4-portrait" | "a4-landscape";

const PRINT_CLEANUP_MS = 60_000;

/** Safe class string — SVG nodes expose SVGAnimatedString, not string. */
const getClassString = (el: Element): string => {
  try {
    return el.getAttribute("class") ?? "";
  } catch {
    return "";
  }
};

const setClassString = (el: Element, next: string): void => {
  if (next.trim()) el.setAttribute("class", next);
  else el.removeAttribute("class");
};

const clonePrintableElement = (element: HTMLElement): HTMLElement => {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".no-print").forEach((node) => node.remove());
  // Drop utility classes that force non-layout (Tailwind `hidden` etc.)
  clone.classList.remove("hidden");
  setClassString(
    clone,
    getClassString(clone)
      .split(/\s+/)
      .filter((c) => c && c !== "hidden" && !c.startsWith("print:"))
      .join(" "),
  );
  // Force a printable layout even when the source node is hidden/off-screen
  // (e.g. `hidden`, `fixed left-[-10000px]`, zero size).
  clone.style.setProperty("display", "block", "important");
  clone.style.setProperty("visibility", "visible", "important");
  clone.style.position = "static";
  clone.style.left = "auto";
  clone.style.top = "auto";
  clone.style.right = "auto";
  clone.style.bottom = "auto";
  clone.style.transform = "none";
  clone.style.opacity = "1";
  clone.style.width = "100%";
  clone.style.maxWidth = "100%";
  clone.style.height = "auto";
  clone.style.maxHeight = "none";
  clone.style.overflow = "visible";
  clone.style.pointerEvents = "auto";
  clone.removeAttribute("aria-hidden");

  // Sticky/fixed headers break html2canvas + print (ghost/faint top rows).
  // Flatten positioning so thead paints solid and once (no media-query needed).
  clone.querySelectorAll("*").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    const cls = getClassString(node);
    if (/\bsticky\b|\bfixed\b/.test(cls)) {
      setClassString(
        node,
        cls
          .split(/\s+/)
          .filter(
            (c) =>
              c &&
              c !== "sticky" &&
              c !== "fixed" &&
              c !== "top-0" &&
              c !== "left-0" &&
              c !== "right-0" &&
              c !== "bottom-0" &&
              !/^z-\d+$/.test(c) &&
              !c.startsWith("print:"),
          )
          .join(" "),
      );
      node.style.setProperty("position", "static", "important");
      node.style.setProperty("top", "auto", "important");
      node.style.setProperty("left", "auto", "important");
      node.style.setProperty("z-index", "auto", "important");
    }
    // Ensure backgrounds/colors survive print & PDF rasterization
    node.style.setProperty("-webkit-print-color-adjust", "exact", "important");
    node.style.setProperty("print-color-adjust", "exact", "important");
  });

  // Timetable period header row: force solid dark fill + white text
  // (browsers strip Tailwind bg unless color-adjust + inline colors).
  clone.querySelectorAll<HTMLElement>("thead th, .tt-print-th").forEach((th) => {
    const cls = getClassString(th);
    const isBreak = cls.includes("amber") || /break/i.test(th.textContent ?? "");
    const bg = isBreak ? "#92400e" : "#0f172a";
    th.style.setProperty("background-color", bg, "important");
    th.style.setProperty("color", "#ffffff", "important");
    th.style.setProperty("border-color", "#000000", "important");
    th.style.setProperty("-webkit-print-color-adjust", "exact", "important");
    th.style.setProperty("print-color-adjust", "exact", "important");
    th.querySelectorAll<HTMLElement>("*").forEach((child) => {
      child.style.setProperty("color", "#ffffff", "important");
    });
  });

  clone.querySelectorAll<HTMLElement>("tbody th.tt-print-day, tbody th").forEach((th) => {
    const isSat = /saturday/i.test(th.textContent ?? "");
    th.style.setProperty("background-color", isSat ? "#ffe4e6" : "#f1f5f9", "important");
    th.style.setProperty("color", isSat ? "#4c0519" : "#0f172a", "important");
    th.style.setProperty("border-color", "#000000", "important");
    th.style.setProperty("-webkit-print-color-adjust", "exact", "important");
    th.style.setProperty("print-color-adjust", "exact", "important");
  });

  return clone;
};

/**
 * Copy computed styles onto inline styles (browser resolves oklch → rgb).
 * Required for html2canvas under Tailwind v4, which emits oklch() CSS that
 * html2canvas cannot parse and throws on — breaking PDF/image export.
 */
const inlineComputedStylesForCanvas = (root: HTMLElement): void => {
  const props = [
    "display",
    "position",
    "box-sizing",
    "width",
    "min-width",
    "max-width",
    "height",
    "min-height",
    "max-height",
    "margin",
    "padding",
    "border",
    "border-collapse",
    "border-spacing",
    "border-top",
    "border-right",
    "border-bottom",
    "border-left",
    "border-color",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
    "border-width",
    "border-style",
    "border-radius",
    "color",
    "background-color",
    "background",
    "background-image",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "line-height",
    "letter-spacing",
    "text-align",
    "text-transform",
    "text-decoration",
    "white-space",
    "word-break",
    "vertical-align",
    "overflow",
    "opacity",
    "flex-direction",
    "flex-wrap",
    "justify-content",
    "align-items",
    "align-content",
    "gap",
    "row-gap",
    "column-gap",
    "grid-template-columns",
    "table-layout",
  ] as const;

  const nodes: HTMLElement[] = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
  for (const el of nodes) {
    const cs = window.getComputedStyle(el);
    for (const prop of props) {
      try {
        const value = cs.getPropertyValue(prop);
        if (!value) continue;
        // Skip unresolved modern color functions if any remain
        if (/oklch|oklab|color-mix|lab\(|lch\(/i.test(value)) continue;
        el.style.setProperty(prop, value);
      } catch {
        /* ignore invalid props on this node */
      }
    }
    el.style.setProperty("-webkit-print-color-adjust", "exact");
    el.style.setProperty("print-color-adjust", "exact");
  }
};

/** Strip stylesheets that crash html2canvas (Tailwind v4 oklch). Inline styles remain. */
const stripModernColorStylesheets = (doc: Document): void => {
  doc.querySelectorAll("style").forEach((styleEl) => {
    const text = styleEl.textContent ?? "";
    if (/oklch|oklab|color-mix\(/i.test(text)) {
      styleEl.remove();
    }
  });
  // External Tailwind bundles almost always contain oklch in v4
  doc.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
    link.remove();
  });
};

const yieldToUi = (): Promise<void> =>
  new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });

const waitForImages = async (root: HTMLElement, timeoutMs = 5_000): Promise<void> => {
  const images = Array.from(root.querySelectorAll("img"));
  if (images.length === 0) {
    return;
  }

  await Promise.race([
    Promise.all(
      images.map(
        (image) =>
          new Promise<void>((resolve) => {
            if (image.complete) {
              resolve();
              return;
            }

            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
          })
      )
    ),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeoutMs);
    })
  ]);
};

const collectDocumentStyles = (): string => {
  const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .map((node) => {
      const href = (node as HTMLLinkElement).href;
      return href ? `<link rel="stylesheet" href="${href}" />` : "";
    })
    .filter(Boolean)
    .join("");

  const inlineStyles = Array.from(document.querySelectorAll("style"))
    .map((node) => node.outerHTML)
    .join("");

  return `${links}${inlineStyles}`;
};

const buildPrintableHtml = (element: HTMLElement, pageFormat: PageFormat): string => {
  const clone = clonePrintableElement(element);
  const isLandscape = pageFormat === "a4-landscape";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>&#8203;</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
    ${collectDocumentStyles()}
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        color: #000000;
        font-family: "IBM Plex Sans", "Noto Sans Devanagari", "Nirmala UI", "Mangal", sans-serif;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      *, *::before, *::after {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      /* Timetable: high-contrast period header (never wash out to white-on-white) */
      .timetable-print-sheet,
      .tt-print-grid {
        color: #000000 !important;
        background: #ffffff !important;
      }
      .tt-print-table {
        border-collapse: collapse !important;
        width: 100% !important;
      }
      .tt-print-table thead th,
      .tt-print-th {
        background-color: #0f172a !important;
        color: #ffffff !important;
        border: 1px solid #000000 !important;
        font-weight: 700 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .tt-print-table thead th *,
      .tt-print-th * {
        color: #ffffff !important;
      }
      .tt-print-table tbody th,
      .tt-print-day {
        background-color: #f1f5f9 !important;
        color: #0f172a !important;
        border: 1px solid #000000 !important;
        font-weight: 700 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .tt-print-table td {
        border: 1px solid #000000 !important;
      }
      .sticky {
        position: static !important;
      }
      @page {
        size: A4 ${isLandscape ? "landscape" : "portrait"};
        margin: ${isLandscape ? "6mm 5mm" : "5mm 4mm"};
      }
      .font-nepali,
      [lang="ne"] {
        font-family: "Noto Sans Devanagari", "Nirmala UI", "Mangal", "Arial Unicode MS", sans-serif !important;
      }
      .print-results-bulk-table {
        display: block !important;
        visibility: visible !important;
        width: 100%;
        color: #000000;
        background: #ffffff;
      }
      .iar-report {
        display: block !important;
        box-sizing: border-box !important;
        width: 100% !important;
        color: #000 !important;
        background: #fff !important;
        font-family: "Times New Roman", Times, Georgia, serif !important;
        font-size: 8.5px !important;
        line-height: 1.15 !important;
      }
      .iar-report *,
      .iar-report *::before,
      .iar-report *::after {
        box-sizing: border-box !important;
      }
      .iar-title {
        text-align: center;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        margin: 0 0 2px;
      }
      .iar-office {
        text-align: center;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        margin: 0 0 2px;
      }
      .iar-sheet-title {
        text-align: center;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        margin: 0 0 5px;
      }
      .iar-meta {
        width: 100% !important;
        border-collapse: collapse !important;
        border: 1px solid #000 !important;
        margin: 0 0 5px !important;
        table-layout: fixed !important;
        font-size: 8px !important;
      }
      .iar-meta td {
        border: 1px solid #000 !important;
        padding: 2px 4px !important;
        vertical-align: top !important;
        text-align: left !important;
      }
      .iar-meta-k { font-weight: 700; }
      .iar-marks {
        width: 100% !important;
        border-collapse: collapse !important;
        border: 1px solid #000 !important;
        table-layout: fixed !important;
        font-size: 7px !important;
      }
      .iar-marks th,
      .iar-marks td {
        border: 1px solid #000 !important;
        padding: 1.5px 1px !important;
        vertical-align: middle !important;
        background: #fff !important;
      }
      .iar-marks thead th {
        font-weight: 700 !important;
        text-align: center !important;
      }
      .iar-col-sn { width: 3.2% !important; }
      .iar-col-regd { width: 7.5% !important; }
      .iar-col-symbol { width: 3.5% !important; }
      .iar-col-name { width: 14% !important; }
      .iar-col-label { width: 5% !important; }
      .iar-col-total { width: 5.5% !important; }
      .iar-col-pct { width: 3.5% !important; }
      .iar-col-grade { width: 3.5% !important; }
      .iar-col-remarks { width: 5% !important; }
      .iar-sn { text-align: center !important; font-weight: 600; }
      .iar-regd {
        text-align: center !important;
        font-family: Consolas, "Courier New", monospace !important;
        font-size: 6px !important;
        word-break: break-all;
        line-height: 1.1;
      }
      .iar-symbol { text-align: center !important; font-size: 6.5px !important; }
      .iar-name {
        text-align: left !important;
        font-weight: 700 !important;
        font-size: 6.5px !important;
        line-height: 1.1;
        padding-left: 2px !important;
        padding-right: 2px !important;
        word-break: break-word;
      }
      .iar-corner {
        text-align: center !important;
        font-weight: 700 !important;
        font-size: 6px !important;
        line-height: 1.1;
        vertical-align: middle !important;
      }
      .iar-corner-empty { background: #fff !important; }
      .iar-subject-name {
        text-align: center !important;
        font-weight: 700 !important;
        font-size: 6px !important;
        line-height: 1.05;
        word-break: break-word;
        hyphens: auto;
        vertical-align: middle !important;
      }
      .iar-tp {
        text-align: center !important;
        font-weight: 700 !important;
        font-size: 6.5px !important;
      }
      .iar-num {
        text-align: center !important;
        font-variant-numeric: tabular-nums;
        font-size: 6.5px !important;
        white-space: nowrap;
      }
      .iar-total,
      .iar-pct,
      .iar-grade {
        text-align: center !important;
        font-size: 6.5px !important;
        font-weight: 600;
        white-space: nowrap;
      }
      .iar-grade { font-weight: 700 !important; }
      .iar-remarks {
        text-align: left !important;
        font-size: 6px !important;
        padding-left: 2px !important;
      }
      .iar-legend {
        width: 100% !important;
        border-collapse: collapse !important;
        border: 1px solid #000 !important;
        margin-top: 5px !important;
        table-layout: fixed !important;
        font-size: 7px !important;
      }
      .iar-legend td {
        border: 1px solid #000 !important;
        padding: 2px 4px !important;
      }
      .iar-signatures {
        display: flex !important;
        justify-content: space-between !important;
        margin-top: 22px !important;
        padding: 0 24px !important;
        font-size: 9px !important;
        font-weight: 700 !important;
      }
      .iar-sign { text-align: center; min-width: 140px; }
      .iar-sign-line {
        border-top: 1px dotted #000 !important;
        margin: 0 auto 5px !important;
        width: 140px !important;
      }
      .official-marksheet {
        max-width: none;
        width: 100%;
        margin: 0;
        padding: 5mm 6mm;
      }
    </style>
  </head>
  <body>${clone.outerHTML}</body>
</html>`;
};

const printViaIframe = (element: HTMLElement, pageFormat: PageFormat): Promise<void> =>
  new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) {
      document.body.removeChild(iframe);
      reject(new Error("Could not open print preview"));
      return;
    }

    // Browser print headers show date + document title (e.g. "8/2/26, 2:07 PM PHIT COLLEGE").
    // Blank both the parent and iframe titles while printing so that header stays empty.
    const previousTitle = document.title;
    document.title = "\u200B";

    let settled = false;
    const cleanup = () => {
      window.clearTimeout(fallbackTimer);
      document.title = previousTitle;
      if (iframe.parentNode) {
        document.body.removeChild(iframe);
      }
    };

    const fallbackTimer = window.setTimeout(cleanup, PRINT_CLEANUP_MS);

    const startPrint = () => {
      try {
        doc.title = "\u200B";
        win.document.title = "\u200B";
      } catch {
        // ignore cross-document title assignment failures
      }

      win.addEventListener("afterprint", cleanup, { once: true });

      window.setTimeout(() => {
        try {
          win.focus();
          win.print();
          if (!settled) {
            settled = true;
            resolve();
          }
        } catch (error) {
          settled = true;
          cleanup();
          reject(error);
        }
      }, 250);
    };

    doc.open();
    doc.write(buildPrintableHtml(element, pageFormat));
    doc.close();

    void waitForImages(doc.body).then(startPrint);
  });

const mountPrintableClone = (element: HTMLElement, pageFormat: PageFormat) => {
  const isLandscape = pageFormat === "a4-landscape";
  const clone = clonePrintableElement(element);

  clone.style.maxWidth = isLandscape ? "297mm" : "210mm";
  clone.style.width = isLandscape ? "297mm" : "210mm";
  clone.style.margin = "0";
  clone.style.padding = isLandscape ? "10mm 12mm" : "12mm 14mm";
  clone.style.background = "#ffffff";
  clone.style.color = "#000000";
  clone.style.boxSizing = "border-box";

  const wrapper = document.createElement("div");
  // Keep on-screen but invisible so layout/fonts compute correctly (off-screen
  // left:-10000px can yield 0×0 captures in some browsers).
  wrapper.style.position = "fixed";
  wrapper.style.left = "0";
  wrapper.style.top = "0";
  wrapper.style.width = isLandscape ? "297mm" : "210mm";
  wrapper.style.maxWidth = "100vw";
  wrapper.style.background = "#ffffff";
  wrapper.style.opacity = "0";
  wrapper.style.pointerEvents = "none";
  wrapper.style.zIndex = "-1";
  wrapper.style.overflow = "visible";
  wrapper.setAttribute("aria-hidden", "true");
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  return { clone, wrapper, isLandscape };
};

type PdfExportOptions = {
  pageFormat?: PageFormat;
  /** Tight margins + avoid page breaks for single-page marksheets */
  singlePage?: boolean;
};

const html2canvasOptions = (clone: HTMLElement, scale: number) => ({
  scale,
  useCORS: true,
  // Logos from other origins must not abort the whole export
  allowTaint: true,
  backgroundColor: "#ffffff",
  logging: false,
  scrollX: 0,
  scrollY: 0,
  windowWidth: Math.max(clone.scrollWidth, clone.offsetWidth, 800),
  windowHeight: Math.max(clone.scrollHeight, clone.offsetHeight, 600),
  onclone: (clonedDoc: Document) => {
    stripModernColorStylesheets(clonedDoc);
  },
});

/** Rasterize a prepared on-DOM clone to canvas (shared by PDF + image). */
const rasterizeCloneToCanvas = async (
  clone: HTMLElement,
  scale = 2,
): Promise<HTMLCanvasElement> => {
  await waitForImages(clone);
  await yieldToUi();
  // Resolve Tailwind oklch → rgb and bake into inline styles before capture
  inlineComputedStylesForCanvas(clone);
  await yieldToUi();

  const html2canvas = (await import("html2canvas")).default;
  try {
    return await html2canvas(clone, html2canvasOptions(clone, scale));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      message.includes("oklch") || message.includes("color")
        ? "Could not render timetable for export (color styles). Try Print → Save as PDF instead."
        : `Could not render export: ${message}`,
    );
  }
};

const createPdfBlobFromElement = async (
  element: HTMLElement,
  options: PageFormat | PdfExportOptions = "a4-portrait"
): Promise<Blob> => {
  const pageFormat =
    typeof options === "string" ? options : options.pageFormat ?? "a4-portrait";
  const singlePage =
    typeof options === "string" ? false : Boolean(options.singlePage);

  const { clone, wrapper, isLandscape } = mountPrintableClone(element, pageFormat);

  // Marksheet: keep internal padding tight so content fits one A4 page
  if (singlePage) {
    clone.style.padding = "5mm 6mm";
    clone.style.maxWidth = "210mm";
    clone.style.width = "210mm";
    clone.style.boxSizing = "border-box";
  }

  try {
    // Prefer direct canvas + jsPDF — more reliable than html2pdf with Tailwind v4
    const canvas = await rasterizeCloneToCanvas(clone, singlePage ? 2.2 : 2);
    if (!canvas.width || !canvas.height) {
      throw new Error("Export produced an empty image — print view may be empty");
    }

    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({
      unit: "mm",
      format: "a4",
      orientation: isLandscape ? "landscape" : "portrait",
      compress: true,
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = singlePage ? 5 : isLandscape ? 8 : 10;
    const usableWidth = pageWidth - margin * 2;
    const imgHeight = (canvas.height * usableWidth) / canvas.width;
    const imgData = canvas.toDataURL("image/jpeg", 0.92);

    let heightLeft = imgHeight;
    let y = margin;
    pdf.addImage(imgData, "JPEG", margin, y, usableWidth, imgHeight);
    heightLeft -= pageHeight - margin * 2;

    while (heightLeft > 1) {
      y = margin - (imgHeight - heightLeft);
      pdf.addPage();
      pdf.addImage(imgData, "JPEG", margin, y, usableWidth, imgHeight);
      heightLeft -= pageHeight - margin * 2;
    }

    return pdf.output("blob");
  } finally {
    if (wrapper.parentNode) {
      wrapper.parentNode.removeChild(wrapper);
    }
  }
};

const printElement = async (element: HTMLElement | null, pageFormat: PageFormat): Promise<void> => {
  if (!element) {
    throw new Error("Document is not ready to print");
  }

  await yieldToUi();
  await printViaIframe(element, pageFormat);
};

export const printElementById = async (elementId: string, _title?: string): Promise<void> => {
  const element = document.getElementById(elementId);
  await printElement(element, "a4-landscape");
};

export const downloadPdfFromElementById = async (elementId: string, filename: string): Promise<void> => {
  const element = document.getElementById(elementId);
  if (!element) {
    throw new Error("Timetable print view is not ready. Refresh the page and try again.");
  }

  await yieldToUi();
  const blob = await createPdfBlobFromElement(element, "a4-landscape");
  if (!blob || blob.size < 100) {
    throw new Error("PDF export failed (empty file). Try Print → Save as PDF.");
  }
  const safeName = filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

/** PNG download of a hidden print root (timetable, etc.). */
export const downloadImageFromElementById = async (
  elementId: string,
  filename: string,
): Promise<void> => {
  const element = document.getElementById(elementId);
  if (!element) {
    throw new Error("Timetable print view is not ready. Refresh the page and try again.");
  }

  await yieldToUi();
  const { clone, wrapper } = mountPrintableClone(element, "a4-landscape");
  try {
    const canvas = await rasterizeCloneToCanvas(clone, 2);
    if (!canvas.width || !canvas.height) {
      throw new Error("Image export failed (empty capture)");
    }
    const safeName = filename.toLowerCase().endsWith(".png") ? filename : `${filename}.png`;
    const url = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = url;
    link.download = safeName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    if (wrapper.parentNode) {
      wrapper.parentNode.removeChild(wrapper);
    }
  }
};

export const printMarksheetElement = async (element: HTMLElement | null): Promise<void> => {
  await printElement(element, "a4-portrait");
};

export const printBulkResultsElement = async (element: HTMLElement | null): Promise<void> => {
  await printElement(element, "a4-portrait");
};

export const downloadMarksheetPdfFromElement = async (
  element: HTMLElement | null,
  filename: string
): Promise<void> => {
  if (!element) {
    throw new Error("Marksheet is not ready to download");
  }

  await yieldToUi();
  const blob = await createPdfBlobFromElement(element, {
    pageFormat: "a4-portrait",
    singlePage: true
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export const printWithMode = (mode: PrintMode): void => {
  document.body.classList.add(mode);
  const cleanup = () => {
    document.body.classList.remove(mode);
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
};

export const getPdfErrorMessage = (error: unknown): string => parseErrorMessage(error);