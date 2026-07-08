import crypto from "crypto";
import type { Request, Response } from "express";
import {
  accountantSchema,
  accountingExpenseSchema,
  accountingIncomeSchema,
  accountingPurchaseSchema,
  accountingSettingsSchema,
  bankAccountSchema,
  cashBookEntrySchema,
  enhancedFeeCollectionSchema,
  extendedFeeStructureSchema,
  salaryPaymentSchema,
  buildFinancialSummaryRows,
  buildFinancialSummaryCsv,
  buildReportCsv,
  sumAmount,
  type AccountingReportType,
  type FinancialSummaryReport
} from "@phit-erp/shared";
import { Accountant } from "../models/Accountant.js";
import { AccountingExpense } from "../models/AccountingExpense.js";
import { AccountingIncome } from "../models/AccountingIncome.js";
import { AccountingPurchase } from "../models/AccountingPurchase.js";
import { AccountingSettings } from "../models/AccountingSettings.js";
import { AuditLog } from "../models/AuditLog.js";
import { BankAccount } from "../models/BankAccount.js";
import { CashBookEntry } from "../models/CashBookEntry.js";
import { FeeCollection } from "../models/FeeCollection.js";
import { FeeStructure } from "../models/FeeStructure.js";
import { SalaryPayment } from "../models/SalaryPayment.js";
import { School } from "../models/School.js";
import { Batch } from "../models/Batch.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { Year } from "../models/Year.js";
import { Setting } from "../models/Setting.js";
import { Student } from "../models/Student.js";
import { CollegeStaff } from "../models/CollegeStaff.js";
import { Teacher } from "../models/Teacher.js";
import { User } from "../models/User.js";
import {
  calculateFeeTotals,
  calculateNetSalary,
  calculateSuggestedLateFee,
  computeBalanceAfterEntry,
  generateReceiptNumber
} from "../utils/accountingCalculations.js";
import { getLatestCashBalance, recordCashEntry, reverseCashEntry } from "../utils/accountingCashBook.js";
import { getFiscalYearFromBsDate } from "../utils/fiscalYear.js";
import { generateReceiptVerificationCode } from "../utils/receiptVerification.js";
import {
  postExpenseJournal,
  postFeeCollectionJournal,
  postIncomeJournal,
  postPurchaseJournal,
  postSalaryJournal,
  reverseJournalEntry
} from "../utils/journalPosting.js";
import { FeeRefund } from "../models/FeeRefund.js";
import { recordAudit } from "../utils/audit.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import {
  buildCredentialsAdminMessage,
  notifyAccountCredentials,
  resolvePortalPassword
} from "../utils/credentialEmail.js";
import { ensureValidBsDate, getTodayBs } from "../utils/nepaliDate.js";
import { withFinancialTransaction } from "../utils/financialTransaction.js";
import { voidFeeCollection, voidWithJournalReversal } from "../utils/accountingVoid.js";
import { hasAccountingPermission } from "@phit-erp/shared";
import { needsApprovalForAmount } from "./accountingApprovalController.js";
import { FinancialApproval } from "../models/FinancialApproval.js";
import { z } from "zod";

const reverseReasonSchema = z.object({
  reason: z.string().min(3, "Reason must be at least 3 characters")
});
import { generateFeeReceiptPDF } from "../utils/pdf.js";
import { getInstitutionType, isCollege } from "../utils/institution.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

const getOrCreateSettings = async (schoolId: ReturnType<typeof tenantObjectId>) => {
  let settings = await AccountingSettings.findOne({ schoolId });
  if (!settings) {
    settings = await AccountingSettings.create({ schoolId });
  }
  return settings;
};

const getActorName = async (req: Request): Promise<string> => {
  if (!req.user?.userId) return "System";
  const user = await User.findById(req.user.userId).select("fullName").lean();
  return user?.fullName ?? "Accountant";
};

export const getAccountingDashboard = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const today = getTodayBs();
  const currentMonth = today.slice(0, 7);

  const [collections, expenses, students, recentCollections, recentExpenses, cashEntries, bankAccounts] =
    await Promise.all([
      FeeCollection.find({ schoolId, isDeleted: false }).lean(),
      AccountingExpense.find({ schoolId, isDeleted: false }).lean(),
      Student.find({ schoolId }).lean(),
      FeeCollection.find({ schoolId, isDeleted: false }).sort({ createdAt: -1 }).limit(5).lean(),
      AccountingExpense.find({ schoolId, isDeleted: false }).sort({ createdAt: -1 }).limit(5).lean(),
      CashBookEntry.find({ schoolId }).sort({ dateBs: -1, createdAt: -1 }).limit(10).lean(),
      BankAccount.find({ schoolId, isActive: true }).lean()
    ]);

  const totalExpenses = expenses.reduce((sum, item) => sum + item.amountNpr, 0);
  const pendingFees = students.reduce((sum, item) => sum + (item.feesDueNpr ?? 0), 0);
  const bankBalance = bankAccounts.reduce((sum, item) => sum + item.currentBalanceNpr, 0);
  const todayCollectionNpr = collections
    .filter((item) => item.paidDateBs === today)
    .reduce((sum, item) => sum + item.amountPaidNpr, 0);
  const monthlyCollectionNpr = collections
    .filter((item) => item.paidDateBs.startsWith(currentMonth))
    .reduce((sum, item) => sum + item.amountPaidNpr, 0);

  const feeByMonth = collections.reduce<Record<string, number>>((acc, item) => {
    const month = item.paidDateBs.slice(0, 7);
    acc[month] = (acc[month] ?? 0) + item.amountPaidNpr;
    return acc;
  }, {});

  const expenseByCategory = expenses.reduce<Record<string, number>>((acc, item) => {
    acc[item.category] = (acc[item.category] ?? 0) + item.amountNpr;
    return acc;
  }, {});

  const revenueByFeeType = collections.reduce<Record<string, number>>((acc, item) => {
    for (const breakdown of item.feeBreakdown ?? []) {
      acc[breakdown.feeType] = (acc[breakdown.feeType] ?? 0) + breakdown.amountNpr;
    }
    return acc;
  }, {});

  const cashBalanceNpr = await getLatestCashBalance(schoolId);

  return sendSuccess(res, "Accounting dashboard fetched", {
    stats: [
      { label: "Today's Collection", value: todayCollectionNpr },
      { label: "Monthly Collection", value: monthlyCollectionNpr },
      { label: "Outstanding Fees", value: pendingFees },
      { label: "Total Expenses", value: totalExpenses }
    ],
    feeChart: Object.entries(feeByMonth).map(([label, amount]) => ({ label, amount })),
    expenseChart: Object.entries(expenseByCategory).map(([label, amount]) => ({ label, amount })),
    collectionTrend: Object.entries(feeByMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([label, amount]) => ({ label, amount })),
    revenueSources: Object.entries(revenueByFeeType).map(([label, amount]) => ({ label, amount })),
    recentCollections,
    recentExpenses,
    recentTransactions: cashEntries.map((entry) => ({
      dateBs: entry.dateBs,
      type: entry.category,
      description: entry.description,
      amountNpr: entry.amountNpr,
      entryType: entry.entryType
    })),
    pendingFeesTotal: pendingFees,
    todayCollectionNpr,
    monthlyCollectionNpr,
    cashBalanceNpr,
    bankBalanceNpr: bankBalance,
    pendingApprovals: 0,
    generatedAt: today
  });
});

export const listAccountingStructures = asyncHandler(async (req: Request, res: Response) => {
  const structures = await FeeStructure.find(withTenantScope(req)).sort({ createdAt: -1 });
  return sendSuccess(res, "Fee structures fetched", structures);
});

