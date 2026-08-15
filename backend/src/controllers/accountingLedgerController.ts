import type { Request, Response } from "express";
import fs from "fs";
import {
  chartOfAccountSchema,
  feeRefundSchema,
  fiscalYearSchema,
  goshwaraVoucherSchema,
  isInstitutionAdmin,
  journalEntrySchema,
  normalizeUserRole,
  vendorSchema,
  type AccountingReportType
} from "@phit-erp/shared";
import { ChartOfAccount } from "../models/ChartOfAccount.js";
import { FeeCollection } from "../models/FeeCollection.js";
import { FeeRefund } from "../models/FeeRefund.js";
import { FiscalYear } from "../models/FiscalYear.js";
import { GoshwaraVoucher } from "../models/GoshwaraVoucher.js";
import { JournalEntry } from "../models/JournalEntry.js";
import { Student } from "../models/Student.js";
import { Vendor } from "../models/Vendor.js";
import { Batch } from "../models/Batch.js";
import { Year } from "../models/Year.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { AccountingSettings } from "../models/AccountingSettings.js";
import { School } from "../models/School.js";
import { Setting } from "../models/Setting.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { getUserSecondaryRoles } from "../utils/moduleAccessService.js";
import { recordAudit } from "../utils/audit.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";
import { compareBsDates, ensureValidBsDate } from "../utils/nepaliDate.js";
import { getInstitutionType, isCollege } from "../utils/institution.js";
import { getDefaultFiscalYearDates, getFiscalYearFromBsDate } from "../utils/fiscalYear.js";
import { filterOutOpeningTuitionCharges } from "../utils/accountingCalculations.js";
import {
  ensureDefaultChartOfAccounts,
  postFeeRefundJournal,
  postJournalEntry,
  reverseJournalEntryById
} from "../utils/journalPosting.js";
import { assertStudentLoginActive } from "../utils/studentLoginAccess.js";
import { nextVoucherNumberForDate } from "../utils/voucherNumbering.js";
import {
  aggregateJournalBalances,
  buildAccountLedger,
  buildBalanceSheet,
  buildCashFlowStatement,
  buildIncomeExpenditure,
  buildTrialBalanceReport,
  flattenBalanceSheet,
  flattenCashFlow,
  flattenIncomeExpenditure
} from "../utils/accountingReports.js";
import { recordCashEntry } from "../utils/accountingCashBook.js";
import { formatAddressLine } from "../utils/formatAddress.js";
import { collegeLogoExists, getCollegeLogoPath } from "../utils/collegeLogo.js";
import { resolveGovernmentDocumentHeader } from "../utils/schoolBranding.js";
import { withTransaction } from "../utils/transaction.js";
import {
  buildExactGoshwaraVoucherHtml,
  buildExactPdfDataFromJournal,
  buildPdfDataFromVoucherRecord,
  generateExactGoshwaraVoucherPDF
} from "../utils/templates/goshwaraVoucherTemplate.js";

export const listChartOfAccounts = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  await ensureDefaultChartOfAccounts(schoolId);
  const accounts = await ChartOfAccount.find({ schoolId }).sort({ code: 1 });
  return sendSuccess(res, "Chart of accounts fetched", accounts);
});

export const createChartOfAccount = asyncHandler(async (req: Request, res: Response) => {
  const payload = chartOfAccountSchema.parse(req.body);
  const schoolId = tenantObjectId(req);
  const existing = await ChartOfAccount.findOne({ schoolId, code: payload.code });
  if (existing) throw new ApiError(409, "Account code already exists");

  const account = await ChartOfAccount.create({ ...payload, schoolId, isSystem: false });
  await recordAudit(req, { action: "accounting.coa.create", entity: "ChartOfAccount", entityId: account._id.toString(), after: account });
  return sendSuccess(res, "Account created", account, 201);
});

export const updateChartOfAccount = asyncHandler(async (req: Request, res: Response) => {
  const payload = chartOfAccountSchema.partial().parse(req.body);
  const account = await ChartOfAccount.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!account) throw new ApiError(404, "Account not found");
  if (account.isSystem && payload.code) throw new ApiError(400, "Cannot change code of system account");

  const before = account.toObject();
  Object.assign(account, payload);
  await account.save();
  await recordAudit(req, { action: "accounting.coa.update", entity: "ChartOfAccount", entityId: account._id.toString(), before, after: account });
  return sendSuccess(res, "Account updated", account);
});

export const seedChartOfAccounts = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  await ensureDefaultChartOfAccounts(schoolId);
  const accounts = await ChartOfAccount.find({ schoolId }).sort({ code: 1 });
  return sendSuccess(res, "Default chart of accounts seeded", accounts);
});

export const listJournalEntries = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = { ...withTenantScope(req), isDeleted: false };
  if (typeof req.query.fiscalYearBs === "string") filter.fiscalYearBs = req.query.fiscalYearBs;
  if (typeof req.query.fromDateBs === "string") filter.dateBs = { $gte: req.query.fromDateBs };
  if (typeof req.query.toDateBs === "string") {
    const existing = (filter.dateBs as Record<string, string>) ?? {};
    filter.dateBs = { ...existing, $lte: req.query.toDateBs };
  }

  // The list used to hard-stop at 3000 with no signal that anything was missing, so a
  // school past that point silently lost its oldest vouchers from view. Paging is opt-in:
  // callers that send no page/limit keep the previous behaviour exactly, and the total is
  // always reported so truncation is visible rather than silent.
  const DEFAULT_LIMIT = 3000;
  const MAX_LIMIT = 5000;

  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(1, Math.trunc(requestedLimit)), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const requestedPage = Number(req.query.page);
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.trunc(requestedPage)) : 1;
  const skip = (page - 1) * limit;

  const [entries, total] = await Promise.all([
    JournalEntry.find(filter).sort({ dateBs: -1, createdAt: -1 }).skip(skip).limit(limit),
    JournalEntry.countDocuments(filter)
  ]);

  return sendSuccess(res, "Journal entries fetched", entries, 200, {
    page,
    limit,
    total,
    hasMore: skip + entries.length < total
  });
});

export const createJournalEntry = asyncHandler(async (req: Request, res: Response) => {
  const payload = journalEntrySchema.parse(req.body);
  ensureValidBsDate(payload.dateBs);
  const schoolId = tenantObjectId(req);

  const { assertFiscalPeriodOpen } = await import("../utils/fiscalYear.js");
  await assertFiscalPeriodOpen(schoolId, payload.dateBs);

  const entry = await postJournalEntry({
    schoolId,
    userId: req.user!.userId as unknown as import("mongoose").Types.ObjectId,
    dateBs: payload.dateBs,
    narration: payload.narration,
    lines: payload.lines,
    voucherType: payload.voucherType,
    referenceType: "Manual",
    studentId: payload.studentId,
    bankAccountId: payload.bankAccountId
  });

  await recordAudit(req, { action: "accounting.journal.create", entity: "JournalEntry", entityId: entry._id.toString(), after: entry });
  return sendSuccess(res, "Journal entry posted", entry, 201);
});

