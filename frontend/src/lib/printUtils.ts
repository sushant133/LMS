import { parseErrorMessage } from "lib/utils";

export type PrintMode = "printing-bulk-results" | "printing-marksheet";
type PageFormat = "a4-portrait" | "a4-landscape";

const PRINT_CLEANUP_MS = 60_000;

const clonePrintableElement = (element: HTMLElement): HTMLElement => {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".no-print").forEach((node) => node.remove());
  clone.style.display = "block";
  clone.style.visibility = "visible";
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
    <title></title>
    ${collectDocumentStyles()}
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        color: #000000;
      }
      @page {
        size: A4 ${isLandscape ? "landscape" : "portrait"};
        margin: ${isLandscape ? "10mm 12mm" : "12mm 14mm"};
      }
      .print-results-bulk-table {
        display: block !important;
        visibility: visible !important;
        width: 100%;
        color: #000000;
        background: #ffffff;
      }
      .official-marksheet {
        max-width: none;
        width: 100%;
        margin: 0;
        padding: 0;
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

    let settled = false;
    const removeIframe = () => {
      window.clearTimeout(fallbackTimer);
      if (iframe.parentNode) {
        document.body.removeChild(iframe);
      }
    };

    const fallbackTimer = window.setTimeout(removeIframe, PRINT_CLEANUP_MS);

    const startPrint = () => {
      win.addEventListener("afterprint", removeIframe, { once: true });

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
          removeIframe();
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

const createPdfBlobFromElement = async (
  element: HTMLElement,
  pageFormat: PageFormat = "a4-portrait"
): Promise<Blob> => {
  const { clone, wrapper, isLandscape } = mountPrintableClone(element, pageFormat);

  try {
    await waitForImages(clone);
    const { default: html2pdf } = await import("html2pdf.js");
    return html2pdf()
      .set({
        margin: isLandscape ? [10, 12, 10, 12] : [12, 14, 12, 14],
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          allowTaint: false,
          backgroundColor: "#ffffff",
          logging: false
        },
        jsPDF: { unit: "mm", format: "a4", orientation: isLandscape ? "landscape" : "portrait" }
      })
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

export const printMarksheetElement = async (element: HTMLElement | null): Promise<void> => {
  await printElement(element, "a4-portrait");
};

export const printBulkResultsElement = async (element: HTMLElement | null): Promise<void> => {
  await printElement(element, "a4-landscape");
};

export const downloadMarksheetPdfFromElement = async (
  element: HTMLElement | null,
  filename: string
): Promise<void> => {
  if (!element) {
    throw new Error("Marksheet is not ready to download");
  }

  await yieldToUi();
  const blob = await createPdfBlobFromElement(element, "a4-portrait");
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