export const createAccountingStructure = asyncHandler(async (req: Request, res: Response) => {
  const payload = extendedFeeStructureSchema.parse(req.body);
  const schoolId = tenantObjectId(req);
  const versionGroupId = payload.versionGroupId || crypto.randomUUID();
  const structure = await FeeStructure.create({
    ...payload,
    schoolId,
    versionGroupId,
    status: payload.status ?? "ACTIVE"
  });
  await recordAudit(req, { action: "accounting.structure.create", entity: "FeeStructure", entityId: structure._id.toString(), after: structure });
  return sendSuccess(res, "Fee structure created", structure, 201);
});

export const createFeeStructureVersion = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const existing = await FeeStructure.findOne({ _id: req.params.id, schoolId });
  if (!existing) throw new ApiError(404, "Fee structure not found");

  existing.status = "ARCHIVED";
  await existing.save();

  const payload = extendedFeeStructureSchema.parse(req.body);
  const newVersion = await FeeStructure.create({
    ...payload,
    schoolId,
    versionGroupId: existing.versionGroupId ?? existing._id.toString(),
    version: (existing.version ?? 1) + 1,
    status: "ACTIVE"
  });

  await recordAudit(req, {
    action: "accounting.structure.version",
    entity: "FeeStructure",
    entityId: newVersion._id.toString(),
    before: existing,
    after: newVersion
  });
  return sendSuccess(res, "New fee structure version created", newVersion, 201);
});

export const updateAccountingStructure = asyncHandler(async (req: Request, res: Response) => {
  const payload = extendedFeeStructureSchema.parse(req.body);
  const before = await FeeStructure.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!before) throw new ApiError(404, "Fee structure not found");

  const structure = await FeeStructure.findOneAndUpdate(withTenantScope(req, { _id: req.params.id }), payload, { new: true });
  await recordAudit(req, { action: "accounting.structure.update", entity: "FeeStructure", entityId: String(req.params.id), before, after: structure });
  return sendSuccess(res, "Fee structure updated", structure);
});

export const deleteAccountingStructure = asyncHandler(async (req: Request, res: Response) => {
  const structure = await FeeStructure.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));
  if (!structure) throw new ApiError(404, "Fee structure not found");
  await recordAudit(req, { action: "accounting.structure.delete", entity: "FeeStructure", entityId: String(req.params.id), before: structure });
  return sendSuccess(res, "Fee structure deleted");
});

export const listStudentAccounts = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);

  const [students, primaryGroups, secondaryGroups, collections] = await Promise.all([
    Student.find({ schoolId }).populate("user", "-password").sort({ rollNumber: 1 }).lean(),
    college ? Batch.find({ schoolId }).lean() : SchoolClass.find({ schoolId }).lean(),
    college ? Year.find({ schoolId }).lean() : Section.find({ schoolId }).lean(),
    FeeCollection.find({ schoolId, isDeleted: false }).lean()
  ]);

  const primaryMap = new Map(primaryGroups.map((item) => [item._id.toString(), item.name]));
  const secondaryMap = new Map(secondaryGroups.map((item) => [item._id.toString(), item.name]));

  const accounts = students.map((student) => {
    const studentCollections = collections.filter((item) => item.studentId.toString() === student._id.toString());
    const totalPaid = studentCollections.reduce((sum, item) => sum + item.amountPaidNpr, 0);
    const totalDiscount = studentCollections.reduce((sum, item) => sum + (item.discountNpr ?? 0), 0);
    const totalScholarship = studentCollections.reduce((sum, item) => sum + (item.scholarshipNpr ?? 0), 0);
    const lastPayment = studentCollections.sort((a, b) => b.paidDateBs.localeCompare(a.paidDateBs))[0];

    const primaryId = college ? student.batchId?.toString() : student.classId?.toString();
    const secondaryId = college ? student.yearId?.toString() : student.sectionId?.toString();

    return {
      student,
      className: primaryId ? (primaryMap.get(primaryId) ?? "") : "",
      sectionName: secondaryId ? (secondaryMap.get(secondaryId) ?? "") : "",
      previousDueNpr: student.feesDueNpr ?? 0,
      totalPaidNpr: totalPaid,
      totalDiscountNpr: totalDiscount,
      totalScholarshipNpr: totalScholarship,
      remainingDueNpr: student.feesDueNpr ?? 0,
      lastPaymentDateBs: lastPayment?.paidDateBs
    };
  });

  return sendSuccess(res, "Student accounts fetched", accounts);
});

export const getStudentFinancialHistory = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const student = await Student.findOne({ _id: req.params.studentId, schoolId }).populate("user", "-password").lean();
  if (!student) throw new ApiError(404, "Student not found");

  if (req.user?.role === "STUDENT") {
    const ownStudent = await Student.findOne({ schoolId, user: req.user.userId }).lean();
    if (!ownStudent || ownStudent._id.toString() !== student._id.toString()) {
      throw new ApiError(403, "You can only view your own financial records");
    }
  }

  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);

  const [primaryDoc, secondaryDoc, collections, refunds] = await Promise.all([
    college ? Batch.findById(student.batchId).lean() : SchoolClass.findById(student.classId).lean(),
    college ? Year.findById(student.yearId).lean() : Section.findById(student.sectionId).lean(),
    FeeCollection.find({ schoolId, studentId: student._id, isDeleted: false }).sort({ paidDateBs: -1 }).lean(),
    FeeRefund.find({ schoolId, studentId: student._id, isDeleted: false }).sort({ dateBs: -1 }).lean()
  ]);

  const totalPaid = collections.reduce((sum, item) => sum + item.amountPaidNpr, 0);
  const totalDiscount = collections.reduce((sum, item) => sum + (item.discountNpr ?? 0), 0);
  const totalScholarship = collections.reduce((sum, item) => sum + (item.scholarshipNpr ?? 0), 0);
  const totalFine = collections.reduce((sum, item) => sum + (item.lateFeeNpr ?? 0), 0);
  const advanceBalance = collections.reduce((sum, item) => sum + (item.advancePaymentNpr ?? 0), 0);
  const totalRefunds = refunds.reduce((sum, item) => sum + item.amountNpr, 0);

  const dueInstallments = collections
    .filter((c) => c.isInstallment && c.installmentNumber && c.totalInstallments)
    .map((c) => ({
      installmentNumber: c.installmentNumber!,
      totalInstallments: c.totalInstallments!,
      amountNpr: c.amountPaidNpr,
      dueDateBs: c.paidDateBs
    }));

  return sendSuccess(res, "Student financial history fetched", {
    student,
    className: college ? "" : (primaryDoc?.name ?? ""),
    sectionName: college ? "" : (secondaryDoc?.name ?? ""),
    batchName: college ? (primaryDoc?.name ?? "") : undefined,
    yearName: college ? (secondaryDoc?.name ?? "") : undefined,
    guardianName: student.guardianName,
    scholarshipStatus: totalScholarship > 0 ? "Scholarship Applied" : "None",
    totalPayableNpr: totalPaid + (student.feesDueNpr ?? 0) + totalDiscount + totalScholarship,
    outstandingDueNpr: student.feesDueNpr ?? 0,
    totalPaidNpr: totalPaid,
    totalDiscountNpr: totalDiscount,
    totalScholarshipNpr: totalScholarship,
    totalFineNpr: totalFine,
    advanceBalanceNpr: advanceBalance,
    totalRefundsNpr: totalRefunds,
    collections,
    refunds: refunds.map((r) => ({
      _id: r._id.toString(),
      refundNumber: r.refundNumber,
      dateBs: r.dateBs,
      amountNpr: r.amountNpr,
      reason: r.reason
    })),
    dueInstallments
  });
});

