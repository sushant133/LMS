/**
 * Official Nepal Government Goshwara Bhautchar (गोश्वारा भौचर)
 * Form: म.ले.प.फा.नं. १०
 *
 * Layout matched to the printed paper form (journal.jpeg):
 *  - Header: नेपाल सरकार / dotted office lines / form nos top-right
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

export interface ExactGoshwaraVoucherPdfData {
  /** Under नेपाल सरकार — printed as "{name}कार्यालय" or dots + कार्यालय */
  govOfficeName?: string;
  /** Second dotted line under office (institute) */
  instituteName?: string;
  /** Third dotted line (address / ward) */
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
  name?: string;
  nameNp?: string;
  logo?: string;
  address?: string;
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
  n != null && !Number.isNaN(Number(n)) && Number(n) > 0 ? formatAmountNepali(n, 2) : "";

/** Short blank dots only when field empty (paper form — not a long underline) */
const DOTS_BLANK = "....................";
const DOTS_SHORT = "............";

const fillOrDots = (value?: string, dots = DOTS_BLANK): string => {
  const v = (value ?? "").trim();
  return v ? escapeHtml(v) : dots;
};

/**
 * Paper-accurate Goshwara HTML.
 * Table uses rowspan so left columns are one tall open area; जम्मा only under right cols.
 */