export const reverseJournalEntryHandler = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const userId = req.user!.userId as unknown as import("mongoose").Types.ObjectId;
  const entry = await JournalEntry.findOne({ _id: req.params.id, schoolId, isDeleted: false });
  if (!entry) throw new ApiError(404, "Journal entry not found");
  if (entry.isReversal) throw new ApiError(400, "Cannot reverse a reversal entry");
  if (entry.isReversed) throw new ApiError(400, "Journal entry has already been reversed");

  // Domain-linked entries must be reversed via fee/expense void APIs (cash + operational docs).
  // Goshwara vouchers are reversed here and soft-deleted with the journal.
  if (
    entry.referenceType &&
    entry.referenceType !== "Manual" &&
    entry.referenceType !== "GoshwaraVoucher" &&
    entry.referenceId
  ) {
    throw new ApiError(
      400,
      `This journal is linked to ${entry.referenceType}. Reverse it from that module (void/reverse transaction) so cash book and source documents stay in sync.`
    );
  }

  const { assertFiscalPeriodOpen } = await import("../utils/fiscalYear.js");
  await assertFiscalPeriodOpen(schoolId, entry.dateBs);

  const before = entry.toObject();
  await reverseJournalEntryById(schoolId, userId, entry._id);

  if (entry.referenceType === "GoshwaraVoucher" && entry.referenceId) {
    await GoshwaraVoucher.findOneAndUpdate(
      { _id: entry.referenceId, schoolId },
      { isDeleted: true }
    );
  } else {
    await GoshwaraVoucher.findOneAndUpdate(
      { journalEntryId: entry._id, schoolId },
      { isDeleted: true }
    );
  }

  const updated = await JournalEntry.findById(entry._id).lean();
  await recordAudit(req, {
    action: "accounting.journal.reverse",
    entity: "JournalEntry",
    entityId: entry._id.toString(),
    before,
    after: { isReversed: true, reversed: updated }
  });
  return sendSuccess(res, "Journal entry reversed");
});

const resolveOfficeName = async (schoolId: import("mongoose").Types.ObjectId): Promise<{
  /** College Name (Nepali) — Nepal Government header line, printed as "{name} कार्यालय" */
  collegeNameNp: string;
  /** College Address (Nepali) — Nepal Government header line under the college name */
  collegeAddressNp: string;
  schoolName: string;
  schoolNameNp?: string;
  principalName?: string;
  address?: string;
  logoDataUri: string;
}> => {
  const [school, settings] = await Promise.all([
    School.findById(schoolId).lean(),
    Setting.findOne({ schoolId }).lean()
  ]);
  if (!school) throw new ApiError(404, "School not found");

  /*
   * Nepal Government format documents carry Nepali text only — the English
   * name/address is never substituted here. Both values come from Institution
   * Settings (College Name (Nepali) / College Address (Nepali)); when unset the
   * voucher prints the paper form's blank dots instead.
   */
  const collegeNameNp = (settings?.schoolNameNp || school.nameNp || "").trim();
  const collegeAddressNp = (settings?.schoolAddressNp || "").trim();

  let logoDataUri = "";
  if (collegeLogoExists()) {
    try {
      const buf = fs.readFileSync(getCollegeLogoPath());
      logoDataUri = `data:image/png;base64,${buf.toString("base64")}`;
    } catch {
      logoDataUri = "";
    }
  }

  return {
    collegeNameNp,
    collegeAddressNp,
    schoolName: settings?.schoolName ?? school.name,
    schoolNameNp: settings?.schoolNameNp ?? school.nameNp,
    principalName: settings?.principalName ?? school.principalName,
    address: formatAddressLine(settings?.address ?? school.address),
    logoDataUri
  };
};

const sendGoshwaraPdfResponse = async (
  res: Response,
  pdfData: import("../utils/templates/goshwaraVoucherTemplate.js").ExactGoshwaraVoucherPdfData,
  schoolInfo: { name?: string; nameNp?: string; logo?: string },
  filename: string,
  format?: string
) => {
  if (String(format ?? "").toLowerCase() === "html") {
    const html = buildExactGoshwaraVoucherHtml(pdfData, schoolInfo);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${filename}.html"`);
    res.send(html);
    return;
  }

  try {
    const buffer = await generateExactGoshwaraVoucherPDF(pdfData, schoolInfo);
    if (!buffer?.length) {
      throw new ApiError(500, "PDF generation returned an empty document");
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}.pdf"`);
    res.setHeader("Content-Length", String(buffer.length));
    res.send(buffer);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const message =
      error instanceof Error ? error.message : "Failed to generate Goshwara PDF";
    console.error("[goshwara-pdf]", message, error);
    throw new ApiError(500, `Failed to generate PDF: ${message}`);
  }
};

/**
 * Download Goshwara Bhautchar (गोश्वारा भौचर / म.ले.प.का.नं. १०)
 * for a journal entry. Query: ?format=html for printable HTML, default PDF.
 */