export const listFeeReceipts = asyncHandler(async (req: Request, res: Response) => {
  const collections = await FeeCollection.find(withTenantScope(req, { isDeleted: false }))
    .populate({ path: "studentId", populate: { path: "user", select: "-password" } })
    .sort({ paidDateBs: -1 });
  return sendSuccess(res, "Fee receipts fetched", collections);
});

export const collectAccountingFee = asyncHandler(async (req: Request, res: Response) => {
  const payload = enhancedFeeCollectionSchema.parse(req.body);
  ensureValidBsDate(payload.paidDateBs);

  const schoolId = tenantObjectId(req);
  const settings = await getOrCreateSettings(schoolId);
  const student = await Student.findOne({ _id: payload.studentId, schoolId });
  if (!student) throw new ApiError(404, "Student not found");

  let structure = null;
  if (payload.feeStructureId) {
    structure = await FeeStructure.findOne({ _id: payload.feeStructureId, schoolId });
    if (!structure) throw new ApiError(404, "Fee structure not found");
  }

  const previousDueNpr = student.feesDueNpr ?? 0;
  const currentChargesNpr = payload.currentChargesNpr || structure?.amountNpr || 0;
  const lateFeeNpr =
    payload.lateFeeNpr > 0
      ? payload.lateFeeNpr
      : calculateSuggestedLateFee(previousDueNpr, settings.lateFinePercent);
  const totals = calculateFeeTotals({
    previousDueNpr,
    currentChargesNpr,
    amountPaidNpr: payload.amountPaidNpr,
    discountNpr: payload.discountNpr,
    scholarshipNpr: payload.scholarshipNpr,
    lateFeeNpr
  });

  const receiptCount = await FeeCollection.countDocuments({ schoolId });
  const receiptNumber =
    payload.receiptNumber?.trim() ||
    (settings.autoReceiptNumber
      ? generateReceiptNumber(settings.receiptPrefix, receiptCount + 1)
      : `RCPT-${Date.now()}`);

  const accountantName = await getActorName(req);
  const feeBreakdown =
    payload.feeBreakdown.length > 0
      ? payload.feeBreakdown
      : structure
        ? [{ feeType: structure.feeType, title: structure.title, amountNpr: currentChargesNpr }]
        : [];

  const fiscalYearBs = getFiscalYearFromBsDate(payload.paidDateBs, settings.currentFiscalYearBs);
  const verificationCode = generateReceiptVerificationCode(
    schoolId.toString(),
    receiptNumber,
    payload.amountPaidNpr,
    payload.paidDateBs
  );

  const collection = await withFinancialTransaction(async (session) => {
    const [created] = await FeeCollection.create(
      [
        {
          schoolId,
          studentId: payload.studentId,
          feeStructureId: payload.feeStructureId,
          receiptNumber,
          paidDateBs: payload.paidDateBs,
          fiscalYearBs,
          academicYearBs: payload.academicYearBs ?? structure?.academicYearBs,
          semesterBs: payload.semesterBs ?? structure?.semesterBs,
          previousDueNpr,
          currentChargesNpr,
          amountPaidNpr: payload.amountPaidNpr,
          discountNpr: payload.discountNpr,
          scholarshipNpr: payload.scholarshipNpr,
          lateFeeNpr,
          advancePaymentNpr: totals.advancePaymentNpr,
          remainingDueNpr: totals.remainingDueNpr,
          paymentMethod: payload.paymentMethod ?? settings.defaultPaymentMethod,
          bankAccountId: payload.bankAccountId,
          transactionNumber: payload.transactionNumber,
          verificationCode,
          feeBreakdown,
          isInstallment: payload.isInstallment,
          installmentNumber: payload.installmentNumber,
          totalInstallments: payload.totalInstallments ?? structure?.installmentCount,
          notes: payload.notes,
          accountantName,
          createdBy: req.user!.userId
        }
      ],
      session ? { session } : undefined
    );
    if (!created) throw new ApiError(500, "Failed to create fee collection");

    student.feesDueNpr = totals.remainingDueNpr;
    await student.save(session ? { session } : undefined);

    await recordCashEntry(req, {
      dateBs: payload.paidDateBs,
      entryType: "CREDIT",
      category: "Fee Collection",
      description: `Fee receipt ${receiptNumber}`,
      amountNpr: payload.amountPaidNpr,
      paymentMethod: payload.paymentMethod ?? settings.defaultPaymentMethod,
      referenceType: "FeeCollection",
      referenceId: created._id.toString(),
      bankAccountId: payload.bankAccountId
    });

    await postFeeCollectionJournal({
      schoolId,
      userId: req.user!.userId as unknown as import("mongoose").Types.ObjectId,
      collectionId: created._id,
      studentId: payload.studentId,
      dateBs: payload.paidDateBs,
      amountPaidNpr: payload.amountPaidNpr,
      discountNpr: payload.discountNpr,
      scholarshipNpr: payload.scholarshipNpr,
      lateFeeNpr,
      paymentMethod: payload.paymentMethod ?? settings.defaultPaymentMethod,
      bankAccountId: payload.bankAccountId,
      receiptNumber,
      feeBreakdown
    });

    return created;
  });

  await recordAudit(req, {
    action: "accounting.fee.collect",
    entity: "FeeCollection",
    entityId: collection._id.toString(),
    after: collection
  });

  return sendSuccess(res, "Fee collected successfully", collection, 201);
});

export const updateAccountingFeeCollection = asyncHandler(async (req: Request, res: Response) => {
  const payload = enhancedFeeCollectionSchema.partial().parse(req.body);
  const schoolId = tenantObjectId(req);
  const existing = await FeeCollection.findOne({ _id: req.params.id, schoolId });
  if (!existing) throw new ApiError(404, "Fee collection not found");

  const student = await Student.findOne({ _id: existing.studentId, schoolId });
  if (!student) throw new ApiError(404, "Student not found");

  const previousDueNpr = payload.currentChargesNpr !== undefined ? existing.previousDueNpr : existing.previousDueNpr;
  const currentChargesNpr = payload.currentChargesNpr ?? existing.currentChargesNpr;
  const amountPaidNpr = payload.amountPaidNpr ?? existing.amountPaidNpr;
  const discountNpr = payload.discountNpr ?? existing.discountNpr;
  const scholarshipNpr = payload.scholarshipNpr ?? existing.scholarshipNpr;
  const lateFeeNpr = payload.lateFeeNpr ?? existing.lateFeeNpr;

  const totals = calculateFeeTotals({
    previousDueNpr,
    currentChargesNpr,
    amountPaidNpr,
    discountNpr,
    scholarshipNpr,
    lateFeeNpr
  });

  const before = existing.toObject();
  Object.assign(existing, payload, {
    remainingDueNpr: totals.remainingDueNpr,
    advancePaymentNpr: totals.advancePaymentNpr
  });
  await existing.save();

  student.feesDueNpr = totals.remainingDueNpr;
  await student.save();

  await recordAudit(req, {
    action: "accounting.fee.update",
    entity: "FeeCollection",
    entityId: existing._id.toString(),
    before,
    after: existing
  });

  return sendSuccess(res, "Fee collection updated", existing);
});

