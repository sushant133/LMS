import type { Request, Response } from "express";
import {
  chartOfAccountSchema,
  feeRefundSchema,
  fiscalYearSchema,
  journalEntrySchema,
  vendorSchema,
  type AccountingReportType
} from "@phit-erp/shared";
import { ChartOfAccount } from "../models/ChartOfAccount.js";
import { FeeCollection } from "../models/FeeCollection.js";
import { FeeRefund } from "../models/FeeRefund.js";
import { FiscalYear } from "../models/FiscalYear.js";
import { JournalEntry } from "../models/JournalEntry.js";
import { Student } from "../models/Student.js";
import { Vendor } from "../models/Vendor.js";
import { Batch } from "../models/Batch.js";
import { Year } from "../models/Year.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { AccountingSettings } from "../models/AccountingSettings.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";
import { ensureValidBsDate } from "../utils/nepaliDate.js";
import { getInstitutionType, isCollege } from "../utils/institution.js";
import { getDefaultFiscalYearDates } from "../utils/fiscalYear.js";
import {
  ensureDefaultChartOfAccounts,
  postFeeRefundJournal,
  postJournalEntry,
  reverseJournalEntryById
} from "../utils/journalPosting.js";
import { generateRefundNumber } from "../utils/receiptVerification.js";
import {
  aggregateJournalBalances,
  buildAccountLedger,
  buildBalanceSheet,
  buildIncomeExpenditure,
  buildTrialBalance
} from "../utils/accountingReports.js";
import { recordCashEntry } from "../utils/accountingCashBook.js";

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

  const entries = await JournalEntry.find(filter).sort({ dateBs: -1, createdAt: -1 }).limit(500);
  return sendSuccess(res, "Journal entries fetched", entries);
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

  // Domain-linked entries must be reversed via fee/expense void APIs (cash + operational docs)
  if (entry.referenceType && entry.referenceType !== "Manual" && entry.referenceId) {
    throw new ApiError(
      400,
      `This journal is linked to ${entry.referenceType}. Reverse it from that module (void/reverse transaction) so cash book and source documents stay in sync.`
    );
  }

  const { assertFiscalPeriodOpen } = await import("../utils/fiscalYear.js");
  await assertFiscalPeriodOpen(schoolId, entry.dateBs);

  const before = entry.toObject();
  await reverseJournalEntryById(schoolId, userId, entry._id);
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

export const listFeeRefunds = asyncHandler(async (req: Request, res: Response) => {
  const refunds = await FeeRefund.find(withTenantScope(req, { isDeleted: false }))
    .populate({ path: "studentId", populate: { path: "user", select: "-password" } })
    .sort({ dateBs: -1 });
  return sendSuccess(res, "Fee refunds fetched", refunds);
});

export const createFeeRefund = asyncHandler(async (req: Request, res: Response) => {
  const payload = feeRefundSchema.parse(req.body);
  ensureValidBsDate(payload.dateBs);
  const schoolId = tenantObjectId(req);

  const student = await Student.findOne({ _id: payload.studentId, schoolId });
  if (!student) throw new ApiError(404, "Student not found");

  const refundCount = await FeeRefund.countDocuments({ schoolId });
  const refundNumber = generateRefundNumber("RFND", refundCount + 1);

  const refund = await FeeRefund.create({
    ...payload,
    schoolId,
    refundNumber,
    createdBy: req.user!.userId
  });

  student.feesDueNpr = (student.feesDueNpr ?? 0) + payload.amountNpr;
  await student.save();

  await postFeeRefundJournal({
    schoolId,
    userId: req.user!.userId as unknown as import("mongoose").Types.ObjectId,
    refundId: refund._id,
    studentId: payload.studentId,
    dateBs: payload.dateBs,
    amountNpr: payload.amountNpr,
    paymentMethod: payload.paymentMethod,
    bankAccountId: payload.bankAccountId,
    refundNumber
  });

  await recordCashEntry(req, {
    dateBs: payload.dateBs,
    entryType: "DEBIT",
    category: "Fee Refund",
    description: `Refund ${refundNumber}`,
    amountNpr: payload.amountNpr,
    paymentMethod: payload.paymentMethod,
    referenceType: "FeeRefund",
    referenceId: refund._id.toString()
  });

  await recordAudit(req, { action: "accounting.refund.create", entity: "FeeRefund", entityId: refund._id.toString(), after: refund });
  return sendSuccess(res, "Fee refund processed", refund, 201);
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
  year.isClosed = true;
  year.closedAt = new Date();
  year.closedBy = req.user!.userId as unknown as import("mongoose").Types.ObjectId;
  await year.save();

  await AccountingSettings.findOneAndUpdate({ schoolId }, { auditLockDateBs: year.endDateBs });
  await recordAudit(req, { action: "accounting.fiscal.close", entity: "FiscalYear", entityId: year._id.toString(), before, after: year });
  return sendSuccess(res, "Fiscal year closed and audit lock applied", year);
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
      const balances = await aggregateJournalBalances(schoolId, { fiscalYearBs, fromDateBs, toDateBs });
      return sendSuccess(res, "Trial balance generated", { reportType, data: buildTrialBalance(balances) });
    }
    case "balance-sheet": {
      const balances = await aggregateJournalBalances(schoolId, { fiscalYearBs, toDateBs });
      return sendSuccess(res, "Balance sheet generated", { reportType, data: buildBalanceSheet(balances) });
    }
    case "income-expenditure": {
      const balances = await aggregateJournalBalances(schoolId, { fiscalYearBs, fromDateBs, toDateBs });
      return sendSuccess(res, "Income & expenditure generated", { reportType, data: buildIncomeExpenditure(balances) });
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
        FeeRefund.find({ schoolId, isDeleted: false }).lean(),
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
          collections: reportType === "student-ledger" ? studentCollections : undefined
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
    case "cash-flow": {
      const balances = await aggregateJournalBalances(schoolId, { fiscalYearBs, fromDateBs, toDateBs });
      const cash = balances.find((b) => b.accountCode === "1001");
      const bank = balances.find((b) => b.accountCode === "1101");
      return sendSuccess(res, "Cash flow generated", {
        reportType,
        data: {
          cashInflowNpr: (cash?.debitNpr ?? 0) + (bank?.debitNpr ?? 0),
          cashOutflowNpr: (cash?.creditNpr ?? 0) + (bank?.creditNpr ?? 0),
          netCashFlowNpr: (cash?.debitNpr ?? 0) + (bank?.debitNpr ?? 0) - (cash?.creditNpr ?? 0) - (bank?.creditNpr ?? 0)
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