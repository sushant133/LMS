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
  const isTimetableSheet =
    clone.getAttribute("data-print-fit") === "timetable" ||
    clone.classList.contains("timetable-print-sheet");
  clone.style.setProperty(
    "display",
    isTimetableSheet ? "flex" : "block",
    "important",
  );
  if (isTimetableSheet) {
    clone.style.setProperty("flex-direction", "column", "important");
  }
  clone.style.setProperty("visibility", "visible", "important");
  clone.style.position = "static";
  clone.style.left = "auto";
  clone.style.top = "auto";
  clone.style.right = "auto";
  clone.style.bottom = "auto";
  clone.style.transform = "none";
  clone.style.opacity = "1";
  // Timetable width is decided later by the page-fit pass (`fitTimetableSheet`);
  // leave it unconstrained here so nothing squeezes columns before measuring.
  if (isTimetableSheet) {
    clone.style.setProperty("width", "auto", "important");
    clone.style.setProperty("min-width", "0", "important");
    clone.style.setProperty("max-width", "none", "important");
  } else {
    clone.style.width = "100%";
    clone.style.maxWidth = "100%";
  }
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

  // The grid ships a print min-width; anything wider than the page-fit layout
  // width would overflow the clip box and silently cut off the last periods.
  clone.querySelectorAll<HTMLElement>(".tt-print-table").forEach((table) => {
    table.style.setProperty("min-width", "0", "important");
    table.style.setProperty("width", "100%", "important");
    table.style.setProperty("table-layout", "fixed", "important");
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

const MODERN_COLOR_TEST = /oklch|oklab|color-mix\(|\blab\(|\blch\(|\bcolor\(/i;
const MODERN_COLOR_FN =
  /\b(oklch|oklab|color-mix|lch|lab|color)\(/gi;

const modernColorCache = new Map<string, string>();
let colorProbeCtx: CanvasRenderingContext2D | null | undefined;

const getColorProbe = (): CanvasRenderingContext2D | null => {
  if (colorProbeCtx !== undefined) return colorProbeCtx;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    colorProbeCtx = canvas.getContext("2d", { willReadFrequently: true });
  } catch {
    colorProbeCtx = null;
  }
  return colorProbeCtx;
};

/**
 * Resolve one modern color function (oklch/lab/color-mix…) to rgb/rgba.
 *
 * Canvas parses every CSS color the browser knows, but `fillStyle` serializes
 * oklch straight back as oklch — so paint one pixel and read it instead.
 */
const resolveModernColor = (value: string): string | null => {
  const cached = modernColorCache.get(value);
  if (cached !== undefined) return cached || null;

  const ctx = getColorProbe();
  if (!ctx) return null;

  const paintCurrentFill = (): string => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data).join(",");
  };

  let resolved: string | null = null;
  try {
    // Two sentinels: an unparseable value leaves fillStyle untouched, so
    // differing results mean "rejected" rather than "really this colour".
    ctx.fillStyle = "#000000";
    ctx.fillStyle = value;
    const fromBlack = paintCurrentFill();
    ctx.fillStyle = "#ffffff";
    ctx.fillStyle = value;
    const fromWhite = paintCurrentFill();

    if (fromBlack === fromWhite) {
      const [r = 0, g = 0, b = 0, a = 255] = fromBlack.split(",").map(Number);
      resolved =
        a >= 255
          ? `rgb(${r}, ${g}, ${b})`
          : `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(3))})`;
    }
  } catch {
    resolved = null;
  }

  modernColorCache.set(value, resolved ?? "");
  return resolved;
};

/** Replace every modern color function inside a CSS value (incl. gradients). */
const resolveModernColorsInValue = (value: string): string => {
  if (!MODERN_COLOR_TEST.test(value)) return value;

  let out = "";
  let cursor = 0;
  MODERN_COLOR_FN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = MODERN_COLOR_FN.exec(value)) !== null) {
    const start = match.index;
    if (start < cursor) continue;

    // Walk to the matching close paren (values nest: linear-gradient(oklch(…)))
    let depth = 0;
    let end = -1;
    for (let i = start + match[0].length - 1; i < value.length; i += 1) {
      const char = value[i];
      if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;

    const fnText = value.slice(start, end + 1);
    out += value.slice(cursor, start) + (resolveModernColor(fnText) ?? fnText);
    cursor = end + 1;
    MODERN_COLOR_FN.lastIndex = cursor;
  }

  return out + value.slice(cursor);
};

/**
 * Copy computed styles onto inline styles, converting Tailwind v4 oklch()
 * colors to rgb. Required for html2canvas, which cannot parse modern color
 * functions and throws on them — breaking PDF/image export.
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
        const raw = cs.getPropertyValue(prop);
        if (!raw) continue;
        const value = resolveModernColorsInValue(raw);
        // Anything still unresolved would crash html2canvas — leave it out
        if (MODERN_COLOR_TEST.test(value)) continue;
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
  // External Tailwind bundles almost always contain oklch in v4. Webfont
  // sheets carry only @font-face, and dropping them breaks Devanagari output.
  doc.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
    const href = link.getAttribute("href") ?? "";
    if (!/fonts\.googleapis\.com|fonts\.gstatic\.com|fonts?\./i.test(href)) {
      link.remove();
    }
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

/**
 * Wait until the print document's stylesheets and webfonts are usable.
 * Measuring before Tailwind/Devanagari land yields a layout that is nothing
 * like the printed one, which is what makes the fitted grid come out clipped.
 */
const waitForStylesAndFonts = async (
  doc: Document,
  timeoutMs = 4_000,
): Promise<void> => {
  const links = Array.from(
    doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  );

  const sheetsReady = Promise.all(
    links.map(
      (link) =>
        new Promise<void>((resolve) => {
          if (link.sheet) {
            resolve();
            return;
          }
          link.addEventListener("load", () => resolve(), { once: true });
          link.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );

  const fontsReady = doc.fonts?.ready ?? Promise.resolve();

  await Promise.race([
    Promise.all([sheetsReady, fontsReady]),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeoutMs);
    }),
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

const isTimetableElement = (element: HTMLElement | null | undefined): boolean => {
  if (!element) return false;
  return (
    element.getAttribute("data-print-fit") === "timetable" ||
    element.classList.contains("timetable-print-sheet") ||
    Boolean(element.querySelector?.("[data-print-fit='timetable']"))
  );
};

/** mm → CSS px at 96dpi */
const MM_TO_PX = 96 / 25.4;

/** Must match the @page margin emitted for timetable sheets. */
const TIMETABLE_PAGE_MARGIN_MM = 4;

/** Sub-pixel rounding guard so a full-width fit never spills onto page 2. */
const FIT_SAFETY = 0.997;

type PageBox = {
  pageWidthMm: number;
  pageHeightMm: number;
  usableWidthMm: number;
  usableHeightMm: number;
  maxWidth: number;
  maxHeight: number;
};

const pageBoxFor = (pageFormat: PageFormat): PageBox => {
  const isLandscape = pageFormat === "a4-landscape";
  const pageWidthMm = isLandscape ? 297 : 210;
  const pageHeightMm = isLandscape ? 210 : 297;
  const usableWidthMm = pageWidthMm - TIMETABLE_PAGE_MARGIN_MM * 2;
  const usableHeightMm = pageHeightMm - TIMETABLE_PAGE_MARGIN_MM * 2;
  return {
    pageWidthMm,
    pageHeightMm,
    usableWidthMm,
    usableHeightMm,
    maxWidth: usableWidthMm * MM_TO_PX,
    maxHeight: usableHeightMm * MM_TO_PX,
  };
};

const setImportant = (
  element: HTMLElement,
  styles: Record<string, string>,
): void => {
  for (const [prop, value] of Object.entries(styles)) {
    element.style.setProperty(prop, value, "important");
  }
};

/**
 * Make the grid own the sheet's leftover vertical space (or release it again
 * while measuring). Without this a 7-row week prints as a small band at the
 * top of an otherwise blank page.
 */
const setTimetableStretch = (sheet: HTMLElement, stretch: boolean): void => {
  const grid = sheet.querySelector<HTMLElement>(".tt-print-grid");
  const gridHost = grid?.parentElement ?? null;
  const table = sheet.querySelector<HTMLElement>(".tt-print-table");
  const tableHost = table?.parentElement ?? null;

  const boxHeight = stretch ? "100%" : "auto";

  if (gridHost && gridHost !== sheet) {
    setImportant(gridHost, {
      flex: "1 1 auto",
      "min-height": "0",
      display: "block",
      height: "auto",
    });
  }
  if (grid) setImportant(grid, { height: boxHeight, display: "block" });
  if (tableHost) setImportant(tableHost, { height: boxHeight });
  if (table) setImportant(table, { height: boxHeight, width: "100%" });

  // Cell bodies carry the session background, so they must fill their row
  // (a row is as tall as its tallest cell) — otherwise the colour block stops
  // short and the rest of the cell prints white. Percentage heights against an
  // auto-height cell behave as `auto`, so this is safe while measuring too.
  sheet
    .querySelectorAll<HTMLElement>(".tt-print-table td > *")
    .forEach((cellBody) => {
      setImportant(cellBody, { height: "100%", "box-sizing": "border-box" });
    });
};

type TimetableFit = {
  layoutWidth: number;
  layoutHeight: number;
  scale: number;
};

/** Lay the sheet out at `width` (px) and report its natural height. */
const measureSheetAtWidth = (sheet: HTMLElement, width: number): number => {
  setImportant(sheet, {
    width: `${Math.round(width)}px`,
    "min-width": "0",
    "max-width": "none",
    height: "auto",
    "max-height": "none",
  });
  void sheet.offsetHeight;
  return Math.max(sheet.scrollHeight, sheet.offsetHeight, 1);
};

/**
 * Size a timetable sheet so the whole grid lands on exactly one page.
 *
 * The sheet starts at full page width — never at the viewport width, which is
 * what used to squeeze columns and clip the last periods. If it is still too
 * tall, we re-lay it out *wider* (rows get shorter) and scale the result down,
 * which fills far more of the page than shrinking a page-width layout. The
 * element is left with an explicit px box; the caller applies the transform.
 */
const fitTimetableSheet = (
  sheet: HTMLElement,
  pageFormat: PageFormat,
): TimetableFit => {
  const { maxWidth, maxHeight } = pageBoxFor(pageFormat);

  // Reset whatever an earlier pass (or the source markup) left behind so every
  // measurement happens in plain, unconstrained block flow.
  setImportant(sheet, {
    position: "static",
    float: "none",
    margin: "0",
    transform: "none",
    "transform-origin": "top left",
    display: "flex",
    "flex-direction": "column",
    "box-sizing": "border-box",
    overflow: "visible",
  });
  setTimetableStretch(sheet, false);

  let layoutWidth = maxWidth;
  let layoutHeight = measureSheetAtWidth(sheet, layoutWidth);
  let scale = Math.min(1, maxHeight / layoutHeight);

  for (let pass = 0; pass < 3 && scale < 0.995; pass += 1) {
    const candidateWidth = Math.min(layoutWidth / scale, maxWidth * 4);
    if (candidateWidth <= layoutWidth * 1.01) break;

    const candidateHeight = measureSheetAtWidth(sheet, candidateWidth);
    const candidateScale = Math.min(
      maxWidth / candidateWidth,
      maxHeight / candidateHeight,
    );
    // Keep whichever layout ends up visually widest on the page
    if (candidateScale * candidateWidth <= scale * layoutWidth * 1.002) {
      layoutHeight = measureSheetAtWidth(sheet, layoutWidth);
      break;
    }
    layoutWidth = candidateWidth;
    layoutHeight = candidateHeight;
    scale = candidateScale;
  }

  // Shorter than the page → stretch the grid down so the sheet fills it.
  if (layoutHeight < maxHeight) {
    setTimetableStretch(sheet, true);
    layoutHeight = maxHeight;
  }

  const safeScale = Math.max(0.2, Math.min(scale, 1) * FIT_SAFETY);

  // Freeze the measured box so applying the transform cannot reflow anything.
  setImportant(sheet, {
    width: `${Math.round(layoutWidth)}px`,
    height: `${Math.round(layoutHeight)}px`,
  });

  return { layoutWidth, layoutHeight, scale: safeScale };
};

/**
 * Scale a timetable sheet to fill (and never exceed) one page, centered.
 * Uses a fixed clip box so the browser cannot invent a second page.
 */
const fitTimetableSheetToPage = (
  doc: Document,
  pageFormat: PageFormat,
): void => {
  const sheet = doc.querySelector<HTMLElement>(
    "[data-print-fit='timetable'], .timetable-print-sheet",
  );
  if (!sheet) return;

  const page = pageBoxFor(pageFormat);
  const body = doc.body;

  // A centered flex body shrinks the sheet before it can be measured, so
  // measure in plain block flow and switch to centering afterwards.
  setImportant(body, {
    margin: "0",
    padding: "0",
    background: "#ffffff",
    display: "block",
    width: `${page.usableWidthMm}mm`,
    height: "auto",
    overflow: "visible",
  });

  let stage = sheet.parentElement;
  if (!stage || !stage.classList.contains("tt-print-stage")) {
    stage = doc.createElement("div");
    stage.className = "tt-print-stage";
    sheet.parentNode?.insertBefore(stage, sheet);
    stage.appendChild(sheet);
  }
  // Neutralize the clip box while measuring — a stage still holding the
  // previous pass's fixed size is what made re-fits measure a wrong width.
  setImportant(stage, {
    position: "static",
    display: "block",
    margin: "0",
    padding: "0",
    width: "auto",
    height: "auto",
    "max-width": "none",
    overflow: "visible",
  });

  const fit = fitTimetableSheet(sheet, pageFormat);

  const stageWidth = Math.floor(fit.layoutWidth * fit.scale);
  const stageHeight = Math.floor(fit.layoutHeight * fit.scale);

  setImportant(stage, {
    position: "relative",
    display: "block",
    width: `${stageWidth}px`,
    height: `${stageHeight}px`,
    overflow: "hidden",
    "flex-shrink": "0",
    "page-break-inside": "avoid",
    "break-inside": "avoid",
    "page-break-after": "avoid",
  });

  setImportant(sheet, {
    position: "absolute",
    left: "0",
    top: "0",
    transform: `scale(${fit.scale})`,
    "transform-origin": "top left",
  });

  // Final page box: exactly the printable area, so nothing can overflow it.
  setImportant(body, {
    width: `${page.usableWidthMm}mm`,
    height: `${page.usableHeightMm}mm`,
    overflow: "hidden",
    display: "flex",
    "align-items": "center",
    "justify-content": "center",
  });
};

const buildPrintableHtml = (element: HTMLElement, pageFormat: PageFormat): string => {
  const clone = clonePrintableElement(element);
  const isLandscape = pageFormat === "a4-landscape";
  const isTimetable = isTimetableElement(clone);
  const page = pageBoxFor(pageFormat);
  // Only the timetable is a strict one-page fit (fixed height + overflow clip +
  // flex center). Multi-page lists (students, staff, library, …) must paginate
  // freely — height:one-page + overflow:hidden was clipping rows past page 1.
  const printBox = isTimetable
    ? page
    : { usableWidthMm: page.pageWidthMm, usableHeightMm: page.pageHeightMm };

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
      /* Multi-page list sheets: natural flow, repeat headers, keep rows whole */
      ${
        isTimetable
          ? ""
          : `
      body {
        display: block !important;
        width: auto !important;
        height: auto !important;
        min-height: 0 !important;
        overflow: visible !important;
        padding: 0 !important;
        margin: 0 !important;
      }
      body > * {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
        overflow: visible !important;
      }
      table {
        width: 100% !important;
        max-width: 100% !important;
        border-collapse: collapse !important;
        page-break-inside: auto !important;
        break-inside: auto !important;
      }
      thead { display: table-header-group !important; }
      tfoot { display: table-footer-group !important; }
      tr {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      th, td {
        word-break: break-word !important;
        overflow-wrap: anywhere !important;
        vertical-align: top !important;
      }
      img {
        max-width: 100% !important;
        height: auto !important;
      }
      `
      }
      /* Timetable: high-contrast period header + single A4 landscape fit */
      .timetable-print-sheet,
      .tt-print-grid {
        color: #000000 !important;
        background: #ffffff !important;
      }
      .timetable-print-sheet[data-print-fit="timetable"] {
        box-sizing: border-box !important;
        /* width/height are owned by the page-fit pass (inline !important) */
        max-width: none !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 2mm 2.5mm 1.5mm !important;
        overflow: visible !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        page-break-after: avoid !important;
        page-break-before: avoid !important;
      }
      .tt-print-stage {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        page-break-after: avoid !important;
      }
      .timetable-print-sheet[data-print-fit="timetable"] .tt-print-header {
        page-break-after: avoid !important;
        break-after: avoid !important;
      }
      .timetable-print-sheet[data-print-fit="timetable"] .tt-print-footer {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        page-break-before: avoid !important;
      }
      .tt-print-table {
        border-collapse: collapse !important;
        width: 100% !important;
        min-width: 0 !important;
        table-layout: fixed !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      .tt-print-table thead,
      .tt-print-table tbody,
      .tt-print-table tr {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      .tt-print-table thead th,
      .tt-print-th {
        background-color: #0f172a !important;
        color: #ffffff !important;
        border: 1px solid #000000 !important;
        font-weight: 700 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        padding: 2px 3px !important;
        line-height: 1.12 !important;
        vertical-align: middle !important;
        word-break: break-word !important;
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
        padding: 2px 3px !important;
        line-height: 1.12 !important;
        vertical-align: middle !important;
      }
      .tt-print-table td {
        border: 1px solid #000000 !important;
        padding: 0 !important;
        vertical-align: top !important;
        /* overflow:hidden used to slice subject/teacher names in half — let the
           row grow instead; the page-fit pass scales the sheet to fit. */
        overflow: visible !important;
      }
      .tt-print-table td,
      .tt-print-table th {
        word-break: break-word !important;
        overflow-wrap: anywhere !important;
      }
      .tt-print-table td > * {
        min-height: 0 !important;
        height: 100% !important;
      }
      /* Density-aware print type scale (set via data-tt-density on sheet/grid) */
      .timetable-print-sheet[data-tt-density="compact"] .tt-print-table,
      .tt-print-grid[data-tt-density="compact"] .tt-print-table {
        font-size: 9px !important;
      }
      .timetable-print-sheet[data-tt-density="dense"] .tt-print-table,
      .tt-print-grid[data-tt-density="dense"] .tt-print-table {
        font-size: 8px !important;
      }
      .timetable-print-sheet[data-tt-density="ultra"] .tt-print-table,
      .tt-print-grid[data-tt-density="ultra"] .tt-print-table {
        font-size: 7.5px !important;
      }
      .sticky {
        position: static !important;
      }
      @page {
        size: A4 ${isLandscape ? "landscape" : "portrait"};
        margin: ${isTimetable ? `${TIMETABLE_PAGE_MARGIN_MM}mm` : "8mm 6mm"};
      }
      @media print {
        ${
          isTimetable
            ? `
        html, body {
          /* Printable area, i.e. page size minus the @page margin. Using the
             full page size here overflows it and spawns a blank second page. */
          width: ${printBox.usableWidthMm}mm !important;
          height: ${printBox.usableHeightMm}mm !important;
          overflow: hidden !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        body {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
        }
        `
            : `
        html, body {
          /* Multi-page reports (student list, staff, inventory, …): allow
             height to grow so every row prints across pages. */
          width: auto !important;
          height: auto !important;
          min-height: 0 !important;
          overflow: visible !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        body {
          display: block !important;
        }
        `
        }
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
    const isLandscape = pageFormat === "a4-landscape";
    const isTimetable = isTimetableElement(element);

    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.left = "0";
    iframe.style.top = "0";
    // Full page size (not 0×0) so layout/measurement matches print engine
    iframe.style.width = isLandscape ? "297mm" : "210mm";
    iframe.style.height = isLandscape ? "210mm" : "297mm";
    iframe.style.border = "0";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";
    iframe.style.zIndex = "-1";
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
      }, 280);
    };

    doc.open();
    doc.write(buildPrintableHtml(element, pageFormat));
    doc.close();

    void (async () => {
      // Measuring before the app CSS + Devanagari webfont land produces a
      // layout that does not match the printed one → clipped / half-empty page.
      await waitForStylesAndFonts(doc);
      await waitForImages(doc.body);
      await yieldToUi();
      if (isTimetable) {
        try {
          fitTimetableSheetToPage(doc, pageFormat);
          await yieldToUi();
          // Second pass once layout has fully settled (fit is idempotent)
          fitTimetableSheetToPage(doc, pageFormat);
        } catch {
          // non-fatal — print with default layout
        }
      }
      startPrint();
    })();
  });

const mountPrintableClone = (element: HTMLElement, pageFormat: PageFormat) => {
  const isLandscape = pageFormat === "a4-landscape";
  const clone = clonePrintableElement(element);
  const isTimetable = isTimetableElement(clone);

  if (isTimetable) {
    clone.style.margin = "0";
    clone.style.padding = "2mm 2.5mm 1.5mm";
    clone.style.overflow = "visible";
  } else {
    clone.style.maxWidth = isLandscape ? "297mm" : "210mm";
    clone.style.width = isLandscape ? "297mm" : "210mm";
    clone.style.margin = "0";
    clone.style.padding = isLandscape ? "10mm 12mm" : "12mm 14mm";
  }
  clone.style.background = "#ffffff";
  clone.style.color = "#000000";
  clone.style.boxSizing = "border-box";

  const wrapper = document.createElement("div");
  // Keep on-screen but invisible so layout/fonts compute correctly (off-screen
  // left:-10000px can yield 0×0 captures in some browsers).
  wrapper.style.position = "fixed";
  wrapper.style.left = "0";
  wrapper.style.top = "0";
  wrapper.style.background = "#ffffff";
  wrapper.style.opacity = "0";
  wrapper.style.pointerEvents = "none";
  wrapper.style.zIndex = "-1";
  wrapper.style.overflow = "visible";
  wrapper.setAttribute("aria-hidden", "true");
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  if (isTimetable) {
    // The sheet gets its own layout context sized to the page — clamping it to
    // the viewport (the old `max-width: 100vw`) squeezed the period columns and
    // clipped cell text out of the capture on anything but a wide screen.
    wrapper.style.width = "max-content";
    wrapper.style.maxWidth = "none";
  } else {
    wrapper.style.width = isLandscape ? "297mm" : "210mm";
    wrapper.style.maxWidth = "100vw";
  }

  return { clone, wrapper, isLandscape, isTimetable };
};

/** Re-run the page fit for an on-DOM timetable clone (PDF / PNG capture). */
const layoutTimetableCloneForCapture = (
  clone: HTMLElement,
  wrapper: HTMLElement,
  pageFormat: PageFormat,
): TimetableFit => {
  const fit = fitTimetableSheet(clone, pageFormat);
  // Capture at layout size — jsPDF scales the bitmap onto the page, which is
  // sharper than rasterizing an already CSS-transformed element.
  wrapper.style.width = `${Math.ceil(fit.layoutWidth)}px`;
  wrapper.style.height = `${Math.ceil(fit.layoutHeight)}px`;
  return fit;
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

  const { clone, wrapper, isLandscape, isTimetable } = mountPrintableClone(
    element,
    pageFormat,
  );

  // Force single-page fit for marksheets and timetables
  const fitOnePage = singlePage || isTimetable;

  // Marksheet: keep internal padding tight so content fits one A4 page
  if (singlePage && !isTimetable) {
    clone.style.padding = "5mm 6mm";
    clone.style.maxWidth = "210mm";
    clone.style.width = "210mm";
    clone.style.boxSizing = "border-box";
  }

  try {
    if (isTimetable) {
      // Fit after fonts/logo settle so the measured box matches what renders
      await waitForImages(clone);
      await yieldToUi();
      layoutTimetableCloneForCapture(clone, wrapper, pageFormat);
      await yieldToUi();
      layoutTimetableCloneForCapture(clone, wrapper, pageFormat);
    }

    // Prefer direct canvas + jsPDF — more reliable than html2pdf with Tailwind v4
    const canvas = await rasterizeCloneToCanvas(clone, fitOnePage ? 2.4 : 2);
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
    // Timetable: tight 4mm margins, centered, single page only
    const margin = isTimetable ? 4 : fitOnePage ? (isLandscape ? 4 : 5) : isLandscape ? 8 : 10;
    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2;
    const imgData = canvas.toDataURL("image/jpeg", 0.94);

    if (fitOnePage) {
      // Fit image into usable box (scale up or down), center H+V — never add page 2
      const widthScale = usableWidth / canvas.width;
      const heightScale = usableHeight / canvas.height;
      let scale = Math.min(widthScale, heightScale);
      // Use nearly full page; tiny safety factor avoids edge clipping
      scale *= isTimetable ? 0.998 : 1;
      const drawWidth = canvas.width * scale;
      const drawHeight = canvas.height * scale;
      const x = margin + (usableWidth - drawWidth) / 2;
      const y = margin + (usableHeight - drawHeight) / 2;
      pdf.addImage(imgData, "JPEG", x, y, drawWidth, drawHeight, undefined, "FAST");
      return pdf.output("blob");
    }

    const imgHeight = (canvas.height * usableWidth) / canvas.width;
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
  // Timetable (and other landscape sheets): A4 landscape, single-page fit
  const isTimetable =
    element.getAttribute("data-print-fit") === "timetable" ||
    element.classList.contains("timetable-print-sheet");
  const blob = await createPdfBlobFromElement(
    element,
    isTimetable
      ? { pageFormat: "a4-landscape", singlePage: true }
      : "a4-landscape",
  );
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
  const { clone, wrapper, isTimetable } = mountPrintableClone(
    element,
    "a4-landscape",
  );
  try {
    if (isTimetable) {
      await waitForImages(clone);
      await yieldToUi();
      layoutTimetableCloneForCapture(clone, wrapper, "a4-landscape");
      await yieldToUi();
      layoutTimetableCloneForCapture(clone, wrapper, "a4-landscape");
    }
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