export const reverseFeeCollection = asyncHandler(async (req: Request, res: Response) => {
  const payload = reverseReasonSchema.parse(req.body);
  const schoolId = tenantObjectId(req);
  const userId = req.user!.userId as unknown as import("mongoose").Types.ObjectId;

  const collection = await FeeCollection.findOne({ _id: req.params.id, schoolId, isDeleted: false });
  if (!collection) throw new ApiError(404, "Fee collection not found");

  const settings = await getOrCreateSettings(schoolId);
  if (settings.auditLockDateBs && collection.paidDateBs <= settings.auditLockDateBs) {
    throw new ApiError(403, "This fiscal period is audit-locked. Cannot reverse.");
  }

  const requiresApproval = await needsApprovalForAmount(schoolId, collection.amountPaidNpr, req.user!.role);
  if (requiresApproval) {
    const existing = await FinancialApproval.findOne({
      schoolId,
      entityType: "FeeCollection",
      entityId: collection._id,
      status: "PENDING",
      isDeleted: false
    });
    if (existing) throw new ApiError(409, "An approval request is already pending");

    const approval = await FinancialApproval.create({
      schoolId,
      entityType: "FeeCollection",
      entityId: collection._id,
      actionType: "REVERSE",
      amountNpr: collection.amountPaidNpr,
      reason: payload.reason,
      requestedBy: req.user!.userId,
      beforeSnapshot: collection.toObject()
    });

    await recordAudit(req, {
      action: "accounting.approval.request",
      entity: "FinancialApproval",
      entityId: approval._id.toString(),
      after: approval
    });

    return sendSuccess(res, "Reversal submitted for approval", approval, 202);
  }

  const before = collection.toObject();

  await withFinancialTransaction(async (session) => {
    await voidFeeCollection(req, collection, schoolId, userId, payload.reason, session);
  });

  await recordAudit(req, {
    action: "accounting.fee.reverse",
    entity: "FeeCollection",
    entityId: collection._id.toString(),
    before,
    after: { isDeleted: true, voidReason: payload.reason }
  });

  return sendSuccess(res, "Fee collection reversed successfully");
});

export const downloadFeeReceipt = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const collection = await FeeCollection.findOne({ _id: req.params.id, schoolId, isDeleted: false });
  if (!collection) throw new ApiError(404, "Receipt not found");

  if (req.user?.role === "STUDENT") {
    const ownStudent = await Student.findOne({ schoolId, user: req.user.userId }).lean();
    if (!ownStudent || ownStudent._id.toString() !== collection.studentId.toString()) {
      throw new ApiError(403, "You can only download your own receipts");
    }
  } else if (!hasAccountingPermission(req.user!.role, "print_receipt")) {
    throw new ApiError(403, "You do not have permission to print receipts");
  }

  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);

  const [school, student, settings] = await Promise.all([
    School.findById(schoolId).lean(),
    Student.findById(collection.studentId).populate("user", "-password").lean(),
    Setting.findOne({ schoolId }).lean()
  ]);

  if (!student || !school) throw new ApiError(404, "Receipt data incomplete");

  const [classDoc, sectionDoc] = await Promise.all([
    college
      ? Batch.findById(student.batchId).lean()
      : SchoolClass.findById(student.classId).lean(),
    college ? Year.findById(student.yearId).lean() : Section.findById(student.sectionId).lean()
  ]);

  const feeTitle = collection.feeBreakdown?.map((item) => item.title).join(", ") || "College Fee";
  const isReprint = (collection.printCount ?? 0) > 0;
  const printAction = isReprint ? "accounting.receipt.reprint" : "accounting.receipt.print";

  collection.printCount = (collection.printCount ?? 0) + 1;
  collection.lastPrintedAt = new Date();
  collection.lastPrintedBy = req.user!.userId as unknown as import("mongoose").Types.ObjectId;
  await collection.save();

  await recordAudit(req, {
    action: printAction,
    entity: "FeeCollection",
    entityId: collection._id.toString(),
    before: { printCount: (collection.printCount ?? 1) - 1 },
    after: {
      printCount: collection.printCount,
      receiptNumber: collection.receiptNumber,
      isReprint
    }
  });

  await generateFeeReceiptPDF(
    {
      schoolName: settings?.schoolName ?? school.name,
      schoolNameNp: settings?.schoolNameNp ?? school.nameNp,
      receiptNumber: collection.receiptNumber,
      paidDateBs: collection.paidDateBs,
      studentName: String((student.user as { fullName?: string } | null)?.fullName ?? ""),
      admissionNumber: student.admissionNumber,
      className: classDoc?.name ?? "",
      sectionName: sectionDoc?.name ?? "",
      feeTitle,
      amountPaidNpr: collection.amountPaidNpr,
      discountNpr: collection.discountNpr ?? 0,
      lateFeeNpr: collection.lateFeeNpr ?? 0,
      totalPaid: collection.amountPaidNpr,
      scholarshipNpr: collection.scholarshipNpr ?? 0,
      remainingDueNpr: collection.remainingDueNpr ?? 0,
      paymentMethod: collection.paymentMethod ?? "CASH",
      accountantName: collection.accountantName ?? "",
      rollNumber: student.rollNumber,
      feeBreakdown: collection.feeBreakdown ?? [],
      verificationCode: collection.verificationCode ?? undefined,
      transactionNumber: collection.transactionNumber ?? undefined,
      isDuplicate: isReprint
    },
    res
  );
});

export const listExpenses = asyncHandler(async (req: Request, res: Response) => {
  const expenses = await AccountingExpense.find(withTenantScope(req, { isDeleted: false })).sort({ dateBs: -1 });
  return sendSuccess(res, "Expenses fetched", expenses);
});

export const createExpense = asyncHandler(async (req: Request, res: Response) => {
  const payload = accountingExpenseSchema.parse(req.body);
  ensureValidBsDate(payload.dateBs);
  const expense = await AccountingExpense.create({
    ...payload,
    schoolId: tenantObjectId(req),
    createdBy: req.user!.userId
  });

  await recordCashEntry(req, {
    dateBs: payload.dateBs,
    entryType: "DEBIT",
    category: payload.category,
    description: payload.description,
    amountNpr: payload.amountNpr,
    paymentMethod: payload.paymentMethod,
    referenceType: "AccountingExpense",
    referenceId: expense._id.toString()
  });

  await postExpenseJournal({
    schoolId: tenantObjectId(req),
    userId: req.user!.userId as unknown as import("mongoose").Types.ObjectId,
    expenseId: expense._id,
    dateBs: payload.dateBs,
    amountNpr: payload.amountNpr,
    category: payload.category,
    paymentMethod: payload.paymentMethod,
    description: payload.description
  });

  await recordAudit(req, { action: "accounting.expense.create", entity: "AccountingExpense", entityId: expense._id.toString(), after: expense });
  return sendSuccess(res, "Expense recorded", expense, 201);
});

export const updateExpense = asyncHandler(async (req: Request, res: Response) => {
  const payload = accountingExpenseSchema.partial().parse(req.body);
  const before = await AccountingExpense.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!before) throw new ApiError(404, "Expense not found");

  const expense = await AccountingExpense.findOneAndUpdate(withTenantScope(req, { _id: req.params.id }), payload, { new: true });
  await recordAudit(req, { action: "accounting.expense.update", entity: "AccountingExpense", entityId: String(req.params.id), before, after: expense });
  return sendSuccess(res, "Expense updated", expense);
});

