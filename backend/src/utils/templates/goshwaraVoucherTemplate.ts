/**
 * Official Nepal Government Goshwara Bhautchar (गोश्वारा भौचर)
 * Form: म.ले.प.फा.नं. १०
 *
 * Layout matched to the printed paper form (journal.jpeg):
 *  - Header (official Nepal Government format, Nepali only — no English):
 *      नेपाल सरकार            (bold, centered)
 *      {College Name (Nepali)} कार्यालय
 *      {College Address (Nepali)}
 *    Both college values come from Institution Settings (never hardcoded).
 *  - Title: गोश्वारा भौचर + मिति
 *  - Table: one tall open writing area (NO dense horizontal row lines)
 *    Columns 1–3 (सि.नं., विवरण, खाता) span full body height
 *    Columns 4–6 (हि. नं., डेबिट, क्रेडिट) body + bottom "जम्मा" cells only
 *  - Bottom: रसिद/चेक two columns, amount lines, बुझिलिनेको सही
 */

import {
  amountToWordsNepali,
  formatAmountNepali,
  toNepaliDigits as toNepaliDigitsShared
} from "@phit-erp/shared";
import { convertHtmlToPdf } from "../convertHtmlToPdf.js";
import { amountToWordsEnglish } from "@phit-erp/shared";

/** Journal vouchers print in English: Nepali digits from older records become 0-9. */
const toLatinDigits = (value: string | number | null | undefined): string =>
  String(value ?? "").replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d)));

const hasDevanagari = (value: string) => /[\u0900-\u097F]/.test(value);