export const downloadGoshwaraVoucher = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const entry = await JournalEntry.findOne({ _id: req.params.id, schoolId, isDeleted: false }).lean();
  if (!entry) throw new ApiError(404, "Journal entry not found");

  const branding = await resolveOfficeName(schoolId);
  const wantBlank = String(req.query.blank ?? "") === "1" || String(req.query.blank ?? "") === "true";

  // Prefer linked Goshwara voucher user-entered fields (no school autofill)
  const linkedVoucher = await GoshwaraVoucher.findOne({
    schoolId,
    journalEntryId: entry._id,
    isDeleted: false
  }).lean();

  const pdfData = wantBlank
    ? buildExactPdfDataFromJournal({
        entry: {
          voucherNumber: "",
          dateBs: "",
          narration: "",
          lines: [],
          totalDebitNpr: 0,
          totalCreditNpr: 0
        },
        blankForm: true
      })
    : linkedVoucher
      ? buildPdfDataFromVoucherRecord({
          voucherNo: linkedVoucher.voucherNo,
          dateBs: linkedVoucher.dateBs,
          particulars: linkedVoucher.particulars,
          // Nepal Government header — always the current Institution Settings values;
          // the voucher's stored header is only a fallback for older records.
          govOfficeName:
            branding.collegeNameNp ||
            linkedVoucher.govOfficeName ||
            linkedVoucher.instituteName ||
            "",
          addressLine: branding.collegeAddressNp || linkedVoucher.addressLine || "",
          printLines: linkedVoucher.printLines,
          lines: linkedVoucher.lines.map((l) => ({
            accountCode: l.accountCode,
            accountName: l.accountName,
            debitNpr: l.debitNpr ?? 0,
            creditNpr: l.creditNpr ?? 0,
            description: l.description
          })),
          totalAmount: linkedVoucher.totalAmount,
          totalDebitNpr: linkedVoucher.totalDebitNpr,
          totalCreditNpr: linkedVoucher.totalCreditNpr,
          receiptNo: linkedVoucher.receiptNo,
          receivedAmount: linkedVoucher.receivedAmount,
          presenterName: linkedVoucher.presenterName,
          presenterRank: linkedVoucher.presenterRank,
          chequeNo: linkedVoucher.chequeNo,
          chequeAmount: linkedVoucher.chequeAmount,
          chequePresenter: linkedVoucher.chequePresenter,
          chequeDate: linkedVoucher.chequeDate,
          chequeRank: linkedVoucher.chequeRank,
          amountInWords: linkedVoucher.amountInWords
        })
      : buildExactPdfDataFromJournal({
          entry: {
            voucherNumber: entry.voucherNumber,
            dateBs: entry.dateBs,
            narration: entry.narration,
            lines: entry.lines.map((line) => ({
              accountCode: line.accountCode,
              accountName: line.accountName,
              debitNpr: line.debitNpr ?? 0,
              creditNpr: line.creditNpr ?? 0,
              description: line.description ?? undefined
            })),
            totalDebitNpr: entry.totalDebitNpr,
            totalCreditNpr: entry.totalCreditNpr
          },
          // Nepal Government header from Institution Settings (Nepali only).
          // Only the printed copy is filled in — nothing is written back to the record.
          govOfficeName: branding.collegeNameNp,
          addressLine: branding.collegeAddressNp
        });

  const schoolInfo = {
    name: branding.schoolName,
    nameNp: branding.schoolNameNp,
    logo: branding.logoDataUri
  };

  await recordAudit(req, {
    action: "accounting.journal.goshwara_print",
    entity: "JournalEntry",
    entityId: entry._id.toString(),
    after: { voucherNumber: entry.voucherNumber, format: req.query.format ?? "pdf", blank: wantBlank }
  });

  const safeName = `goshwara-${(entry.voucherNumber || "blank").replace(/[^\w.-]+/g, "_")}`;
  await sendGoshwaraPdfResponse(res, pdfData, schoolInfo, safeName, String(req.query.format ?? ""));
});

/** List Goshwara voucher records */
export const listGoshwaraVouchers = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = { ...withTenantScope(req), isDeleted: false };
  if (typeof req.query.fiscalYearBs === "string") filter.fiscalYearBs = req.query.fiscalYearBs;
  const vouchers = await GoshwaraVoucher.find(filter).sort({ dateBs: -1, createdAt: -1 }).limit(500);
  return sendSuccess(res, "Goshwara vouchers fetched", vouchers);
});

/** Completely blank paper-style Goshwara form (no autofill) */
export const downloadBlankGoshwaraForm = asyncHandler(async (_req: Request, res: Response) => {
  await sendGoshwaraPdfResponse(res, { blankForm: true }, {}, "goshwara-blank", String(_req.query.format ?? ""));
});

/**
 * Create Goshwara voucher + balanced journal entry (atomic when replica set available).
 * Every field is user-supplied except the Nepal Government document header
 * (नेपाल सरकार / College Name (Nepali) कार्यालय / College Address (Nepali)),
 * which always comes from Institution Settings.
 */
export const createGoshwaraVoucher = asyncHandler(async (req: Request, res: Response) => {
  const payload = goshwaraVoucherSchema.parse(req.body);
  ensureValidBsDate(payload.dateBs);
  const schoolId = tenantObjectId(req);
  const userId = req.user!.userId as unknown as import("mongoose").Types.ObjectId;

  const { assertFiscalPeriodOpen } = await import("../utils/fiscalYear.js");
  await assertFiscalPeriodOpen(schoolId, payload.dateBs);
  await ensureDefaultChartOfAccounts(schoolId);

  /*
   * Nepal Government header is never typed per voucher — it is the institution's
   * Nepali identity. Stored on the record so the list view and any reprint show
   * the same header, with the submitted values kept only as a fallback.
   */
  const govHeader = await resolveGovernmentDocumentHeader(schoolId);
  const govOfficeName =
    govHeader.collegeNameNp ||
    (payload.govOfficeName || "").trim() ||
    (payload.instituteName || "").trim();
  const addressLine = govHeader.collegeAddressNp || (payload.addressLine || "").trim();
  const manualVoucherNo = (payload.voucherNo || "").trim();

  // Resolve account names from COA when missing
  const codes = [...new Set(payload.lines.map((l) => l.accountCode))];
  const accounts = await ChartOfAccount.find({ schoolId, code: { $in: codes } }).lean();
  const nameByCode = new Map(accounts.map((a) => [a.code, a.name]));

  const lines = payload.lines.map((line) => ({
    accountCode: line.accountCode,
    accountName: line.accountName || nameByCode.get(line.accountCode) || line.accountCode,
    debitNpr: line.debitNpr ?? 0,
    creditNpr: line.creditNpr ?? 0,
    // Per-line particular (reason) — required for PDF विवरण column
    description: (line.description || "").trim() || payload.particulars
  }));

  const totalDebitNpr = lines.reduce((s, l) => s + l.debitNpr, 0);
  const totalCreditNpr = lines.reduce((s, l) => s + l.creditNpr, 0);

  const rawPrint = (payload.printLines ?? []).map((l) => ({
    sn: (l.sn || "").trim(),
    particulars: (l.particulars || "").trim(),
    account: (l.account || "").trim(),
    ledgerNo: (l.ledgerNo || "").trim(),
    debit: l.debit && l.debit > 0 ? l.debit : undefined,
    credit: l.credit && l.credit > 0 ? l.credit : undefined
  }));

  // Always persist print lines with per-line विवरण (from print form or journal description)
  const printLines =
    rawPrint.length > 0
      ? rawPrint.map((pl, i) => ({
          ...pl,
          sn: pl.sn || String(i + 1),
          particulars: pl.particulars || lines[i]?.description || payload.particulars,
          account: pl.account || lines[i]?.accountName || "",
          ledgerNo: pl.ledgerNo || lines[i]?.accountCode || "",
          debit: pl.debit ?? (lines[i] && lines[i]!.debitNpr > 0 ? lines[i]!.debitNpr : undefined),
          credit: pl.credit ?? (lines[i] && lines[i]!.creditNpr > 0 ? lines[i]!.creditNpr : undefined)
        }))
      : lines.map((l, i) => ({
          sn: String(i + 1),
          particulars: l.description,
          account: l.accountName,
          ledgerNo: l.accountCode,
          debit: l.debitNpr > 0 ? l.debitNpr : undefined,
          credit: l.creditNpr > 0 ? l.creditNpr : undefined
        }));

  try {
    const result = await withTransaction(async (session) => {
      const journal = await postJournalEntry({
        schoolId,
        userId,
        dateBs: payload.dateBs,
        narration: payload.particulars,
        lines,
        voucherType: payload.voucherType,
        voucherNumber: manualVoucherNo || undefined,
        referenceType: "GoshwaraVoucher",
        session
      });

      const settingsQuery = AccountingSettings.findOne({ schoolId });
      if (session) settingsQuery.session(session);
      const settings = await settingsQuery.lean();
      const fiscalYearBs = getFiscalYearFromBsDate(payload.dateBs, settings?.currentFiscalYearBs);

      const created = await GoshwaraVoucher.create(
        [
          {
            schoolId,
            voucherNo: journal.voucherNumber,
            voucherType: payload.voucherType ?? "JOURNAL",
            dateBs: payload.dateBs,
            fiscalYearBs,
            particulars: payload.particulars,
            govOfficeName,
            addressLine,
            officeName: govOfficeName,
            printLines,
            receiptNo: (payload.receiptNo || "").trim(),
            receivedAmount: (payload.receivedAmount || "").trim(),
            presenterName: (payload.presenterName || "").trim(),
            presenterRank: (payload.presenterRank || "").trim(),
            chequeNo: (payload.chequeNo || "").trim(),
            chequeAmount: (payload.chequeAmount || "").trim(),
            chequePresenter: (payload.chequePresenter || "").trim(),
            chequeDate: (payload.chequeDate || "").trim(),
            chequeRank: (payload.chequeRank || "").trim(),
            amountInWords: (payload.amountInWords || "").trim(),
            lines,
            totalAmount: totalDebitNpr,
            totalDebitNpr,
            totalCreditNpr,
            journalEntryId: journal._id,
            createdBy: userId
          }
        ],
        session ? { session } : undefined
      );
      const voucher = created[0];
      if (!voucher) {
        throw new ApiError(500, "Failed to create Goshwara voucher");
      }

      journal.referenceId = voucher._id;
      await journal.save(session ? { session } : undefined);

      return { voucher, journal };
    });

    await recordAudit(req, {
      action: "accounting.goshwara.create",
      entity: "GoshwaraVoucher",
      entityId: result.voucher._id.toString(),
      after: { voucher: result.voucher, journalEntryId: result.journal._id.toString() }
    });

    return sendSuccess(
      res,
      "Goshwara voucher created",
      { voucher: result.voucher, journalEntry: result.journal },
      201
    );
  } catch (error) {
    if (error instanceof Error && /already exists/i.test(error.message)) {
      throw new ApiError(409, error.message);
    }
    throw error;
  }
});