export const deleteExpense = asyncHandler(async (req: Request, res: Response) => {
  const payload = reverseReasonSchema.parse(req.body ?? { reason: "Voided by administrator" });
  const schoolId = tenantObjectId(req);
  const userId = req.user!.userId as unknown as import("mongoose").Types.ObjectId;

  const expense = await AccountingExpense.findOne(withTenantScope(req, { _id: req.params.id, isDeleted: false }));
  if (!expense) throw new ApiError(404, "Expense not found");

  const requiresApproval = await needsApprovalForAmount(schoolId, expense.amountNpr, req.user!.role);
  if (requiresApproval) {
    const approval = await FinancialApproval.create({
      schoolId,
      entityType: "AccountingExpense",
      entityId: expense._id,
      actionType: "VOID",
      amountNpr: expense.amountNpr,
      reason: payload.reason,
      requestedBy: req.user!.userId,
      beforeSnapshot: expense.toObject()
    });
    await recordAudit(req, { action: "accounting.approval.request", entity: "FinancialApproval", entityId: approval._id.toString(), after: approval });
    return sendSuccess(res, "Void request submitted for approval", approval, 202);
  }

  const before = expense.toObject();
  await withFinancialTransaction(async (session) => {
    await voidWithJournalReversal(req, expense, schoolId, userId, "AccountingExpense", payload.reason, expense.dateBs, session);
  });
  await recordAudit(req, { action: "accounting.expense.void", entity: "AccountingExpense", entityId: String(req.params.id), before, after: { isDeleted: true } });
  return sendSuccess(res, "Expense voided (record retained for audit)");
});

export const listPurchases = asyncHandler(async (req: Request, res: Response) => {
  const purchases = await AccountingPurchase.find(withTenantScope(req, { isDeleted: false })).sort({ purchaseDateBs: -1 });
  return sendSuccess(res, "Purchases fetched", purchases);
});

export const createPurchase = asyncHandler(async (req: Request, res: Response) => {
  const payload = accountingPurchaseSchema.parse(req.body);
  ensureValidBsDate(payload.purchaseDateBs);
  const totalAmountNpr = payload.quantity * payload.unitPriceNpr;
  const purchase = await AccountingPurchase.create({
    ...payload,
    totalAmountNpr,
    schoolId: tenantObjectId(req),
    createdBy: req.user!.userId
  });

  if (payload.paymentStatus === "PAID") {
    await recordCashEntry(req, {
      dateBs: payload.purchaseDateBs,
      entryType: "DEBIT",
      category: "Purchase",
      description: `${payload.category} - ${payload.vendor}`,
      amountNpr: totalAmountNpr,
      paymentMethod: payload.paymentMethod,
      referenceType: "AccountingPurchase",
      referenceId: purchase._id.toString()
    });
  }

  await postPurchaseJournal({
    schoolId: tenantObjectId(req),
    userId: req.user!.userId as unknown as import("mongoose").Types.ObjectId,
    purchaseId: purchase._id,
    dateBs: payload.purchaseDateBs,
    amountNpr: totalAmountNpr,
    category: payload.category,
    paymentStatus: payload.paymentStatus,
    paymentMethod: payload.paymentMethod,
    vendor: payload.vendor
  });

  await recordAudit(req, { action: "accounting.purchase.create", entity: "AccountingPurchase", entityId: purchase._id.toString(), after: purchase });
  return sendSuccess(res, "Purchase recorded", purchase, 201);
});

export const updatePurchase = asyncHandler(async (req: Request, res: Response) => {
  const payload = accountingPurchaseSchema.partial().parse(req.body);
  const before = await AccountingPurchase.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!before) throw new ApiError(404, "Purchase not found");

  const quantity = payload.quantity ?? before.quantity;
  const unitPriceNpr = payload.unitPriceNpr ?? before.unitPriceNpr;
  const purchase = await AccountingPurchase.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id }),
    { ...payload, totalAmountNpr: quantity * unitPriceNpr },
    { new: true }
  );

  const wasPaid = before.paymentStatus === "PAID";
  const isPaid = (purchase?.paymentStatus ?? before.paymentStatus) === "PAID";
  if (!wasPaid && isPaid && purchase) {
    await recordCashEntry(req, {
      dateBs: purchase.purchaseDateBs,
      entryType: "DEBIT",
      category: "Purchase",
      description: `${purchase.category} - ${purchase.vendor}`,
      amountNpr: purchase.totalAmountNpr,
      paymentMethod: purchase.paymentMethod,
      referenceType: "AccountingPurchase",
      referenceId: purchase._id.toString()
    });
  }

  await recordAudit(req, { action: "accounting.purchase.update", entity: "AccountingPurchase", entityId: String(req.params.id), before, after: purchase });
  return sendSuccess(res, "Purchase updated", purchase);
});

export const deletePurchase = asyncHandler(async (req: Request, res: Response) => {
  const payload = reverseReasonSchema.parse(req.body ?? { reason: "Voided by administrator" });
  const schoolId = tenantObjectId(req);
  const userId = req.user!.userId as unknown as import("mongoose").Types.ObjectId;

  const purchase = await AccountingPurchase.findOne(withTenantScope(req, { _id: req.params.id, isDeleted: false }));
  if (!purchase) throw new ApiError(404, "Purchase not found");

  const requiresApproval = await needsApprovalForAmount(schoolId, purchase.totalAmountNpr, req.user!.role);
  if (requiresApproval) {
    const approval = await FinancialApproval.create({
      schoolId,
      entityType: "AccountingPurchase",
      entityId: purchase._id,
      actionType: "VOID",
      amountNpr: purchase.totalAmountNpr,
      reason: payload.reason,
      requestedBy: req.user!.userId,
      beforeSnapshot: purchase.toObject()
    });
    await recordAudit(req, { action: "accounting.approval.request", entity: "FinancialApproval", entityId: approval._id.toString(), after: approval });
    return sendSuccess(res, "Void request submitted for approval", approval, 202);
  }

  const before = purchase.toObject();
  await withFinancialTransaction(async (session) => {
    await voidWithJournalReversal(req, purchase, schoolId, userId, "AccountingPurchase", payload.reason, purchase.purchaseDateBs, session);
  });
  await recordAudit(req, { action: "accounting.purchase.void", entity: "AccountingPurchase", entityId: String(req.params.id), before, after: { isDeleted: true } });
  return sendSuccess(res, "Purchase voided (record retained for audit)");
});

export const listIncome = asyncHandler(async (req: Request, res: Response) => {
  const income = await AccountingIncome.find(withTenantScope(req, { isDeleted: false })).sort({ dateBs: -1 });
  return sendSuccess(res, "Income records fetched", income);
});

export const createIncome = asyncHandler(async (req: Request, res: Response) => {
  const payload = accountingIncomeSchema.parse(req.body);
  ensureValidBsDate(payload.dateBs);
  const income = await AccountingIncome.create({
    ...payload,
    schoolId: tenantObjectId(req),
    createdBy: req.user!.userId
  });

  await recordCashEntry(req, {
    dateBs: payload.dateBs,
    entryType: "CREDIT",
    category: payload.category,
    description: payload.description || payload.source,
    amountNpr: payload.amountNpr,
    paymentMethod: payload.paymentMethod,
    referenceType: "AccountingIncome",
    referenceId: income._id.toString()
  });

  await postIncomeJournal({
    schoolId: tenantObjectId(req),
    userId: req.user!.userId as unknown as import("mongoose").Types.ObjectId,
    incomeId: income._id,
    dateBs: payload.dateBs,
    amountNpr: payload.amountNpr,
    category: payload.category,
    paymentMethod: payload.paymentMethod,
    description: payload.description || payload.source
  });

  await recordAudit(req, { action: "accounting.income.create", entity: "AccountingIncome", entityId: income._id.toString(), after: income });
  return sendSuccess(res, "Income recorded", income, 201);
});

export const updateIncome = asyncHandler(async (req: Request, res: Response) => {
  const payload = accountingIncomeSchema.partial().parse(req.body);
  const before = await AccountingIncome.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!before) throw new ApiError(404, "Income record not found");

  const record = await AccountingIncome.findOneAndUpdate(withTenantScope(req, { _id: req.params.id }), payload, { new: true });
  await recordAudit(req, { action: "accounting.income.update", entity: "AccountingIncome", entityId: String(req.params.id), before, after: record });
  return sendSuccess(res, "Income updated", record);
});