/** Amount for the voucher print, e.g. 12,500.00 */
const formatAmountEnglish = (amount: number): string =>
  Number(amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface ExactGoshwaraVoucherPdfData {
  /**
   * College Name (Nepali) from Institution Settings.
   * Printed under नेपाल सरकार as "{name} कार्यालय" (dots + कार्यालय when unset).
   */
  govOfficeName?: string;
  /** @deprecated Legacy institute line — now only a fallback for `govOfficeName` */
  instituteName?: string;
  /** College Address (Nepali) from Institution Settings — printed under the college name */
  addressLine?: string;
  /** @deprecated */
  officeName?: string;
  officeAddress?: string;
  particulars?: string;
  debit?: number;
  credit?: number;
  totalAmount?: number;
  voucherNo?: string;
  dateBs?: string;
  amountInWords?: string;
  receiptNo?: string;
  receivedAmount?: string;
  presenterName?: string;
  presenterRank?: string;
  presenterDate?: string;
  chequeNo?: string;
  chequeAmount?: string;
  chequePresenter?: string;
  chequeDate?: string;
  chequeRank?: string;
  /** Names under Checked By / Approved By */
  checkedByName?: string;
  approvedByName?: string;
  lines?: Array<{
    sn?: string | number;
    particulars?: string;
    account?: string;
    ledgerNo?: string;
    debit?: number;
    credit?: number;
  }>;
  /** Completely empty paper form */
  blankForm?: boolean;
}

export interface GoshwaraSchoolInfo {
  /** College name (English) — printed at the top of the Journal Voucher */
  name?: string;
  nameNp?: string;
  logo?: string;
  /** College address (English) */
  address?: string;
  /** PAN of the institution (Accounting Settings), printed under the address */
  pan?: string;
  principalName?: string;
}

export const toNepaliDigits = toNepaliDigitsShared;

/** Amount for voucher print — Nepali digits */
export const formatAmount = (amount: number): string => formatAmountNepali(amount, 2);

/** अक्षरेपी — always Nepali words */
export const amountToWords = amountToWordsNepali;

const escapeHtml = (value: string): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const money = (n?: number): string =>
  n != null && !Number.isNaN(Number(n)) && Number(n) > 0 ? formatAmountEnglish(Number(n)) : "";

/** Short blank dots only when field empty (paper form — not a long underline) */
const DOTS_BLANK = "....................";
const DOTS_SHORT = "............";

const fillOrDots = (value?: string, dots = DOTS_BLANK): string => {
  const v = (value ?? "").trim();
  return v ? escapeHtml(v) : dots;
};

/** Nepal fiscal year (Shrawan–Ashadh) of a BS date, e.g. 2083-07-12 → 2083/84 */
const fiscalYearOf = (dateBs: string): string => {
  const match = /^(\d{4})-(\d{2})/.exec(dateBs);
  if (!match) return "";
  const year = Number(match[1]);
  const start = Number(match[2]) >= 4 ? year : year - 1;
  return `${start}/${String(start + 1).slice(-2)}`;
};

/** Rows printed in the table body, so short vouchers still look like the paper form. */
const MIN_TABLE_ROWS = 8;

/**
 * Journal Voucher in the government / IRD format:
 * institution header (name, address, PAN) · title · voucher no. / date / fiscal year ·
 * S.N. | Account Code | Account Head | Particulars | Debit | Credit · total · amount in
 * words · narration · payment details · Prepared / Checked / Approved / Received By.
 */
export const buildExactGoshwaraVoucherHtml = (
  data: ExactGoshwaraVoucherPdfData,
  school: GoshwaraSchoolInfo = {}
): string => {
  const blank = Boolean(data.blankForm);

  // English college name / address; the stored (older, Nepali) header is only a fallback
  const collegeName = (school.name || data.govOfficeName || data.instituteName || data.officeName || "").trim();
  const collegeAddress = (school.address || data.addressLine || data.officeAddress || "").trim();
  const pan = (school.pan || "").trim();

  const voucherNo = blank ? "" : toLatinDigits((data.voucherNo ?? "").trim());
  const dateBs = blank ? "" : toLatinDigits((data.dateBs ?? "").trim());
  const fiscalYear = blank ? "" : fiscalYearOf(dateBs);
  const narration = blank ? "" : (data.particulars ?? "").trim();

  const sourceLines = blank ? [] : data.lines ?? [];
  const totalDebit = sourceLines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
  const totalCredit = sourceLines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0);
  const total = blank ? 0 : Number(data.totalAmount) || Math.max(totalDebit, totalCredit);

  // Amount in words (English); words typed in Nepali on older vouchers are re-written
  const typedWords = (data.amountInWords ?? "").trim();
  const words = blank
    ? ""
    : (typedWords && !hasDevanagari(typedWords) ? typedWords : "") ||
      (total ? `${amountToWordsEnglish(total)} Only` : "");

  const bodyRows = sourceLines.map((line, index) => {
    const sn = line.sn != null && String(line.sn).trim() !== "" ? toLatinDigits(String(line.sn)) : String(index + 1);
    return `<tr>
      <td class="c">${escapeHtml(sn)}</td>
      <td class="c mono">${escapeHtml(toLatinDigits(line.ledgerNo || ""))}</td>
      <td>${escapeHtml(line.account || "")}</td>
      <td>${escapeHtml((line.particulars || "").trim())}</td>
      <td class="c"></td>
      <td class="r">${line.debit ? formatAmountEnglish(Number(line.debit)) : ""}</td>
      <td class="r">${line.credit ? formatAmountEnglish(Number(line.credit)) : ""}</td>
    </tr>`;
  });
  for (let i = bodyRows.length; i < MIN_TABLE_ROWS; i++) {
    bodyRows.push(`<tr class="empty"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`);
  }

  const receiptNo = blank ? "" : toLatinDigits((data.receiptNo || "").trim());
  const receivedAmount = blank
    ? ""
    : toLatinDigits((data.receivedAmount || "").trim()).replace(/^रु\.?\s*/, "Rs. ");
  const chequeNo = blank ? "" : toLatinDigits((data.chequeNo || "").trim());
  const chequeAmount = blank ? "" : toLatinDigits((data.chequeAmount || "").trim()).replace(/^रु\.?\s*/, "Rs. ");
  const chequeDate = blank ? "" : toLatinDigits((data.chequeDate || "").trim());
  const showPayment = blank || Boolean(receiptNo || receivedAmount || chequeNo || chequeAmount);

  const field = (value: string, width = "") =>
    value ? `<span class="val">${escapeHtml(value)}</span>` : `<span class="blank ${width}"></span>`;

  const sign = (title: string, name = "", designation = "", date = "") => `
    <div class="sign">
      <div class="sign-line"></div>
      <div class="sign-title">${title}</div>
      <div class="sign-meta">Name: ${name ? escapeHtml(name) : ""}</div>
      <div class="sign-meta">Designation: ${designation ? escapeHtml(designation) : ""}</div>
      <div class="sign-meta">Date: ${date ? escapeHtml(date) : ""}</div>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <!-- Empty title so the browser print header does not show the document name -->
  <title>&#8203;</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A4 portrait; margin: 0; }
    body {
      font-family: 'Times New Roman', Georgia, 'Noto Sans Devanagari', serif;
      color: #000;
      font-size: 12.5px;
      line-height: 1.4;
      /* Margins on body (not @page) so the browser prints no header/footer */
      margin: 12mm 14mm;
    }
    .head { display: grid; grid-template-columns: 84px 1fr 84px; align-items: start; gap: 10px; }
    .form-no { text-align: right; font-size: 11.5px; font-weight: 700; white-space: nowrap; padding-top: 2px; }
    .logo { width: 60px; height: 60px; object-fit: contain; }
    .head-text { text-align: center; }
    .org { font-size: 18px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; }
    .addr { font-size: 12.5px; margin-top: 2px; }
    .pan { font-size: 12px; margin-top: 2px; }
    .rule { border: 0; border-top: 2px solid #000; margin: 8px 0 0; }
    .rule-thin { border: 0; border-top: 1px solid #000; margin: 2px 0 10px; }
    .title { text-align: center; margin: 2px 0 10px; }
    .title span {
      display: inline-block; border: 1.5px solid #000; padding: 4px 26px;
      font-size: 15px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
    }
    .meta { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 8px; font-size: 12.5px; }
    .meta div:nth-child(2) { text-align: center; }
    .meta div:nth-child(3) { text-align: right; }
    .lbl { font-weight: 700; }
    .val { border-bottom: 1px dotted #000; padding: 0 4px; }
    .blank { display: inline-block; min-width: 110px; border-bottom: 1px dotted #000; height: 1em; vertical-align: bottom; }
    .blank.wide { min-width: 220px; }
    table.jv { width: 100%; border-collapse: collapse; table-layout: fixed; }
    table.jv th, table.jv td { border: 1px solid #000; padding: 5px 6px; vertical-align: top; overflow-wrap: anywhere; }
    table.jv thead th { background: #eee; font-weight: 700; text-align: center; font-size: 12px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    table.jv tbody tr { height: 24px; }
    table.jv tr.empty td { height: 24px; }
    table.jv tfoot td { font-weight: 700; }
    .c { text-align: center; }
    .r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .mono { font-family: 'Courier New', monospace; font-size: 11.5px; }
    .w-sn { width: 6%; } .w-code { width: 11%; } .w-head { width: 20%; } .w-part { width: 25%; } .w-lf { width: 8%; } .w-amt { width: 15%; }
    .block { margin-top: 10px; }
    .block p { margin-top: 4px; }
    .pay { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-top: 10px; padding: 8px 10px; border: 1px solid #000; }
    .signs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; margin-top: 46px; }
    .sign-line { border-top: 1px solid #000; margin-bottom: 4px; }
    .sign-title { font-weight: 700; text-align: center; }
    .sign-meta { font-size: 11px; margin-top: 2px; }
  </style>
</head>
<body>
  <div class="head">
    <div>${school.logo && !blank ? `<img class="logo" src="${school.logo}" alt=""/>` : ""}</div>
    <div class="head-text">
      <div class="org">${collegeName ? escapeHtml(collegeName) : '<span class="blank wide"></span>'}</div>
      <div class="addr">${collegeAddress ? escapeHtml(collegeAddress) : '<span class="blank wide"></span>'}</div>
      ${pan ? `<div class="pan">PAN No.: ${escapeHtml(pan)}</div>` : ""}
    </div>
    <!-- Auditor General form number (म.ले.प.फा.नं. १०), in its own column so it never overlaps the name -->
    <div class="form-no">AGF No. 10</div>
  </div>
  <hr class="rule"/><hr class="rule-thin"/>

  <div class="title"><span>Journal Voucher</span></div>

  <div class="meta">
    <div><span class="lbl">Voucher No.:</span> ${field(voucherNo)}</div>
    <div><span class="lbl">Date (BS):</span> ${field(dateBs)}</div>
    <div><span class="lbl">Fiscal Year:</span> ${field(fiscalYear)}</div>
  </div>

  <table class="jv">
    <thead>
      <tr>
        <th class="w-sn">S.N.</th>
        <th class="w-code">Account Code</th>
        <th class="w-head">Account Head</th>
        <th class="w-part">Particulars</th>
        <th class="w-lf" title="Ledger Folio">L.F.</th>
        <th class="w-amt">Debit (NPR)</th>
        <th class="w-amt">Credit (NPR)</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows.join("")}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="5" class="r">Total</td>
        <td class="r">${blank ? "" : formatAmountEnglish(totalDebit || total)}</td>
        <td class="r">${blank ? "" : formatAmountEnglish(totalCredit || total)}</td>
      </tr>
    </tfoot>
  </table>

  <div class="block">
    <p><span class="lbl">Amount in words:</span> ${words ? `Rupees ${escapeHtml(words.replace(/^Rupees\s+/i, ""))}` : '<span class="blank wide"></span>'}</p>
    <p><span class="lbl">Narration:</span> ${narration ? escapeHtml(narration) : '<span class="blank wide"></span>'}</p>
  </div>

  ${
    showPayment
      ? `<div class="pay">
    <div><span class="lbl">Receipt No.:</span> ${field(receiptNo)}</div>
    <div><span class="lbl">Cheque No.:</span> ${field(chequeNo)}</div>
    <div><span class="lbl">Amount Received:</span> ${field(receivedAmount)}</div>
    <div><span class="lbl">Cheque Amount / Date:</span> ${field([chequeAmount, chequeDate].filter(Boolean).join(" · "))}</div>
  </div>`
      : ""
  }

  <div class="signs">
    ${sign("Prepared By", blank ? "" : data.presenterName || "", blank ? "" : data.presenterRank || "", blank ? "" : toLatinDigits(data.presenterDate || ""))}
    ${sign("Checked By", blank ? "" : data.checkedByName || "")}
    ${sign("Approved By", blank ? "" : data.approvedByName || "")}
    ${sign("Received By", blank ? "" : data.chequePresenter || "", blank ? "" : data.chequeRank || "")}
  </div>

</body>
</html>`;
};