/**
 * Delete (soft) a Goshwara voucher and reverse its linked journal entry.
 * Super Admin / College Admin only (route uses admins + reverse_transaction).
 */
export const deleteGoshwaraVoucher = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const userId = req.user!.userId as unknown as import("mongoose").Types.ObjectId;

  const voucher = await GoshwaraVoucher.findOne({
    _id: req.params.id,
    schoolId,
    isDeleted: false
  });
  if (!voucher) throw new ApiError(404, "Goshwara voucher not found");

  const before = voucher.toObject();
  const journal = await JournalEntry.findOne({
    _id: voucher.journalEntryId,
    schoolId,
    isDeleted: false
  });

  if (journal && !journal.isReversal && !journal.isReversed) {
    const { assertFiscalPeriodOpen } = await import("../utils/fiscalYear.js");
    await assertFiscalPeriodOpen(schoolId, journal.dateBs);
    await reverseJournalEntryById(schoolId, userId, journal._id);
  }

  voucher.isDeleted = true;
  await voucher.save();

  await recordAudit(req, {
    action: "accounting.goshwara.delete",
    entity: "GoshwaraVoucher",
    entityId: voucher._id.toString(),
    before,
    after: { isDeleted: true, journalEntryId: voucher.journalEntryId?.toString() }
  });

  return sendSuccess(res, "Goshwara voucher deleted");
});

/** Print Goshwara voucher PDF by voucher id */
export const downloadGoshwaraVoucherById = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const voucher = await GoshwaraVoucher.findOne({
    _id: req.params.id,
    schoolId,
    isDeleted: false
  }).lean();
  if (!voucher) throw new ApiError(404, "Goshwara voucher not found");

  const branding = await resolveOfficeName(schoolId);
  const wantBlank = String(req.query.blank ?? "") === "1" || String(req.query.blank ?? "") === "true";

  const pdfData = wantBlank
    ? { blankForm: true as const }
    : buildPdfDataFromVoucherRecord({
        voucherNo: voucher.voucherNo,
        dateBs: voucher.dateBs,
        particulars: voucher.particulars,
        // Nepal Government header — always the current Institution Settings values;
        // the voucher's stored header is only a fallback for older records.
        govOfficeName:
          branding.collegeNameNp || voucher.govOfficeName || voucher.instituteName || "",
        addressLine: branding.collegeAddressNp || voucher.addressLine || "",
        printLines: voucher.printLines,
        lines: voucher.lines.map((l) => ({
          accountCode: l.accountCode,
          accountName: l.accountName,
          debitNpr: l.debitNpr ?? 0,
          creditNpr: l.creditNpr ?? 0,
          description: l.description
        })),
        totalAmount: voucher.totalAmount,
        totalDebitNpr: voucher.totalDebitNpr,
        totalCreditNpr: voucher.totalCreditNpr,
        receiptNo: voucher.receiptNo,
        receivedAmount: voucher.receivedAmount,
        presenterName: voucher.presenterName,
        presenterRank: voucher.presenterRank,
        chequeNo: voucher.chequeNo,
        chequeAmount: voucher.chequeAmount,
        chequePresenter: voucher.chequePresenter,
        chequeDate: voucher.chequeDate,
        chequeRank: voucher.chequeRank,
        amountInWords: voucher.amountInWords
      });

  const schoolInfo = {
    name: branding.schoolName,
    nameNp: branding.schoolNameNp,
    logo: branding.logoDataUri
  };

  await recordAudit(req, {
    action: "accounting.goshwara.print",
    entity: "GoshwaraVoucher",
    entityId: voucher._id.toString(),
    after: { voucherNo: voucher.voucherNo, format: req.query.format ?? "pdf" }
  });

  const safeName = `goshwara-${voucher.voucherNo.replace(/[^\w.-]+/g, "_")}`;
  await sendGoshwaraPdfResponse(res, pdfData, schoolInfo, safeName, String(req.query.format ?? ""));
});

export const listVendors = asyncHandler(async (req: Request, res: Response) => {
  const vendors = await Vendor.find(withTenantScope(req, { isDeleted: false })).sort({ name: 1 });
  return sendSuccess(res, "Vendors fetched", vendors);
});

export const createVendor = asyncHandler(async (req: Request, res: Response) => {
  const payload = vendorSchema.parse(req.body);
  const vendor = await Vendor.create({ ...payload, schoolId: tenantObjectId(req) });
  await recordAudit(req, { action: "accounting.vendor.create", entity: "Vendor", entityId: vendor._id.toString(), after: vendor });
  return sendSuccess(res, "Vendor created", vendor, 201);
});