export const deleteIncome = asyncHandler(async (req: Request, res: Response) => {
  const payload = reverseReasonSchema.parse(req.body ?? { reason: "Voided by administrator" });
  const schoolId = tenantObjectId(req);
  const userId = req.user!.userId as unknown as import("mongoose").Types.ObjectId;

  const record = await AccountingIncome.findOne(withTenantScope(req, { _id: req.params.id, isDeleted: false }));
  if (!record) throw new ApiError(404, "Income record not found");

  const requiresApproval = await needsApprovalForAmount(schoolId, record.amountNpr, req.user!.role);
  if (requiresApproval) {
    const approval = await FinancialApproval.create({
      schoolId,
      entityType: "AccountingIncome",
      entityId: record._id,
      actionType: "VOID",
      amountNpr: record.amountNpr,
      reason: payload.reason,
      requestedBy: req.user!.userId,
      beforeSnapshot: record.toObject()
    });
    await recordAudit(req, { action: "accounting.approval.request", entity: "FinancialApproval", entityId: approval._id.toString(), after: approval });
    return sendSuccess(res, "Void request submitted for approval", approval, 202);
  }

  const before = record.toObject();
  await withFinancialTransaction(async (session) => {
    await voidWithJournalReversal(req, record, schoolId, userId, "AccountingIncome", payload.reason, record.dateBs, session);
  });
  await recordAudit(req, { action: "accounting.income.void", entity: "AccountingIncome", entityId: String(req.params.id), before, after: { isDeleted: true } });
  return sendSuccess(res, "Income voided (record retained for audit)");
});

export const listSalaries = asyncHandler(async (req: Request, res: Response) => {
  const salaries = await SalaryPayment.find(withTenantScope(req))
    .populate({ path: "teacherId", populate: { path: "user", select: "-password" } })
    .populate("staffId")
    .sort({ monthBs: -1 })
    .lean();

  const normalized = salaries.map((salary) => {
    const staffRef = salary.staffId as { _id?: { toString(): string }; fullName?: string } | string | null | undefined;
    const teacherRef = salary.teacherId as
      | { _id?: { toString(): string }; user?: { fullName?: string; email?: string } }
      | string
      | null
      | undefined;
    const collegeStaff =
      staffRef && typeof staffRef === "object" && "fullName" in staffRef
        ? {
            _id: staffRef._id?.toString() ?? "",
            fullName: staffRef.fullName ?? ""
          }
        : undefined;
    const teacher =
      teacherRef && typeof teacherRef === "object" && teacherRef.user
        ? {
            _id: teacherRef._id?.toString() ?? "",
            user: teacherRef.user
          }
        : undefined;

    return {
      ...salary,
      _id: salary._id.toString(),
      schoolId: salary.schoolId.toString(),
      teacherId:
        typeof teacherRef === "object" && teacherRef?._id
          ? teacherRef._id.toString()
          : typeof teacherRef === "string"
            ? teacherRef
            : undefined,
      staffId:
        typeof staffRef === "object" && staffRef?._id
          ? staffRef._id.toString()
          : typeof staffRef === "string"
            ? staffRef
            : undefined,
      teacher,
      collegeStaff,
      createdBy: salary.createdBy.toString()
    };
  });

  return sendSuccess(res, "Salary payments fetched", normalized);
});

export const createSalary = asyncHandler(async (req: Request, res: Response) => {
  const payload = salaryPaymentSchema.parse(req.body);
  const netSalaryNpr = calculateNetSalary(payload);
  const salary = await SalaryPayment.create({
    ...payload,
    schoolId: tenantObjectId(req),
    netSalaryNpr,
    createdBy: req.user!.userId
  });

  if (payload.status === "PAID" && payload.paidDateBs) {
    await recordCashEntry(req, {
      dateBs: payload.paidDateBs,
      entryType: "DEBIT",
      category: "Salary",
      description: `Salary payment ${payload.monthBs}`,
      amountNpr: netSalaryNpr,
      paymentMethod: payload.paymentMethod,
      referenceType: "SalaryPayment",
      referenceId: salary._id.toString()
    });

    await postSalaryJournal({
      schoolId: tenantObjectId(req),
      userId: req.user!.userId as unknown as import("mongoose").Types.ObjectId,
      salaryId: salary._id,
      dateBs: payload.paidDateBs,
      amountNpr: netSalaryNpr,
      paymentMethod: payload.paymentMethod,
      monthBs: payload.monthBs
    });
  }

  await recordAudit(req, { action: "accounting.salary.create", entity: "SalaryPayment", entityId: salary._id.toString(), after: salary });
  return sendSuccess(res, "Salary payment recorded", salary, 201);
});

export const updateSalary = asyncHandler(async (req: Request, res: Response) => {
  const payload = salaryPaymentSchema.partial().parse(req.body);
  const existing = await SalaryPayment.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!existing) throw new ApiError(404, "Salary payment not found");

  const merged = { ...existing.toObject(), ...payload };
  const netSalaryNpr = calculateNetSalary(merged as Parameters<typeof calculateNetSalary>[0]);
  const before = existing.toObject();
  const salary = await SalaryPayment.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id }),
    { ...payload, netSalaryNpr },
    { new: true }
  );

  const wasPaid = before.status === "PAID";
  const isPaid = (salary?.status ?? before.status) === "PAID";
  const paidDateBs = salary?.paidDateBs || payload.paidDateBs;
  if (!wasPaid && isPaid && salary && paidDateBs) {
    await recordCashEntry(req, {
      dateBs: paidDateBs,
      entryType: "DEBIT",
      category: "Salary",
      description: `Salary payment ${salary.monthBs}`,
      amountNpr: netSalaryNpr,
      paymentMethod: salary.paymentMethod,
      referenceType: "SalaryPayment",
      referenceId: salary._id.toString()
    });
  }

  await recordAudit(req, { action: "accounting.salary.update", entity: "SalaryPayment", entityId: String(req.params.id), before, after: salary });
  return sendSuccess(res, "Salary payment updated", salary);
});

export const listBankAccounts = asyncHandler(async (req: Request, res: Response) => {
  const accounts = await BankAccount.find(withTenantScope(req)).sort({ createdAt: -1 });
  return sendSuccess(res, "Bank accounts fetched", accounts);
});

export const createBankAccount = asyncHandler(async (req: Request, res: Response) => {
  const payload = bankAccountSchema.parse(req.body);
  const account = await BankAccount.create({
    ...payload,
    schoolId: tenantObjectId(req),
    currentBalanceNpr: payload.openingBalanceNpr
  });
  await recordAudit(req, { action: "accounting.bank.create", entity: "BankAccount", entityId: account._id.toString(), after: account });
  return sendSuccess(res, "Bank account created", account, 201);
});

export const updateBankAccount = asyncHandler(async (req: Request, res: Response) => {
  const payload = bankAccountSchema.partial().parse(req.body);
  const before = await BankAccount.findOne(withTenantScope(req, { _id: req.params.id }));
  if (!before) throw new ApiError(404, "Bank account not found");

  const account = await BankAccount.findOneAndUpdate(withTenantScope(req, { _id: req.params.id }), payload, { new: true });
  await recordAudit(req, { action: "accounting.bank.update", entity: "BankAccount", entityId: String(req.params.id), before, after: account });
  return sendSuccess(res, "Bank account updated", account);
});

