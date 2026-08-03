/**
 * Shared institution branding for Print / PDF headers.
 * AppLayout keeps this in sync so standalone HTML prints can resolve name + address
 * without each panel re-fetching settings.
 */

export type PrintAddressLike = {
  streetAddress?: string | null;
  ward?: string | number | null;
  municipality?: string | null;
  district?: string | null;
  province?: string | null;
} | null | undefined;

export type PrintInstitutionBranding = {
  name: string;
  nameNp?: string;
  address?: string;
};

const DEFAULT_NAME = "Institution";

let cached: PrintInstitutionBranding = { name: DEFAULT_NAME };

export const formatPrintAddress = (address?: PrintAddressLike): string => {
  if (!address) return "";
  return [
    address.streetAddress,
    address.ward != null && String(address.ward).trim()
      ? `Ward ${String(address.ward).trim()}`
      : "",
    address.municipality,
    address.district,
    address.province,
  ]
    .map((p) => (p == null ? "" : String(p).trim()))
    .filter(Boolean)
    .join(", ");
};

/** Called from AppLayout when school context is known. */
export const setPrintInstitutionBranding = (
  branding: PrintInstitutionBranding,
): void => {
  const name = branding.name?.trim() || DEFAULT_NAME;
  const nameNp = branding.nameNp?.trim() || "";
  const address = branding.address?.trim() || "";
  cached = {
    name,
    nameNp: nameNp || undefined,
    address: address || undefined,
  };

  try {
    const root = document.documentElement;
    root.dataset.collegeName = name;
    if (nameNp) root.dataset.collegeNameNp = nameNp;
    else delete root.dataset.collegeNameNp;
    if (address) root.dataset.collegeAddress = address;
    else delete root.dataset.collegeAddress;
  } catch {
    /* SSR / non-DOM */
  }
};

/** Resolve branding for print builders (cache → DOM data attributes → fallback). */
export const getPrintInstitutionBranding = (): PrintInstitutionBranding => {
  try {
    const root = document.documentElement;
    const fromDomName = root.dataset.collegeName?.trim();
    const fromDomAddress = root.dataset.collegeAddress?.trim();
    const fromDomNp = root.dataset.collegeNameNp?.trim();
    if (fromDomName) {
      return {
        name: fromDomName,
        nameNp: fromDomNp || cached.nameNp,
        address: fromDomAddress || cached.address,
      };
    }
    const el = document.querySelector(
      "[data-college-name]",
    ) as HTMLElement | null;
    if (el?.dataset.collegeName?.trim()) {
      return {
        name: el.dataset.collegeName.trim(),
        nameNp: el.dataset.collegeNameNp?.trim() || cached.nameNp,
        address: el.dataset.collegeAddress?.trim() || cached.address,
      };
    }
  } catch {
    /* ignore */
  }
  return {
    name: cached.name || DEFAULT_NAME,
    nameNp: cached.nameNp,
    address: cached.address,
  };
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Centered institution header HTML for iframe / window.print documents.
 * Always includes name; address line only when available.
 */
export const buildPrintInstitutionHeaderHtml = (options?: {
  branding?: PrintInstitutionBranding;
  /** Extra CSS class on wrapper */
  className?: string;
}): string => {
  const b = options?.branding ?? getPrintInstitutionBranding();
  const cls = options?.className ? ` class="${escapeHtml(options.className)}"` : "";
  const nameNp = b.nameNp
    ? `<div class="print-inst-name-np">${escapeHtml(b.nameNp)}</div>`
    : "";
  const address = b.address
    ? `<div class="print-inst-address">${escapeHtml(b.address)}</div>`
    : "";
  return `<div${cls} class="print-inst-header">
  <div class="print-inst-name">${escapeHtml(b.name)}</div>
  ${nameNp}
  ${address}
</div>`;
};

/** Minimal CSS snippet for the institution header (include in print HTML). */
export const PRINT_INSTITUTION_HEADER_CSS = `
  .print-inst-header { text-align: center; margin: 0 0 10px; padding: 0 0 8px; border-bottom: 2px solid #0f172a; }
  .print-inst-name { margin: 0; font-size: 16px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; color: #0f172a; }
  .print-inst-name-np { margin: 2px 0 0; font-size: 12px; color: #334155; }
  .print-inst-address { margin: 3px 0 0; font-size: 11px; color: #475569; line-height: 1.35; }
`;