export const buildExactGoshwaraVoucherHtml = (
  data: ExactGoshwaraVoucherPdfData,
  _school: GoshwaraSchoolInfo = {}
): string => {
  const blank = Boolean(data.blankForm);

  const govOffice = blank ? "" : (data.govOfficeName ?? "").trim();
  const institute = blank ? "" : (data.instituteName ?? data.officeName ?? "").trim();
  const address = blank ? "" : (data.addressLine ?? data.officeAddress ?? "").trim();

  /*
   * Line 1 under नेपाल सरकार (paper form):
   *   ....................कार्यालय
   * Dots are only the blank to WRITE the office name — NOT under "कार्यालय".
   * When filled: "जिल्ला शिक्षा कार्यालय" with no dotted underline under कार्यालय.
   */
  const lineOfficeHtml = govOffice
    ? `<div class="hl-wrap office-line"><span class="office-name">${escapeHtml(govOffice)}</span><span class="office-suffix">&nbsp;कार्यालय</span></div>`
    : `<div class="hl-wrap office-line"><span class="office-dots">${DOTS_BLANK}</span><span class="office-suffix">कार्यालय</span></div>`;

  // Institute & address: when filled, plain centered text (no extra dots under the name)
  // When empty, short blank dots only (writing space on blank form)
  const lineInstituteHtml = institute
    ? `<div class="hl-wrap"><span class="hl-plain">${escapeHtml(institute)}</span></div>`
    : `<div class="hl-wrap"><span class="hl-blank">${DOTS_BLANK}</span></div>`;
  const lineAddressHtml = address
    ? `<div class="hl-wrap"><span class="hl-plain">${escapeHtml(address)}</span></div>`
    : `<div class="hl-wrap"><span class="hl-blank">${DOTS_SHORT}</span></div>`;

  // Convert numeric voucher/date digits to Nepali when purely numeric parts present
  const voucherNo = blank ? "" : toNepaliDigits((data.voucherNo ?? "").trim());
  const dateBs = blank ? "" : toNepaliDigits((data.dateBs ?? "").trim());
  const totalStr = blank ? "" : money(data.totalAmount);
  // Prefer user-written Nepali अक्षरेपी; else auto Nepali words
  const words = blank
    ? ""
    : (data.amountInWords ?? "").trim() ||
      (data.totalAmount ? amountToWordsNepali(data.totalAmount) : "");

  // Build freehand-style content stacked inside the tall open cells
  const sourceLines = blank ? [] : data.lines ?? [];

  const snStack: string[] = [];
  const partStack: string[] = [];
  const accStack: string[] = [];
  const ledStack: string[] = [];
  const drStack: string[] = [];
  const crStack: string[] = [];

  for (let i = 0; i < sourceLines.length; i++) {
    const line = sourceLines[i]!;
    const sn =
      line.sn != null && String(line.sn).trim() !== ""
        ? escapeHtml(String(line.sn))
        : toNepaliDigits(i + 1);
    snStack.push(`<div class="entry">${sn}</div>`);
    partStack.push(`<div class="entry">${escapeHtml(line.particulars || "")}</div>`);
    accStack.push(`<div class="entry">${escapeHtml(line.account || "")}</div>`);
    ledStack.push(`<div class="entry">${escapeHtml(line.ledgerNo || "")}</div>`);
    drStack.push(
      `<div class="entry amt">${line.debit ? formatAmountNepali(Number(line.debit), 2) : ""}</div>`
    );
    crStack.push(
      `<div class="entry amt">${line.credit ? formatAmountNepali(Number(line.credit), 2) : ""}</div>`
    );
  }

  const receiptNo = blank ? "" : (data.receiptNo || data.voucherNo || "").trim();
  const receivedAmount = blank
    ? ""
    : (data.receivedAmount || (totalStr ? `रु. ${totalStr}` : "")).trim();
  const presenterDate = blank ? "" : (data.presenterDate || data.dateBs || "").trim();

  return `<!DOCTYPE html>
<html lang="ne">
<head>
  <meta charset="UTF-8"/>
  <title>गोश्वारा भौचर</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600;700&display=swap');

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Noto Sans Devanagari', 'Nirmala UI', Mangal, 'Kokila', sans-serif;
      color: #000;
      font-size: 13px;
      line-height: 1.35;
      /* Equal L/R so centered header is true page center */
      margin: 8mm 0 8mm 0;
      padding: 0 2mm;
    }

    /* ========== HEADER ========== */
    /* True page-center: meta floats absolutely so it does NOT shift the center block */
    .page-header {
      position: relative;
      width: 100%;
      min-height: 88px;
      margin-bottom: 6px;
      text-align: center;
    }
    .meta-right {
      position: absolute;
      top: 0;
      right: 0;
      z-index: 2;
      text-align: right;
      font-size: 11.5px;
      line-height: 1.5;
      max-width: 28%;
      /* no layout impact on centered text */
    }
    .meta-right .form-no { margin-bottom: 2px; }

    .center-head {
      display: block;
      width: 100%;
      margin: 0 auto;
      padding: 0;
      text-align: center;
    }
    .center-head .gov {
      display: block;
      width: 100%;
      text-align: center;
      font-size: 15px;
      font-weight: 700;
      margin-bottom: 10px;
      letter-spacing: normal;
      word-spacing: normal;
    }
    /* Header lines: centered; no underline under fixed labels like कार्यालय */
    .center-head .hl-wrap {
      display: block;
      width: 100%;
      text-align: center;
      margin-top: 7px;
      line-height: 1.45;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: normal;
      word-spacing: normal;
    }
    /* Filled name/address — plain text, no dotted border underneath */
    .center-head .hl-plain {
      display: inline;
      border: none;
      padding: 0;
      letter-spacing: normal;
      word-spacing: normal;
    }
    /* Empty form only: character dots for handwriting space (not a CSS border under words) */
    .center-head .hl-blank {
      display: inline;
      border: none;
      letter-spacing: 0;
    }
    /* Office line: dots BEFORE कार्यालय only — never dots under कार्यालय */
    .center-head .office-line .office-dots {
      display: inline;
      border: none;
      letter-spacing: 0;
      text-decoration: none;
    }
    .center-head .office-line .office-name {
      display: inline;
      border: none;
      text-decoration: none;
    }
    .center-head .office-line .office-suffix {
      display: inline;
      border: none;
      text-decoration: none;
      font-weight: 700;
    }

    /* Title row — title truly centered; मिति absolute on right */
    .title-row {
      position: relative;
      width: 100%;
      text-align: center;
      margin: 16px 0 10px;
      min-height: 28px;
    }
    .title-row h1 {
      font-size: 20px;
      font-weight: 700;
      display: inline-block;
      margin: 0 auto;
      letter-spacing: normal;
      text-align: center;
    }
    .title-row .miti {
      position: absolute;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
    }

    /* ========== MAIN TABLE (paper structure) ========== */
    table.gv {
      width: 100%;
      border-collapse: collapse;
      border: 2px solid #000;
      table-layout: fixed;
    }
    table.gv th,
    table.gv td {
      border: 1px solid #000;
      font-size: 12.5px;
    }
    table.gv thead th {
      font-weight: 700;
      text-align: center;
      vertical-align: middle;
      height: 30px;
      padding: 4px 2px;
      background: #fff;
    }

    /* Column widths matching paper proportions */
    .w-sn   { width: 6%; }
    .w-part { width: 38%; }
    .w-acc  { width: 12%; }
    .w-led  { width: 10%; }
    .w-dr   { width: 17%; }
    .w-cr   { width: 17%; }

    /* Tall open body — left 3 cols rowspan=2 (body+jamma) */
    table.gv td.body-open {
      height: 320px;
      vertical-align: top;
      padding: 6px 4px;
    }
    table.gv td.body-right {
      height: 292px; /* body only; जम्मा row sits below */
      vertical-align: top;
      padding: 6px 4px;
    }
    table.gv td.jamma-label {
      height: 28px;
      text-align: center;
      vertical-align: middle;
      font-weight: 700;
      font-size: 12px;
      padding: 2px;
    }
    table.gv td.jamma-amt {
      height: 28px;
      text-align: right;
      vertical-align: middle;
      font-weight: 700;
      padding: 2px 6px;
      font-size: 12px;
    }

    .entry {
      min-height: 18px;
      margin-bottom: 4px;
      line-height: 1.3;
      word-break: break-word;
    }
    .entry.amt { text-align: right; }

    /* ========== BOTTOM SECTION ========== */
    .bottom {
      margin-top: 10px;
      font-size: 13px;
    }
    .bottom-grid {
      width: 100%;
      border-collapse: collapse;
    }
    .bottom-grid td {
      border: none;
      width: 50%;
      vertical-align: top;
      padding: 2px 0 0 0;
      line-height: 1.95;
    }
    .bottom-grid td.right {
      padding-left: 28px;
    }
    .field-label {
      white-space: nowrap;
    }

    .rule {
      border: none;
      border-top: 1px solid #000;
      margin: 10px 0 8px;
    }
    /* Full-width line on paper between प्राप्त रकम / चेक रकम and पेश गर्ने */
    .rule.mid-rule {
      margin: 6px 0 8px;
      border-top-width: 1.5px;
    }

    .amount-line {
      line-height: 1.85;
      margin-top: 4px;
    }
    .cash-line {
      line-height: 1.85;
      margin-top: 4px;
    }

    .sign-wrap {
      margin-top: 28px;
      text-align: right;
      padding-right: 8px;
    }
    .sign-wrap .cap {
      font-size: 13px;
    }
    .sign-wrap .uline {
      display: inline-block;
      width: 140px;
      border-top: 1px solid #000;
      margin-top: 22px;
    }

    @page {
      size: A4;
      margin: 10mm 10mm;
    }
  </style>
</head>
<body>

  <!-- HEADER: center text is full-width centered; meta is absolute (does not shift center) -->
  <div class="page-header">
    <div class="meta-right">
      <div class="form-no">म.ले.प.फा.नं. १०</div>
      <div>गो. भी. नं.&nbsp;${voucherNo ? escapeHtml(voucherNo) : ""}</div>
    </div>
    <div class="center-head">
      <div class="gov">नेपाल सरकार</div>
      ${lineOfficeHtml}
      ${lineInstituteHtml}
      ${lineAddressHtml}
    </div>
  </div>

  <!-- TITLE: गोश्वारा भौचर dead-center; मिति on the right edge -->
  <div class="title-row">
    <h1>गोश्वारा भौचर</h1>
    <span class="miti">मिति :-&nbsp;${dateBs ? escapeHtml(dateBs) : DOTS_SHORT}</span>
  </div>

  <!-- MAIN TABLE: paper structure -->
  <table class="gv">
    <thead>
      <tr>
        <th class="w-sn">सि.नं.</th>
        <th class="w-part">विवरण</th>
        <th class="w-acc">खाता</th>
        <th class="w-led">हि. नं.</th>
        <th class="w-dr">डेबिट</th>
        <th class="w-cr">क्रेडिट</th>
      </tr>
    </thead>
    <tbody>
      <!--
        Paper form: left 3 columns are ONE tall open area (no mid horizontal rules).
        Right 3 columns: tall open area + bottom जम्मा strip only under those cols.
      -->
      <tr>
        <td class="w-sn body-open" rowspan="2">${snStack.join("")}</td>
        <td class="w-part body-open" rowspan="2">${partStack.join("")}</td>
        <td class="w-acc body-open" rowspan="2">${accStack.join("")}</td>
        <td class="w-led body-right">${ledStack.join("")}</td>
        <td class="w-dr body-right">${drStack.join("")}</td>
        <td class="w-cr body-right">${crStack.join("")}</td>
      </tr>
      <tr>
        <td class="jamma-label">जम्मा</td>
        <td class="jamma-amt">${totalStr}</td>
        <td class="jamma-amt">${totalStr}</td>
      </tr>
    </tbody>
  </table>

  <!-- BOTTOM: matches paper form — top pair, full-width line, then पेश/मिति/दर्जा -->
  <div class="bottom">
    <!-- Row 1–2: रसिद/प्राप्त | चेक नं./चेक रकम -->
    <table class="bottom-grid">
      <tr>
        <td>
          <span class="field-label">रसिद नम्बर :-</span> ${fillOrDots(receiptNo, "")}<br/>
          <span class="field-label">प्राप्त रकम :-</span> ${fillOrDots(receivedAmount, "")}
        </td>
        <td class="right">
          <span class="field-label">चेक नं. :-</span> ${fillOrDots(data.chequeNo, "")}<br/>
          <span class="field-label">चेक रकम :-</span> ${fillOrDots(data.chequeAmount, "")}
        </td>
      </tr>
    </table>

    <!-- Paper form has a solid horizontal line here (between प्राप्त रकम and पेश गर्ने) -->
    <hr class="rule mid-rule"/>

    <!-- Row 3–5: पेश गर्ने / मिति / दर्जा (both columns) -->
    <table class="bottom-grid">
      <tr>
        <td>
          <span class="field-label">पेश गर्ने :-</span> ${fillOrDots(data.presenterName, "")}<br/>
          <span class="field-label">मिति :-</span> ${fillOrDots(presenterDate, "")}<br/>
          <span class="field-label">दर्जा :-</span> ${fillOrDots(data.presenterRank, "")}
        </td>
        <td class="right">
          <span class="field-label">पेश गर्ने :-</span> ${fillOrDots(data.chequePresenter, "")}<br/>
          <span class="field-label">मिति :-</span> ${fillOrDots(data.chequeDate, "")}<br/>
          <span class="field-label">दर्जा :-</span> ${fillOrDots(data.chequeRank, "")}
        </td>
      </tr>
    </table>

    <hr class="rule"/>

    <p class="amount-line">
      यसमा उल्लेखित रकम रु.&nbsp;${totalStr || "...................."}
      &nbsp;&nbsp;अक्षरेपी रु.&nbsp;${words || "................................"}
      &nbsp;बुझिलिन्छ ।
    </p>
    <p class="cash-line">
      चेक नं.&nbsp;${(data.chequeNo || "").trim() || "...................."}
      &nbsp;&nbsp;नगद&nbsp;....................
      &nbsp;&nbsp;बुझिलिएँ ।
    </p>

    <div class="sign-wrap">
      <div class="cap">बुझिलिनेको सही</div>
      <div class="uline"></div>
    </div>
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
  const printLines = (voucher.printLines ?? []).filter(
    (l) =>
      l &&
      (l.particulars ||
        l.account ||
        l.ledgerNo ||
        (l.debit && l.debit > 0) ||
        (l.credit && l.credit > 0))
  );

  const lines =
    printLines.length > 0
      ? printLines.map((l, i) => ({
          sn: l.sn || toNepaliDigits(i + 1),
          particulars: l.particulars || "",
          account: l.account || "",
          ledgerNo: l.ledgerNo || "",
          debit: l.debit && l.debit > 0 ? l.debit : undefined,
          credit: l.credit && l.credit > 0 ? l.credit : undefined
        }))
      : (voucher.lines ?? []).map((line, index) => ({
          sn: toNepaliDigits(index + 1),
          particulars: line.description?.trim() || voucher.particulars,
          account: line.accountName || "",
          ledgerNo: line.accountCode || "",
          debit: line.debitNpr > 0 ? line.debitNpr : undefined,
          credit: line.creditNpr > 0 ? line.creditNpr : undefined
        }));

  return {
    govOfficeName: voucher.govOfficeName || "",
    instituteName: voucher.instituteName || voucher.officeName || "",
    addressLine: voucher.addressLine || "",
    voucherNo: voucher.voucherNo,
    dateBs: voucher.dateBs,
    particulars: voucher.particulars,
    totalAmount: voucher.totalAmount,
    debit: voucher.totalDebitNpr ?? voucher.totalAmount,
    credit: voucher.totalCreditNpr ?? voucher.totalAmount,
    amountInWords: voucher.amountInWords || amountToWordsNepali(voucher.totalAmount),
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
    govOfficeName: params.govOfficeName || "",
    instituteName: params.instituteName || params.officeName || "",
    addressLine: params.addressLine || params.officeAddress || "",
    voucherNo: entry.voucherNumber,
    dateBs: entry.dateBs,
    particulars: entry.narration,
    totalAmount: entry.totalDebitNpr,
    debit: entry.totalDebitNpr,
    credit: entry.totalCreditNpr,
    amountInWords: amountToWordsNepali(entry.totalDebitNpr),
    lines: entry.lines.map((line, index) => ({
      sn: toNepaliDigits(index + 1),
      particulars: line.description?.trim() || entry.narration,
      account: line.accountName,
      ledgerNo: line.accountCode,
      debit: line.debitNpr > 0 ? line.debitNpr : undefined,
      credit: line.creditNpr > 0 ? line.creditNpr : undefined
    }))
  };
};

export const fmt = money;