export const deleteBankAccount = asyncHandler(async (req: Request, res: Response) => {
  const account = await BankAccount.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id }),
    { isActive: false },
    { new: true }
  );
  if (!account) throw new ApiError(404, "Bank account not found");
  await recordAudit(req, { action: "accounting.bank.deactivate", entity: "BankAccount", entityId: String(req.params.id), before: account });
  return sendSuccess(res, "Bank account deactivated", account);
});

export const listCashBook = asyncHandler(async (req: Request, res: Response) => {
  const entries = await CashBookEntry.find(withTenantScope(req)).sort({ dateBs: -1, createdAt: -1 });
  return sendSuccess(res, "Cash book entries fetched", entries);
});

export const createCashBookEntry = asyncHandler(async (req: Request, res: Response) => {
  const payload = cashBookEntrySchema.parse(req.body);
  ensureValidBsDate(payload.dateBs);
  const schoolId = tenantObjectId(req);
  const previousBalance = await getLatestCashBalance(schoolId);
  const balanceAfterNpr = computeBalanceAfterEntry(previousBalance, payload.entryType, payload.amountNpr);

  const entry = await CashBookEntry.create({
    ...payload,
    schoolId,
    balanceAfterNpr,
    createdBy: req.user!.userId
  });

  await recordAudit(req, { action: "accounting.cashbook.create", entity: "CashBookEntry", entityId: entry._id.toString(), after: entry });
  return sendSuccess(res, "Cash book entry created", entry, 201);
});

export const getAccountingSettings = asyncHandler(async (req: Request, res: Response) => {
  const settings = await getOrCreateSettings(tenantObjectId(req));
  return sendSuccess(res, "Accounting settings fetched", settings);
});

export const updateAccountingSettings = asyncHandler(async (req: Request, res: Response) => {
  const payload = accountingSettingsSchema.parse(req.body);
  const schoolId = tenantObjectId(req);
  const before = await AccountingSettings.findOne({ schoolId });
  const settings = await AccountingSettings.findOneAndUpdate({ schoolId }, payload, { new: true, upsert: true });
  await recordAudit(req, { action: "accounting.settings.update", entity: "AccountingSettings", entityId: settings!._id.toString(), before, after: settings });
  return sendSuccess(res, "Accounting settings updated", settings);
});

export const listAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = withTenantScope(req);
  if (typeof req.query.entity === "string") filter.entity = req.query.entity;
  if (typeof req.query.action === "string") filter.action = req.query.action;
  if (typeof req.query.entityId === "string") filter.entityId = req.query.entityId;

  const logs = await AuditLog.find(filter)
    .populate("actorUserId", "fullName email")
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();
  return sendSuccess(res, "Audit logs fetched", logs);
});

const monthDateFilter = (monthBs?: string): Record<string, unknown> | undefined =>
  monthBs ? { $regex: `^${monthBs}` } : undefined;

export const generateAccountingReport = asyncHandler(async (req: Request, res: Response) => {
  const reportType = req.params.reportType as AccountingReportType;
  const schoolId = tenantObjectId(req);
  const monthBs = typeof req.query.monthBs === "string" ? req.query.monthBs : undefined;
  const dateBs = typeof req.query.dateBs === "string" ? req.query.dateBs : undefined;

  let data: unknown = [];
  let summaryPayload: FinancialSummaryReport | null = null;

  switch (reportType) {
    case "daily-fee-collection": {
      const filter: Record<string, unknown> = { schoolId, isDeleted: false };
      if (dateBs) filter.paidDateBs = dateBs;
      data = await FeeCollection.find(filter)
        .populate({ path: "studentId", populate: { path: "user", select: "-password" } })
        .sort({ paidDateBs: -1 })
        .lean();
      break;
    }
    case "monthly-fee-collection": {
      const filter: Record<string, unknown> = { schoolId, isDeleted: false };
      const monthFilter = monthDateFilter(monthBs);
      if (monthFilter) filter.paidDateBs = monthFilter;
      data = await FeeCollection.find(filter)
        .populate({ path: "studentId", populate: { path: "user", select: "-password" } })
        .sort({ paidDateBs: -1 })
        .lean();
      break;
    }
    case "pending-fees":
    case "fee-defaulters": {
      const students = await Student.find({ schoolId, feesDueNpr: { $gt: 0 } })
        .populate("user", "-password")
        .sort({ feesDueNpr: -1 })
        .lean();
      data = students;
      break;
    }
    case "salary-payments": {
      const filter: Record<string, unknown> = { schoolId };
      if (monthBs) filter.monthBs = monthBs;
      data = await SalaryPayment.find(filter)
        .populate({ path: "teacherId", populate: { path: "user", select: "-password" } })
        .populate("staffId")
        .sort({ monthBs: -1 })
        .lean();
      break;
    }
    case "expenses": {
      const filter: Record<string, unknown> = { schoolId, isDeleted: false };
      const monthFilter = monthDateFilter(monthBs);
      if (monthFilter) filter.dateBs = monthFilter;
      data = await AccountingExpense.find(filter).sort({ dateBs: -1 }).lean();
      break;
    }
    case "purchases": {
      const filter: Record<string, unknown> = { schoolId, isDeleted: false };
      const monthFilter = monthDateFilter(monthBs);
      if (monthFilter) filter.purchaseDateBs = monthFilter;
      data = await AccountingPurchase.find(filter).sort({ purchaseDateBs: -1 }).lean();
      break;
    }
    case "income": {
      const filter: Record<string, unknown> = { schoolId, isDeleted: false };
      const monthFilter = monthDateFilter(monthBs);
      if (monthFilter) filter.dateBs = monthFilter;
      data = await AccountingIncome.find(filter).sort({ dateBs: -1 }).lean();
      break;
    }
    case "cash-summary": {
      const filter: Record<string, unknown> = { schoolId };
      const monthFilter = monthDateFilter(monthBs);
      if (monthFilter) filter.dateBs = monthFilter;
      data = await CashBookEntry.find(filter).sort({ dateBs: -1, createdAt: -1 }).lean();
      break;
    }
    case "financial-summary": {
      if (!monthBs) {
        throw new ApiError(400, "Month (BS) is required for the financial summary report");
      }

      const monthFilter = monthDateFilter(monthBs);
      const [fees, income, expenses, purchases, salaries, pendingStudents] = await Promise.all([
        FeeCollection.find({ schoolId, paidDateBs: monthFilter, isDeleted: false })
          .populate({ path: "studentId", populate: { path: "user", select: "-password" } })
          .sort({ paidDateBs: -1 })
          .lean(),
        AccountingIncome.find({ schoolId, dateBs: monthFilter, isDeleted: false }).sort({ dateBs: -1 }).lean(),
        AccountingExpense.find({ schoolId, dateBs: monthFilter, isDeleted: false }).sort({ dateBs: -1 }).lean(),
        AccountingPurchase.find({ schoolId, purchaseDateBs: monthFilter, isDeleted: false }).sort({ purchaseDateBs: -1 }).lean(),
        SalaryPayment.find({ schoolId, monthBs })
          .populate({ path: "teacherId", populate: { path: "user", select: "-password" } })
          .populate("staffId")
          .sort({ monthBs: -1 })
          .lean(),
        Student.find({ schoolId, feesDueNpr: { $gt: 0 } }).select("feesDueNpr").lean()
      ]);

      const feeCollectionNpr = sumAmount(fees, "amountPaidNpr");
      const incomeNpr = sumAmount(income, "amountNpr");
      const expenseNpr = sumAmount(expenses, "amountNpr");
      const purchaseNpr = sumAmount(purchases, "totalAmountNpr");
      const salaryNpr = sumAmount(salaries, "netSalaryNpr");
      const pendingFeesNpr = sumAmount(pendingStudents, "feesDueNpr");
      const inflowNpr = feeCollectionNpr + incomeNpr;
      const outflowNpr = expenseNpr + purchaseNpr + salaryNpr;

      const totals = {
        feeCollectionNpr,
        incomeNpr,
        expenseNpr,
        purchaseNpr,
        salaryNpr,
        pendingFeesNpr,
        netSurplusNpr: inflowNpr - outflowNpr
      };

      summaryPayload = {
        reportType: "financial-summary",
        period: { monthBs, label: `BS ${monthBs}` },
        totals,
        sections: { fees, income, expenses, purchases, salaries },
        data: buildFinancialSummaryRows(totals, {
          fees: fees.length,
          income: income.length,
          expenses: expenses.length,
          purchases: purchases.length,
          salaries: salaries.length,
          pendingStudents: pendingStudents.length
        })
      };
      data = summaryPayload.data;
      break;
    }
    default:
      throw new ApiError(400, "Invalid report type");
  }

  if (req.query.format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${reportType}.csv"`);
    if (summaryPayload) {
      return res.send(buildFinancialSummaryCsv(summaryPayload));
    }
    return res.send(buildReportCsv(reportType, Array.isArray(data) ? data : []));
  }

  if (summaryPayload) {
    return sendSuccess(res, "Financial summary generated", summaryPayload);
  }

  return sendSuccess(res, "Report generated", { reportType, data, monthBs, dateBs });
});