export const updateVendor = asyncHandler(async (req: Request, res: Response) => {
  const payload = vendorSchema.partial().parse(req.body);
  const before = await Vendor.findOne(withTenantScope(req, { _id: req.params.id, isDeleted: false }));
  if (!before) throw new ApiError(404, "Vendor not found");

  const vendor = await Vendor.findOneAndUpdate(withTenantScope(req, { _id: req.params.id }), payload, { new: true });
  await recordAudit(req, { action: "accounting.vendor.update", entity: "Vendor", entityId: String(req.params.id), before, after: vendor });
  return sendSuccess(res, "Vendor updated", vendor);
});

const refundActorRoles = async (req: {
  user?: { userId: string; role: string };
}): Promise<string[]> => {
  const roles = [normalizeUserRole(req.user?.role ?? "")];
  if (req.user?.userId) {
    const secondary = await getUserSecondaryRoles(req.user.userId);
    roles.push(...secondary.map((r) => normalizeUserRole(r)));
  }
  return [...new Set(roles.filter(Boolean))];
};

const resolveRefundStatus = (
  refund: {
    status?: string | null;
    journalEntryId?: unknown;
    collegeAdminApprovedBy?: unknown;
    superAdminApprovedBy?: unknown;
  }
): "PENDING_APPROVAL" | "APPROVED" | "REJECTED" => {
  if (refund.status === "APPROVED" || refund.status === "REJECTED" || refund.status === "PENDING_APPROVAL") {
    return refund.status;
  }
  if (refund.journalEntryId) return "APPROVED";
  if (refund.collegeAdminApprovedBy && refund.superAdminApprovedBy) return "APPROVED";
  return "APPROVED";
};

const formatFeeRefund = (refund: Record<string, unknown>) => {
  const status = resolveRefundStatus(refund);
  const collegeAdminApproved =
    status === "APPROVED" || Boolean(refund.collegeAdminApprovedBy);
  const superAdminApproved =
    status === "APPROVED" || Boolean(refund.superAdminApprovedBy);
  return {
    ...refund,
    status,
    collegeAdminApproved,
    superAdminApproved,
    fullyApproved: status === "APPROVED"
  };
};

const pendingDepositRefundTotal = async (
  schoolId: ReturnType<typeof tenantObjectId>,
  studentId: string
): Promise<number> => {
  const pending = await FeeRefund.find({
    schoolId,
    studentId,
    isDeleted: false,
    refundType: "DEPOSIT_REFUND",
    status: "PENDING_APPROVAL"
  })
    .select("amountNpr")
    .lean();
  return pending.reduce((sum, row) => sum + Number(row.amountNpr || 0), 0);
};

const applyApprovedFeeRefund = async (
  req: Request,
  refund: InstanceType<typeof FeeRefund>
): Promise<void> => {
  if (refund.journalEntryId) return;

  const schoolId = tenantObjectId(req);
  const refundType = refund.refundType || "OTHER";
  const amountNpr = Number(refund.amountNpr) || 0;
  const studentId = String(refund.studentId);

  if (refundType === "DEPOSIT_REFUND") {
    const student = await Student.findOne({ _id: studentId, schoolId });
    if (!student) throw new ApiError(404, "Student not found");
    if (student.securityDepositWaived) {
      throw new ApiError(400, "Security deposit was not taken / cancelled for this student");
    }
    const held = Math.max(0, Number(student.securityDepositNpr) || 0);
    const alreadyRefunded = Math.max(0, Number(student.securityDepositRefundedNpr) || 0);
    const remaining = Math.max(0, held - alreadyRefunded);
    if (held <= 0 || remaining <= 0 || amountNpr > remaining + 0.001) {
      throw new ApiError(400, "Refund amount exceeds remaining deposit");
    }
    student.securityDepositRefundedNpr = alreadyRefunded + amountNpr;
    await student.save();
  }

  await postFeeRefundJournal({
    schoolId,
    userId: req.user!.userId as unknown as import("mongoose").Types.ObjectId,
    refundId: refund._id,
    studentId,
    dateBs: refund.dateBs,
    amountNpr,
    paymentMethod: refund.paymentMethod,
    bankAccountId: refund.bankAccountId ?? undefined,
    refundNumber: refund.refundNumber,
    isDepositRefund: refundType === "DEPOSIT_REFUND"
  });

  const journal = await JournalEntry.findOne({
    schoolId,
    referenceType: "FeeRefund",
    referenceId: refund._id
  }).sort({ createdAt: -1 });
  if (journal) {
    refund.journalEntryId = journal._id as unknown as typeof refund.journalEntryId;
  }

  await recordCashEntry(req, {
    dateBs: refund.dateBs,
    entryType: "DEBIT",
    category:
      refundType === "DEPOSIT_REFUND" ? "Security Deposit Refund" : "Fee Refund",
    description: `${refundType === "DEPOSIT_REFUND" ? "Deposit refund" : "Refund"} ${refund.refundNumber}`,
    amountNpr,
    paymentMethod: refund.paymentMethod,
    referenceType: "FeeRefund",
    referenceId: refund._id.toString()
  });
};

export const listFeeRefunds = asyncHandler(async (req: Request, res: Response) => {
  const refunds = await FeeRefund.find(withTenantScope(req, { isDeleted: false }))
    .populate({ path: "studentId", populate: { path: "user", select: "-password" } })
    .sort({ dateBs: -1 })
    .lean();
  return sendSuccess(
    res,
    "Fee refunds fetched",
    refunds.map((r) => formatFeeRefund(r as Record<string, unknown>))
  );
});

