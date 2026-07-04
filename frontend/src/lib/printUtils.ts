import { parseErrorMessage } from "lib/utils";

export type PrintMode = "printing-bulk-results" | "printing-marksheet";

const cloneMarksheetElement = (element: HTMLElement): HTMLElement => {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".no-print").forEach((node) => node.remove());
  return clone;
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

const buildPrintableHtml = (element: HTMLElement): string => {
  const clone = cloneMarksheetElement(element);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Marksheet</title>
    ${collectDocumentStyles()}
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        color: #000000;
      }
      @page {
        size: A4 portrait;
        margin: 12mm 14mm;
      }
    </style>
  </head>
  <body>${clone.outerHTML}</body>
</html>`;
};

const printViaIframe = (element: HTMLElement): Promise<void> =>
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

    doc.open();
    doc.write(buildPrintableHtml(element));
    doc.close();

    const cleanup = () => {
      window.setTimeout(() => {
        if (iframe.parentNode) {
          document.body.removeChild(iframe);
        }
        resolve();
      }, 300);
    };

    win.addEventListener("afterprint", cleanup, { once: true });

    window.setTimeout(() => {
      try {
        win.focus();
        win.print();
      } catch (error) {
        document.body.removeChild(iframe);
        reject(error);
      }
    }, 350);
  });

export const printMarksheetElement = async (element: HTMLElement | null): Promise<void> => {
  if (!element) {
    throw new Error("Marksheet is not ready to print");
  }
  await printViaIframe(element);
};

export const downloadMarksheetPdfFromElement = async (
  element: HTMLElement | null,
  filename: string
): Promise<void> => {
  if (!element) {
    throw new Error("Marksheet is not ready to download");
  }

  const clone = cloneMarksheetElement(element);
  clone.style.maxWidth = "210mm";
  clone.style.width = "210mm";
  clone.style.margin = "0";
  clone.style.padding = "12mm 14mm";
  clone.style.background = "#ffffff";
  clone.style.color = "#000000";

  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.left = "-10000px";
  wrapper.style.top = "0";
  wrapper.style.width = "210mm";
  wrapper.style.background = "#ffffff";
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  try {
    const { default: html2pdf } = await import("html2pdf.js");
    await html2pdf()
      .set({
        margin: [12, 14, 12, 14],
        filename,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          backgroundColor: "#ffffff",
          logging: false
        },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
      })
      .from(clone)
      .save();
  } finally {
    document.body.removeChild(wrapper);
  }
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