export const listAccountants = asyncHandler(async (req: Request, res: Response) => {
  const accountants = await Accountant.find(withTenantScope(req, { isDeleted: false }))
    .populate("user", "-password")
    .sort({ createdAt: -1 });
  return sendSuccess(res, "Accountants fetched", accountants);
});

export const createAccountant = asyncHandler(async (req: Request, res: Response) => {
  const payload = accountantSchema.parse(req.body);
  const email = payload.email.toLowerCase().trim();
  const existingUser = await User.findOne({ email });
  if (existingUser) throw new ApiError(409, "A user with this email already exists");

  const { password: portalPassword, wasGenerated } = resolvePortalPassword(payload.password);
  const user = await User.create({
    schoolId: req.tenantSchoolId,
    fullName: payload.fullName,
    email,
    phone: payload.phone,
    password: portalPassword,
    role: "ACCOUNTANT",
    isActive: payload.status === "ACTIVE",
    mustChangePassword: wasGenerated
  });

  const accountant = await Accountant.create({
    schoolId: req.tenantSchoolId,
    user: user._id,
    employeeId: payload.employeeId,
    gender: payload.gender,
    address: payload.address,
    joinedDateBs: payload.joinedDateBs,
    photoUrl: payload.photoUrl,
    status: payload.status
  });

  const populated = await Accountant.findById(accountant._id).populate("user", "-password");
  await recordAudit(req, { action: "accounting.accountant.create", entity: "Accountant", entityId: accountant._id.toString(), after: populated });

  const credentialsEmail = await notifyAccountCredentials({
    userId: user._id.toString(),
    fullName: payload.fullName,
    email,
    password: portalPassword,
    schoolId: req.tenantSchoolId?.toString(),
    req
  });

  return sendSuccess(
    res,
    buildCredentialsAdminMessage(credentialsEmail),
    {
      accountant: populated,
      loginEmail: email,
      defaultPassword: portalPassword,
      credentialsEmail
    },
    201
  );
});

export const updateAccountant = asyncHandler(async (req: Request, res: Response) => {
  const payload = accountantSchema.partial().parse(req.body);
  const accountant = await Accountant.findOne(withTenantScope(req, { _id: req.params.id, isDeleted: false }));
  if (!accountant) throw new ApiError(404, "Accountant not found");

  const user = await User.findById(accountant.user);
  if (!user) throw new ApiError(404, "Accountant user not found");

  const before = await Accountant.findById(accountant._id).populate("user", "-password").lean();

  if (payload.fullName) user.fullName = payload.fullName;
  if (payload.phone !== undefined) user.phone = payload.phone;
  if (payload.password) {
    user.password = payload.password;
    user.mustChangePassword = false;
  }
  if (payload.email) {
    const email = payload.email.toLowerCase().trim();
    const duplicate = await User.findOne({ email, _id: { $ne: user._id } });
    if (duplicate) throw new ApiError(409, "A user with this email already exists");
    user.email = email;
  }
  if (payload.status) {
    accountant.status = payload.status;
    user.isActive = payload.status === "ACTIVE";
  }
  if (payload.employeeId) accountant.employeeId = payload.employeeId;
  if (payload.gender) accountant.gender = payload.gender;
  if (payload.address) accountant.address = payload.address;
  if (payload.joinedDateBs) accountant.joinedDateBs = payload.joinedDateBs;
  if (payload.photoUrl !== undefined) accountant.photoUrl = payload.photoUrl;

  await user.save();
  await accountant.save();

  const updated = await Accountant.findById(accountant._id).populate("user", "-password");
  await recordAudit(req, { action: "accounting.accountant.update", entity: "Accountant", entityId: accountant._id.toString(), before, after: updated });
  return sendSuccess(res, "Accountant updated", updated);
});

export const deleteAccountant = asyncHandler(async (req: Request, res: Response) => {
  const accountant = await Accountant.findOne(withTenantScope(req, { _id: req.params.id, isDeleted: false }));
  if (!accountant) throw new ApiError(404, "Accountant not found");

  accountant.isDeleted = true;
  accountant.status = "INACTIVE";
  await accountant.save();

  await User.findByIdAndUpdate(accountant.user, { isActive: false });
  await recordAudit(req, { action: "accounting.accountant.deactivate", entity: "Accountant", entityId: accountant._id.toString(), before: accountant });
  return sendSuccess(res, "Accountant deactivated");
});

export const resetAccountantPassword = asyncHandler(async (req: Request, res: Response) => {
  const { password } = req.body as { password?: string };
  const accountant = await Accountant.findOne(withTenantScope(req, { _id: req.params.id, isDeleted: false }));
  if (!accountant) throw new ApiError(404, "Accountant not found");

  const user = await User.findById(accountant.user);
  if (!user) throw new ApiError(404, "Accountant user not found");

  const { password: portalPassword } = resolvePortalPassword(password);
  user.password = portalPassword;
  user.mustChangePassword = true;
  await user.save();

  const credentialsEmail = await notifyAccountCredentials({
    userId: user._id.toString(),
    fullName: user.fullName,
    email: user.email,
    password: portalPassword,
    schoolId: user.schoolId?.toString(),
    req,
    emailType: "PASSWORD_RESET"
  });

  await recordAudit(req, { action: "accounting.accountant.reset-password", entity: "Accountant", entityId: accountant._id.toString() });
  return sendSuccess(
    res,
    credentialsEmail.sent
      ? `Accountant password reset. Credentials sent to: ${credentialsEmail.email}`
      : `Accountant password reset. Credential email could not be delivered. Reason: ${credentialsEmail.error ?? "Unknown error"}`,
    {
      loginEmail: user.email,
      defaultPassword: portalPassword,
      credentialsEmail
    }
  );
});

export const listSalaryEmployees = asyncHandler(async (req: Request, res: Response) => {
  const [teachers, collegeStaff] = await Promise.all([
    Teacher.find(withTenantScope(req)).populate("user", "-password").sort({ createdAt: -1 }),
    CollegeStaff.find(withTenantScope(req, { isDeleted: false, status: "ACTIVE" })).sort({ fullName: 1 })
  ]);
  return sendSuccess(res, "Salary employees fetched", { teachers, collegeStaff });
});