export const createFeeRefund = asyncHandler(async (req: Request, res: Response) => {
  const payload = feeRefundSchema.parse(req.body);
  ensureValidBsDate(payload.dateBs);
  const schoolId = tenantObjectId(req);
  const { assertFiscalPeriodOpen } = await import("../utils/fiscalYear.js");
  await assertFiscalPeriodOpen(schoolId, payload.dateBs);

  const student = await Student.findOne({ _id: payload.studentId, schoolId });
  if (!student) throw new ApiError(404, "Student not found");
  await assertStudentLoginActive(payload.studentId, schoolId, "recording fee refunds");

  const refundType = payload.refundType ?? "OTHER";
  const amountNpr = payload.amountNpr;

  if (refundType === "DEPOSIT_REFUND") {
    if (student.securityDepositWaived) {
      throw new ApiError(
        400,
        "Security deposit was not taken / cancelled for this student. No deposit refund is due."
      );
    }

    const held = Math.max(0, Number(student.securityDepositNpr) || 0);
    const alreadyRefunded = Math.max(0, Number(student.securityDepositRefundedNpr) || 0);
    const pendingAmt = await pendingDepositRefundTotal(schoolId, payload.studentId);
    const remaining = Math.max(0, held - alreadyRefunded - pendingAmt);

    if (held <= 0 || remaining <= 0) {
      throw new ApiError(
        400,
        "No security deposit has been recorded for this student. Record the deposit under Student Fee Records → Record payment first, then process the refund."
      );
    }
    if (amountNpr > remaining + 0.001) {
      throw new ApiError(
        400,
        `Refund amount exceeds remaining deposit. Held ${held}, already refunded ${alreadyRefunded}, remaining ${remaining}.`
      );
    }
  }

  const refundNumber = await nextVoucherNumberForDate({
    schoolId,
    prefix: "RFND",
    dateBs: payload.dateBs
  });

  const refund = await FeeRefund.create({
    schoolId,
    studentId: payload.studentId,
    feeCollectionId: payload.feeCollectionId,
    refundNumber,
    refundType,
    amountNpr,
    dateBs: payload.dateBs,
    reason: payload.reason,
    paymentMethod: payload.paymentMethod,
    bankAccountId: payload.bankAccountId,
    transactionNumber: payload.transactionNumber ?? "",
    notes: payload.notes ?? "",
    approvedBy: payload.approvedBy?.trim() || "",
    attachments: payload.attachments ?? [],
    createdBy: req.user!.userId,
    status: "PENDING_APPROVAL",
    submittedAt: new Date(),
    submittedBy: req.user!.userId
  });

  await recordAudit(req, {
    action: "accounting.refund.submit",
    entity: "FeeRefund",
    entityId: refund._id.toString(),
    after: refund
  });
  return sendSuccess(
    res,
    "Refund submitted",
    formatFeeRefund(refund.toObject() as Record<string, unknown>),
    201
  );
});

export const approveFeeRefund = asyncHandler(async (req: Request, res: Response) => {
  const roles = await refundActorRoles(req);
  const asSuper = roles.includes("SUPER_ADMIN");
  const asCollege = roles.includes("COLLEGE_ADMIN") || (isInstitutionAdmin(roles[0] ?? "") && !asSuper);
  if (!asSuper && !asCollege) {
    throw new ApiError(403, "Only Super Admin or College Admin can approve");
  }

  const schoolId = tenantObjectId(req);
  const refund = await FeeRefund.findOne({
    _id: req.params.id,
    schoolId,
    isDeleted: false
  });
  if (!refund) throw new ApiError(404, "Refund not found");

  const current = resolveRefundStatus(refund);
  if (current === "REJECTED") {
    throw new ApiError(400, "Rejected refund cannot be approved");
  }
  if (current === "APPROVED") {
    return sendSuccess(res, "Refund already approved", formatFeeRefund(refund.toObject() as Record<string, unknown>));
  }

  const userId = req.user!.userId as unknown as typeof refund.collegeAdminApprovedBy;
  const now = new Date();
  if (asCollege) {
    refund.collegeAdminApprovedAt = now;
    refund.collegeAdminApprovedBy = userId;
  }
  if (asSuper) {
    refund.superAdminApprovedAt = now;
    refund.superAdminApprovedBy = userId;
  }

  if (refund.collegeAdminApprovedBy && refund.superAdminApprovedBy) {
    await applyApprovedFeeRefund(req, refund);
    refund.status = "APPROVED";
  } else {
    refund.status = "PENDING_APPROVAL";
  }
  await refund.save();

  await recordAudit(req, {
    action: "accounting.refund.approve",
    entity: "FeeRefund",
    entityId: refund._id.toString(),
    after: { collegeAdmin: asCollege, superAdmin: asSuper, status: refund.status }
  });

  return sendSuccess(
    res,
    "Refund approved",
    formatFeeRefund(refund.toObject() as Record<string, unknown>)
  );
});

export const rejectFeeRefund = asyncHandler(async (req: Request, res: Response) => {
  const roles = await refundActorRoles(req);
  if (!roles.includes("SUPER_ADMIN") && !roles.includes("COLLEGE_ADMIN") && !roles.some((r) => isInstitutionAdmin(r))) {
    throw new ApiError(403, "Only Super Admin or College Admin can reject");
  }

  const schoolId = tenantObjectId(req);
  const refund = await FeeRefund.findOne({
    _id: req.params.id,
    schoolId,
    isDeleted: false
  });
  if (!refund) throw new ApiError(404, "Refund not found");
  if (resolveRefundStatus(refund) === "APPROVED") {
    throw new ApiError(400, "Approved refund cannot be rejected");
  }

  refund.status = "REJECTED";
  refund.rejectedAt = new Date();
  refund.rejectedBy = req.user!.userId as unknown as typeof refund.rejectedBy;
  refund.collegeAdminApprovedAt = undefined;
  refund.collegeAdminApprovedBy = undefined;
  refund.superAdminApprovedAt = undefined;
  refund.superAdminApprovedBy = undefined;
  await refund.save();

  await recordAudit(req, {
    action: "accounting.refund.reject",
    entity: "FeeRefund",
    entityId: refund._id.toString()
  });

  return sendSuccess(
    res,
    "Refund rejected",
    formatFeeRefund(refund.toObject() as Record<string, unknown>)
  );
});

export const listFiscalYears = asyncHandler(async (req: Request, res: Response) => {
  const years = await FiscalYear.find(withTenantScope(req)).sort({ yearBs: -1 });
  return sendSuccess(res, "Fiscal years fetched", years);
});

export const createFiscalYear = asyncHandler(async (req: Request, res: Response) => {
  const payload = fiscalYearSchema.parse(req.body);
  const schoolId = tenantObjectId(req);

  if (payload.isCurrent) {
    await FiscalYear.updateMany({ schoolId }, { isCurrent: false });
    await AccountingSettings.findOneAndUpdate({ schoolId }, { currentFiscalYearBs: payload.yearBs }, { upsert: true });
  }

  const year = await FiscalYear.create({ ...payload, schoolId });
  await recordAudit(req, { action: "accounting.fiscal.create", entity: "FiscalYear", entityId: year._id.toString(), after: year });
  return sendSuccess(res, "Fiscal year created", year, 201);
});

