import { parseErrorMessage } from "lib/utils";

export type PrintMode = "printing-bulk-results" | "printing-marksheet";
type PageFormat = "a4-portrait" | "a4-landscape";

const PRINT_CLEANUP_MS = 60_000;

const clonePrintableElement = (element: HTMLElement): HTMLElement => {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".no-print").forEach((node) => node.remove());
  // Drop utility classes that force non-layout (Tailwind `hidden` etc.)
  clone.classList.remove("hidden");
  clone.className = clone.className
    .split(/\s+/)
    .filter((c) => c && c !== "hidden" && !c.startsWith("print:"))
    .join(" ");
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
  return clone;
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

  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.left = "-10000px";
  wrapper.style.top = "0";
  wrapper.style.width = isLandscape ? "297mm" : "210mm";
  wrapper.style.background = "#ffffff";
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  return { clone, wrapper, isLandscape };
};

type PdfExportOptions = {
  pageFormat?: PageFormat;
  /** Tight margins + avoid page breaks for single-page marksheets */
  singlePage?: boolean;
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
    await waitForImages(clone);
    const { default: html2pdf } = await import("html2pdf.js");
    // html2pdf option typings omit pagebreak / windowWidth — cast for single-page export
    const pdfOptions = {
      margin: singlePage
        ? ([5, 6, 5, 6] as [number, number, number, number])
        : isLandscape
          ? ([10, 12, 10, 12] as [number, number, number, number])
          : ([12, 14, 12, 14] as [number, number, number, number]),
      image: { type: "jpeg" as const, quality: 0.98 },
      html2canvas: {
        scale: singlePage ? 2.2 : 2,
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#ffffff",
        logging: false,
        ...(singlePage ? { windowWidth: 794 } : {})
      },
      jsPDF: {
        unit: "mm" as const,
        format: "a4" as const,
        orientation: (isLandscape ? "landscape" : "portrait") as
          | "portrait"
          | "landscape"
      },
      pagebreak: singlePage
        ? { mode: ["avoid-all", "css", "legacy"] as string[] }
        : { mode: ["css", "legacy"] as string[] }
    };
    return html2pdf()
      .set(pdfOptions as never)
      .from(clone)
      .outputPdf("blob");
  } finally {
    document.body.removeChild(wrapper);
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
    throw new Error("Report is not ready to export");
  }

  await yieldToUi();
  const blob = await createPdfBlobFromElement(element, "a4-landscape");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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