export const generateExactGoshwaraVoucherPDF = async (
  data: ExactGoshwaraVoucherPdfData,
  school: GoshwaraSchoolInfo = {}
): Promise<Buffer> => {
  const html = buildExactGoshwaraVoucherHtml(data, school);
  return await convertHtmlToPdf(html);
};

export const generateExactGoshwaraVoucherHTML = buildExactGoshwaraVoucherHtml;

/** Map stored voucher into print data — only user-entered fields */
export const buildPdfDataFromVoucherRecord = (voucher: {
  voucherNo: string;
  dateBs: string;
  particulars: string;
  govOfficeName?: string | null;
  instituteName?: string | null;
  addressLine?: string | null;
  officeName?: string | null;
  printLines?: Array<{
    sn?: string | null;
    particulars?: string | null;
    account?: string | null;
    ledgerNo?: string | null;
    debit?: number | null;
    credit?: number | null;
  }> | null;
  lines?: Array<{
    accountCode: string;
    accountName: string;
    debitNpr: number;
    creditNpr: number;
    description?: string | null;
  }>;
  totalAmount: number;
  totalDebitNpr?: number;
  totalCreditNpr?: number;
  receiptNo?: string | null;
  receivedAmount?: string | null;
  presenterName?: string | null;
  presenterRank?: string | null;
  chequeNo?: string | null;
  chequeAmount?: string | null;
  chequePresenter?: string | null;
  chequeDate?: string | null;
  chequeRank?: string | null;
  amountInWords?: string | null;
}): ExactGoshwaraVoucherPdfData => {
  const printLines = voucher.printLines ?? [];
  const journalLines = voucher.lines ?? [];

  /**
   * Prefer journal lines (always have description + amounts).
   * Merge print-line overrides; never drop per-line विवरण (description).
   */
  const lines =
    journalLines.length > 0
      ? journalLines.map((line, index) => {
          const pl = printLines[index];
          const particular =
            (pl?.particulars || "").trim() ||
            (line.description || "").trim() ||
            (voucher.particulars || "").trim();
          return {
            sn: toLatinDigits((pl?.sn || "").trim()) || String(index + 1),
            particulars: particular,
            account: (pl?.account || "").trim() || line.accountName || "",
            ledgerNo: (pl?.ledgerNo || "").trim() || line.accountCode || "",
            debit:
              pl?.debit && pl.debit > 0
                ? pl.debit
                : line.debitNpr > 0
                  ? line.debitNpr
                  : undefined,
            credit:
              pl?.credit && pl.credit > 0
                ? pl.credit
                : line.creditNpr > 0
                  ? line.creditNpr
                  : undefined
          };
        })
      : printLines
          .filter(
            (l) =>
              l &&
              (l.particulars ||
                l.account ||
                l.ledgerNo ||
                (l.debit && l.debit > 0) ||
                (l.credit && l.credit > 0))
          )
          .map((l, i) => ({
            sn: toLatinDigits(l.sn) || String(i + 1),
            particulars: (l.particulars || "").trim(),
            account: l.account || "",
            ledgerNo: l.ledgerNo || "",
            debit: l.debit && l.debit > 0 ? l.debit : undefined,
            credit: l.credit && l.credit > 0 ? l.credit : undefined
          }));

  return {
    // Nepal Government header: College Name (Nepali) + College Address (Nepali).
    // Legacy institute/office fields only fill in for records saved before this format.
    govOfficeName: voucher.govOfficeName || voucher.instituteName || voucher.officeName || "",
    addressLine: voucher.addressLine || "",
    voucherNo: voucher.voucherNo,
    dateBs: voucher.dateBs,
    particulars: voucher.particulars,
    totalAmount: voucher.totalAmount,
    debit: voucher.totalDebitNpr ?? voucher.totalAmount,
    credit: voucher.totalCreditNpr ?? voucher.totalAmount,
    // English words unless typed in English on the voucher
    amountInWords:
      voucher.amountInWords && !hasDevanagari(voucher.amountInWords)
        ? voucher.amountInWords
        : `${amountToWordsEnglish(voucher.totalAmount)} Only`,
    receiptNo: voucher.receiptNo || "",
    receivedAmount: voucher.receivedAmount || "",
    presenterName: voucher.presenterName || "",
    presenterRank: voucher.presenterRank || "",
    chequeNo: voucher.chequeNo || "",
    chequeAmount: voucher.chequeAmount || "",
    chequePresenter: voucher.chequePresenter || "",
    chequeDate: voucher.chequeDate || "",
    chequeRank: voucher.chequeRank || "",
    lines
  };
};

