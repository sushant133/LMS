/**
 * Static artwork + fonts for the printed Character Certificate.
 *
 * Everything is inlined as a data URI because the PDF is produced by Puppeteer
 * with `setContent`, which has no base URL and no network — an external <img>
 * or @font-face would silently render as a blank box.
 *
 * Files are read once and cached; a missing file degrades to an empty string so
 * a deployment that forgot to ship assets/ still prints a readable certificate.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/** assets/ lives next to the compiled dist/, and at the repo root in dev. */
const assetDirs = (): string[] => {
  const dirs = [path.join(process.cwd(), "assets")];
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // dist/utils/templates -> dist/../assets ; src/utils/templates -> src/../assets
    dirs.push(path.resolve(here, "..", "..", "..", "assets"));
    dirs.push(path.resolve(here, "..", "..", "assets"));
  } catch {
    // import.meta unavailable — cwd lookup is enough
  }
  return dirs;
};

const readAsset = (relativePath: string): Buffer | null => {
  for (const dir of assetDirs()) {
    const candidate = path.join(dir, relativePath);
    if (fs.existsSync(candidate)) {
      try {
        return fs.readFileSync(candidate);
      } catch {
        return null;
      }
    }
  }
  return null;
};

const cache = new Map<string, string>();

const asBase64 = (relativePath: string): string => {
  const cached = cache.get(relativePath);
  if (cached !== undefined) return cached;
  const buffer = readAsset(relativePath);
  const value = buffer ? buffer.toString("base64") : "";
  cache.set(relativePath, value);
  return value;
};

/**
 * The ornamental leaf border, lifted verbatim from the institution's sample
 * certificate as vector paths so it stays crisp at any print size.
 */
export const certificateBorderDataUri = (): string => {
  const base64 = asBase64(path.join("certificate", "character-certificate-border.svg"));
  return base64 ? `data:image/svg+xml;base64,${base64}` : "";
};

interface FontFace {
  /** CSS family name used by the template. */
  family: string;
  file: string;
  format: "truetype" | "opentype";
  weight?: string;
  style?: string;
}

/**
 * Free stand-ins for the Windows/Office fonts the sample was designed with.
 * The template lists the original first in every font-family stack, so a host
 * that actually has them installed prints with the originals instead.
 *
 *   Algerian            -> Rye
 *   Lucida Calligraphy  -> TeX Gyre Chorus
 *   Arial Black         -> Archivo Black
 *   Times New Roman Bd  -> Tinos Bold
 *   Calibri             -> Carlito
 */
const CERTIFICATE_FONTS: FontFace[] = [
  { family: "CC Heading", file: "Rye-Regular.ttf", format: "truetype" },
  { family: "CC Script", file: "texgyrechorus.otf", format: "opentype" },
  { family: "CC Display", file: "ArchivoBlack-Regular.ttf", format: "truetype" },
  { family: "CC Serif", file: "Tinos-Bold.ttf", format: "truetype", weight: "700" },
  { family: "CC Sans", file: "Carlito-Regular.ttf", format: "truetype" }
];

/** `@font-face` block with every certificate font embedded as base64. */
export const certificateFontFaceCss = (): string =>
  CERTIFICATE_FONTS.map((font) => {
    const base64 = asBase64(path.join("fonts", font.file));
    if (!base64) return "";
    const mime = font.format === "opentype" ? "font/otf" : "font/ttf";
    return `@font-face{font-family:'${font.family}';font-style:${font.style ?? "normal"};font-weight:${font.weight ?? "400"};font-display:block;src:url(data:${mime};base64,${base64}) format('${font.format}');}`;
  })
    .filter(Boolean)
    .join("\n");