export const closeFiscalYear = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const year = await FiscalYear.findOne({ _id: req.params.id, schoolId });
  if (!year) throw new ApiError(404, "Fiscal year not found");
  if (year.isClosed) throw new ApiError(400, "Fiscal year is already closed");

  const before = year.toObject();
  const userId = req.user!.userId as unknown as import("mongoose").Types.ObjectId;

  // Post the closing voucher BEFORE the audit lock lands on this year's end date —
  // afterwards nothing can be posted into the period any more.
  const { postYearEndClosingEntry } = await import("../utils/fiscalYearClosing.js");
  const closing = await postYearEndClosingEntry({
    schoolId,
    userId,
    fiscalYearBs: year.yearBs,
    dateBs: year.endDateBs
  });

  year.isClosed = true;
  year.closedAt = new Date();
  year.closedBy = userId;
  if (closing.journalEntryId) year.closingEntryId = closing.journalEntryId;
  if (closing.posted) year.closingSurplusNpr = closing.netSurplusNpr;
  await year.save();

  // Only ever advance the audit lock. Closing an older year after a newer one used to move
  // the lock backwards, silently reopening a period that had already been locked down.
  const settings = await AccountingSettings.findOne({ schoolId }).lean();
  const currentLock = settings?.auditLockDateBs;
  if (!currentLock || compareBsDates(year.endDateBs, currentLock) > 0) {
    await AccountingSettings.findOneAndUpdate({ schoolId }, { auditLockDateBs: year.endDateBs }, { upsert: true });
  }

  await recordAudit(req, {
    action: "accounting.fiscal.close",
    entity: "FiscalYear",
    entityId: year._id.toString(),
    before,
    after: { ...year.toObject(), closingEntryPosted: closing.posted, netSurplusNpr: closing.netSurplusNpr }
  });

  return sendSuccess(
    res,
    closing.posted
      ? `Fiscal year closed. Surplus/(deficit) of NPR ${closing.netSurplusNpr.toFixed(2)} transferred to Accumulated Fund and audit lock applied.`
      : `Fiscal year closed and audit lock applied. ${closing.reason ?? ""}`.trim(),
    { ...year.toObject(), closing }
  );
});

export const verifyReceipt = asyncHandler(async (req: Request, res: Response) => {
  const { receiptNumber, verificationCode } = req.query as { receiptNumber?: string; verificationCode?: string };
  if (!receiptNumber || !verificationCode) throw new ApiError(400, "Receipt number and verification code are required");

  const collection = await FeeCollection.findOne({
    schoolId: tenantObjectId(req),
    receiptNumber,
    verificationCode: verificationCode.toUpperCase(),
    isDeleted: false
  }).populate({ path: "studentId", populate: { path: "user", select: "fullName" } });

  if (!collection) {
    return sendSuccess(res, "Receipt verification failed", { valid: false });
  }

  return sendSuccess(res, "Receipt verified", {
    valid: true,
    receiptNumber: collection.receiptNumber,
    paidDateBs: collection.paidDateBs,
    amountPaidNpr: collection.amountPaidNpr,
    studentName: (collection.studentId as { user?: { fullName?: string } })?.user?.fullName
  });
});