export const buildExactPdfDataFromJournal = (params: {
  entry: {
    voucherNumber: string;
    dateBs: string;
    narration: string;
    lines: Array<{
      accountCode: string;
      accountName: string;
      debitNpr: number;
      creditNpr: number;
      description?: string;
    }>;
    totalDebitNpr: number;
    totalCreditNpr: number;
  };
  officeName?: string;
  officeAddress?: string;
  govOfficeName?: string;
  instituteName?: string;
  addressLine?: string;
  blankForm?: boolean;
}): ExactGoshwaraVoucherPdfData => {
  if (params.blankForm) {
    return { blankForm: true };
  }

  const { entry } = params;
  return {
    // Nepal Government header: College Name (Nepali) + College Address (Nepali).
    govOfficeName: params.govOfficeName || params.instituteName || params.officeName || "",
    addressLine: params.addressLine || params.officeAddress || "",
    voucherNo: entry.voucherNumber,
    dateBs: entry.dateBs,
    particulars: entry.narration,
    totalAmount: entry.totalDebitNpr,
    debit: entry.totalDebitNpr,
    credit: entry.totalCreditNpr,
    amountInWords: `${amountToWordsEnglish(entry.totalDebitNpr)} Only`,
    // Each journal line description → PDF विवरण (e.g. नगद प्राप्त / शुल्क आम्दानी)
    lines: entry.lines.map((line, index) => ({
      sn: String(index + 1),
      particulars: (line.description || "").trim() || entry.narration,
      account: line.accountName,
      ledgerNo: line.accountCode,
      debit: line.debitNpr > 0 ? line.debitNpr : undefined,
      credit: line.creditNpr > 0 ? line.creditNpr : undefined
    }))
  };
};

export const fmt = money;