export const generateLedgerReport = asyncHandler(async (req: Request, res: Response) => {
  const reportType = req.params.reportType as AccountingReportType;
  const schoolId = tenantObjectId(req);
  const fiscalYearBs = typeof req.query.fiscalYearBs === "string" ? req.query.fiscalYearBs : undefined;
  const fromDateBs = typeof req.query.fromDateBs === "string" ? req.query.fromDateBs : undefined;
  const toDateBs = typeof req.query.toDateBs === "string" ? req.query.toDateBs : undefined;
  const accountCode = typeof req.query.accountCode === "string" ? req.query.accountCode : undefined;
  const batchId = typeof req.query.batchId === "string" ? req.query.batchId : undefined;

  switch (reportType) {
    case "trial-balance": {
      // Pre-closing trial balance: closing vouchers would zero the income/expense columns.
      const balances = await aggregateJournalBalances(schoolId, {
        fiscalYearBs,
        fromDateBs,
        toDateBs,
        excludeClosingEntries: true
      });
      const trialBalance = buildTrialBalanceReport(balances);
      return sendSuccess(res, "Trial balance generated", {
        reportType,
        data: trialBalance.rows,
        summary: {
          totalDebitNpr: trialBalance.totalDebitNpr,
          totalCreditNpr: trialBalance.totalCreditNpr,
          differenceNpr: trialBalance.differenceNpr,
          isBalanced: trialBalance.isBalanced
        }
      });
    }
    case "balance-sheet": {
      // A balance sheet is a position *as at* a date, so it is cumulative over all history
      // up to `toDateBs`. Scoping it to one fiscal year would drop every prior year's
      // assets and liabilities and could never balance. Closing vouchers are included so
      // closed years report their surplus inside Accumulated Fund instead of twice.
      const balances = await aggregateJournalBalances(schoolId, { toDateBs });
      const sheet = buildBalanceSheet(balances);
      return sendSuccess(res, "Balance sheet generated", {
        reportType,
        data: flattenBalanceSheet(sheet),
        summary: {
          totalAssetsNpr: sheet.totalAssetsNpr,
          totalLiabilitiesNpr: sheet.totalLiabilitiesNpr,
          totalEquityNpr: sheet.totalEquityNpr,
          netSurplusNpr: sheet.netSurplusNpr,
          differenceNpr: sheet.differenceNpr,
          isBalanced: sheet.isBalanced
        }
      });
    }
    case "income-expenditure": {
      const balances = await aggregateJournalBalances(schoolId, {
        fiscalYearBs,
        fromDateBs,
        toDateBs,
        excludeClosingEntries: true
      });
      const statement = buildIncomeExpenditure(balances);
      return sendSuccess(res, "Income & expenditure generated", {
        reportType,
        data: flattenIncomeExpenditure(statement),
        summary: {
          totalIncomeNpr: statement.totalIncomeNpr,
          totalExpenseNpr: statement.totalExpenseNpr,
          netSurplusNpr: statement.netSurplusNpr
        }
      });
    }
    case "bank-book": {
      const data = await buildAccountLedger(schoolId, "1101", { fromDateBs, toDateBs });
      return sendSuccess(res, "Bank book generated", { reportType, data });
    }
    case "day-book": {
      const filter: Record<string, unknown> = { schoolId, isDeleted: false };
      if (fromDateBs || toDateBs) {
        filter.dateBs = {};
        if (fromDateBs) (filter.dateBs as Record<string, string>).$gte = fromDateBs;
        if (toDateBs) (filter.dateBs as Record<string, string>).$lte = toDateBs;
      }
      const data = await JournalEntry.find(filter).sort({ dateBs: 1, createdAt: 1 }).limit(500);
      return sendSuccess(res, "Day book generated", { reportType, data });
    }
    case "student-ledger":
    case "student-due": {
      const institutionType = await getInstitutionType(req);
      const college = isCollege(institutionType);
      const studentFilter: Record<string, unknown> = { schoolId };
      if (batchId) studentFilter.batchId = batchId;

      const [students, collections, refunds, batches, years, classes, sections] = await Promise.all([
        Student.find(studentFilter).populate("user", "-password").sort({ rollNumber: 1 }).lean(),
        FeeCollection.find({ schoolId, isDeleted: false }).lean(),
        FeeRefund.find({
          schoolId,
          isDeleted: false,
          status: { $nin: ["PENDING_APPROVAL", "REJECTED"] }
        }).lean(),
        college ? Batch.find({ schoolId }).lean() : [],
        college ? Year.find({ schoolId }).lean() : [],
        college ? [] : SchoolClass.find({ schoolId }).lean(),
        college ? [] : Section.find({ schoolId }).lean()
      ]);

      const primaryMap = new Map((college ? batches : classes).map((g) => [g._id.toString(), g.name]));
      const secondaryMap = new Map((college ? years : sections).map((g) => [g._id.toString(), g.name]));

      const data = students.map((student) => {
        const studentCollections = collections.filter((c) => c.studentId.toString() === student._id.toString());
        const studentRefunds = refunds.filter((r) => r.studentId.toString() === student._id.toString());
        const totalPaid = studentCollections.reduce((sum, c) => sum + c.amountPaidNpr, 0);
        const totalDiscount = studentCollections.reduce((sum, c) => sum + (c.discountNpr ?? 0), 0);
        const totalScholarship = studentCollections.reduce((sum, c) => sum + (c.scholarshipNpr ?? 0), 0);
        const totalFine = studentCollections.reduce((sum, c) => sum + (c.lateFeeNpr ?? 0), 0);
        const totalRefunds = studentRefunds.reduce((sum, r) => sum + r.amountNpr, 0);
        const advanceBalance = studentCollections.reduce((sum, c) => sum + (c.advancePaymentNpr ?? 0), 0);

        const primaryId = college ? student.batchId?.toString() : student.classId?.toString();
        const secondaryId = college ? student.yearId?.toString() : student.sectionId?.toString();

        return {
          studentId: student._id.toString(),
          admissionNumber: student.admissionNumber,
          rollNumber: student.rollNumber,
          fullName: (student.user as { fullName?: string })?.fullName ?? "",
          batchName: primaryId ? (primaryMap.get(primaryId) ?? "") : "",
          yearName: secondaryId ? (secondaryMap.get(secondaryId) ?? "") : "",
          guardianName: student.guardianName,
          scholarshipStatus: totalScholarship > 0 ? "Scholarship Applied" : "None",
          status: "Active",
          totalPayableNpr: totalPaid + (student.feesDueNpr ?? 0) + totalDiscount + totalScholarship,
          totalPaidNpr: totalPaid,
          outstandingBalanceNpr: student.feesDueNpr ?? 0,
          totalDiscountNpr: totalDiscount,
          totalScholarshipNpr: totalScholarship,
          totalFineNpr: totalFine,
          advanceBalanceNpr: advanceBalance,
          totalRefundsNpr: totalRefunds,
          collections:
            reportType === "student-ledger"
              ? filterOutOpeningTuitionCharges(
                  studentCollections as unknown as Array<Record<string, unknown>>
                )
              : undefined
        };
      });

      const filtered = reportType === "student-due" ? data.filter((s) => s.outstandingBalanceNpr > 0) : data;
      return sendSuccess(res, "Student ledger generated", { reportType, data: filtered });
    }
    case "scholarship-report": {
      const filter: Record<string, unknown> = { schoolId, scholarshipNpr: { $gt: 0 }, isDeleted: false };
      if (fromDateBs || toDateBs) {
        filter.paidDateBs = {};
        if (fromDateBs) (filter.paidDateBs as Record<string, string>).$gte = fromDateBs;
        if (toDateBs) (filter.paidDateBs as Record<string, string>).$lte = toDateBs;
      }
      const data = await FeeCollection.find(filter)
        .populate({ path: "studentId", populate: { path: "user", select: "-password" } })
        .sort({ paidDateBs: -1 })
        .lean();
      return sendSuccess(res, "Scholarship report generated", { reportType, data });
    }
    case "fee-collection-summary": {
      const filter: Record<string, unknown> = { schoolId, isDeleted: false };
      if (fromDateBs || toDateBs) {
        filter.paidDateBs = {};
        if (fromDateBs) (filter.paidDateBs as Record<string, string>).$gte = fromDateBs;
        if (toDateBs) (filter.paidDateBs as Record<string, string>).$lte = toDateBs;
      }
      const collections = await FeeCollection.find(filter).lean();
      const byFeeType = collections.reduce<Record<string, { count: number; totalNpr: number }>>((acc, c) => {
        for (const item of c.feeBreakdown ?? [{ feeType: "OTHER", amountNpr: c.amountPaidNpr }]) {
          const key = item.feeType ?? "OTHER";
          acc[key] = acc[key] ?? { count: 0, totalNpr: 0 };
          acc[key].count += 1;
          acc[key].totalNpr += item.amountNpr;
        }
        return acc;
      }, {});
      const data = Object.entries(byFeeType).map(([feeType, stats]) => ({ feeType, ...stats }));
      return sendSuccess(res, "Fee collection summary generated", { reportType, data });
    }
    case "vendor-ledger": {
      const vendorName = typeof req.query.vendor === "string" ? req.query.vendor : undefined;
      const [expenses, purchases] = await Promise.all([
        AccountingExpense.find({
          schoolId,
          isDeleted: false,
          ...(vendorName ? { vendor: vendorName } : {})
        })
          .sort({ dateBs: -1 })
          .lean(),
        AccountingPurchase.find({
          schoolId,
          isDeleted: false,
          ...(vendorName ? { vendor: vendorName } : {})
        })
          .sort({ purchaseDateBs: -1 })
          .lean()
      ]);
      return sendSuccess(res, "Vendor ledger generated", { reportType, data: { expenses, purchases } });
    }
    case "receivables-aging": {
      const { buildReceivablesAging, flattenReceivablesAging } = await import("../utils/receivablesAging.js");
      const aging = await buildReceivablesAging(schoolId, { asOfDateBs: toDateBs, batchId });
      return sendSuccess(res, "Receivables aging generated", {
        reportType,
        data: flattenReceivablesAging(aging),
        summary: aging.totals
      });
    }
    case "cash-flow": {
      const statement = await buildCashFlowStatement(schoolId, { fromDateBs, toDateBs });
      return sendSuccess(res, "Cash flow generated", {
        reportType,
        data: flattenCashFlow(statement),
        summary: {
          netOperatingNpr: statement.netOperatingNpr,
          netInvestingNpr: statement.netInvestingNpr,
          netFinancingNpr: statement.netFinancingNpr,
          netChangeNpr: statement.netChangeNpr,
          openingCashNpr: statement.openingCashNpr,
          closingCashNpr: statement.closingCashNpr
        }
      });
    }
    default:
      throw new ApiError(400, "Report type not supported in ledger reports");
  }
});

// Re-export for vendor ledger
import { AccountingExpense } from "../models/AccountingExpense.js";
import { AccountingPurchase } from "../models/AccountingPurchase.js";

export const ensureDefaultFiscalYear = async (schoolId: import("mongoose").Types.ObjectId): Promise<void> => {
  const existing = await FiscalYear.countDocuments({ schoolId });
  if (existing > 0) return;

  const settings = await AccountingSettings.findOne({ schoolId }).lean();
  const yearBs = settings?.currentFiscalYearBs ?? "2083/2084";
  const dates = getDefaultFiscalYearDates(yearBs);

  await FiscalYear.create({
    schoolId,
    yearBs,
    startDateBs: dates.startDateBs,
    endDateBs: dates.endDateBs,
    isCurrent: true
  });
};