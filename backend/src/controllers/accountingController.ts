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
  studentScholarshipAwardSchema,
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
import { StudentScholarshipAward } from "../models/StudentScholarshipAward.js";
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
  buildProgramYearFeeSummary,
  calculateFeeTotals,
  calculateNetSalary,
  calculateSuggestedLateFee,
  computeBalanceAfterEntry,
  generateReceiptNumber,
  PROGRAM_YEAR_LABELS,
  recalculateStudentFeesDue
} from "../utils/accountingCalculations.js";
import { getLatestCashBalance, recordCashEntry, reverseCashEntry } from "../utils/accountingCashBook.js";
import { getFiscalYearFromBsDate } from "../utils/fiscalYear.js";
import { generateReceiptVerificationCode } from "../utils/receiptVerification.js";
import {
  postExpenseJournal,
  postFeeCollectionJournal,
  postIncomeJournal,
  postPurchaseJournal,
  postPurchasePaymentJournal,
  postSalaryJournal,
  reverseJournalEntry
} from "../utils/journalPosting.js";
import { FeeRefund } from "../models/FeeRefund.js";
import { JournalEntry } from "../models/JournalEntry.js";
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

  const [
    collections,
    expenses,
    incomes,
    paidSalaries,
    paidPurchases,
    refunds,
    recentCollections,
    recentExpenses,
    recentSalaries,
    recentPurchases,
    recentRefunds,
    cashEntries
  ] = await Promise.all([
    FeeCollection.find({ schoolId, isDeleted: false }).lean(),
    AccountingExpense.find({ schoolId, isDeleted: false }).lean(),
    AccountingIncome.find({ schoolId, isDeleted: false }).lean(),
    SalaryPayment.find({ schoolId, isDeleted: false, status: "PAID" }).select("netSalaryNpr").lean(),
    AccountingPurchase.find({ schoolId, isDeleted: false, paymentStatus: "PAID" })
      .select("totalAmountNpr")
      .lean(),
    FeeRefund.find({ schoolId, isDeleted: false }).select("amountNpr").lean(),
    FeeCollection.find({ schoolId, isDeleted: false })
      .populate({ path: "studentId", populate: { path: "user", select: "fullName" } })
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(),
    AccountingExpense.find({ schoolId, isDeleted: false }).sort({ createdAt: -1 }).limit(8).lean(),
    SalaryPayment.find({ schoolId, isDeleted: false })
      .populate({ path: "teacherId", populate: { path: "user", select: "fullName" } })
      .populate("staffId")
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(),
    AccountingPurchase.find({ schoolId, isDeleted: false }).sort({ createdAt: -1 }).limit(8).lean(),
    FeeRefund.find({ schoolId, isDeleted: false })
      .populate({ path: "studentId", populate: { path: "user", select: "fullName" } })
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(),
    CashBookEntry.find({ schoolId }).sort({ dateBs: -1, createdAt: -1 }).limit(10).lean()
  ]);

  const totalRegisterExpensesNpr = expenses.reduce((sum, item) => sum + item.amountNpr, 0);
  const totalSalaryPaidNpr = paidSalaries.reduce((sum, item) => sum + (item.netSalaryNpr || 0), 0);
  const totalPurchasesPaidNpr = paidPurchases.reduce((sum, item) => sum + (item.totalAmountNpr || 0), 0);
  const totalRefundsNpr = refunds.reduce((sum, item) => sum + (item.amountNpr || 0), 0);
  const totalOtherIncomeNpr = incomes.reduce((sum, item) => sum + item.amountNpr, 0);
  const totalFeeIncomeNpr = collections.reduce((sum, item) => sum + item.amountPaidNpr, 0);
  const totalIncomeNpr = totalFeeIncomeNpr + totalOtherIncomeNpr;
  // Cash-basis outflow for dashboard card
  const totalExpensesNpr =
    totalRegisterExpensesNpr + totalSalaryPaidNpr + totalPurchasesPaidNpr + totalRefundsNpr;

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

  const studentParty = (row: { studentId?: unknown }) => {
    const s = row.studentId as
      | { user?: { fullName?: string }; admissionNumber?: string }
      | string
      | null
      | undefined;
    if (!s || typeof s === "string") return "—";
    return s.user?.fullName || s.admissionNumber || "Student";
  };

  const salaryParty = (row: {
    staffName?: string | null;
    staffId?: unknown;
    teacherId?: unknown;
  }) => {
    if (row.staffName) return row.staffName;
    const staff = row.staffId as { fullName?: string } | string | null | undefined;
    if (staff && typeof staff === "object" && staff.fullName) return staff.fullName;
    const teacher = row.teacherId as
      | { user?: { fullName?: string } }
      | string
      | null
      | undefined;
    if (teacher && typeof teacher === "object" && teacher.user?.fullName) {
      return teacher.user.fullName;
    }
    return "Staff";
  };

  return sendSuccess(res, "Accounting dashboard fetched", {
    stats: [
      { label: "Today's Collection", value: todayCollectionNpr },
      { label: "Monthly Collection", value: monthlyCollectionNpr },
      { label: "Total Income", value: totalIncomeNpr },
      { label: "Total Expenses", value: totalExpensesNpr },
      { label: "Cash Balance", value: cashBalanceNpr }
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
    todayCollectionNpr,
    monthlyCollectionNpr,
    totalIncomeNpr,
    totalExpensesNpr,
    cashBalanceNpr,
    recentFees: recentCollections.map((c) => ({
      id: c._id.toString(),
      dateBs: c.paidDateBs,
      voucherNo: c.receiptNumber,
      party: studentParty(c),
      amountNpr: c.amountPaidNpr,
      status: "PAID",
      linkTab: "fee-records"
    })),
    recentSalaries: recentSalaries.map((s) => ({
      id: s._id.toString(),
      dateBs: s.paidDateBs || s.monthBs,
      voucherNo: s.monthBs,
      party: salaryParty(s),
      amountNpr: s.netSalaryNpr,
      status: s.status,
      linkTab: "salary-records"
    })),
    recentPurchases: recentPurchases.map((p) => ({
      id: p._id.toString(),
      dateBs: p.purchaseDateBs,
      voucherNo: p.invoiceNumber || p._id.toString().slice(-6),
      party: p.vendor,
      amountNpr: p.totalAmountNpr,
      status: p.paymentStatus,
      linkTab: "purchases"
    })),
    recentExpenseItems: recentExpenses.map((e) => ({
      id: e._id.toString(),
      dateBs: e.dateBs,
      voucherNo: e._id.toString().slice(-6).toUpperCase(),
      party: e.vendor,
      amountNpr: e.amountNpr,
      status: "POSTED",
      linkTab: "expenses"
    })),
    recentRefunds: recentRefunds.map((r) => ({
      id: r._id.toString(),
      dateBs: r.dateBs,
      voucherNo: r.refundNumber,
      party: studentParty(r),
      amountNpr: r.amountNpr,
      status: r.refundType || "REFUND",
      linkTab: "refund-records"
    })),
    // legacy compatibility
    pendingFeesTotal: 0,
    bankBalanceNpr: 0,
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

  const awards = await StudentScholarshipAward.find({
    schoolId,
    isDeleted: false,
    status: { $in: ["ACTIVE", "APPLIED"] }
  }).lean();

  const accounts = students.map((student) => {
    const studentCollections = collections.filter((item) => item.studentId.toString() === student._id.toString());
    const totalPaid = studentCollections.reduce((sum, item) => sum + item.amountPaidNpr, 0);
    const totalDiscount = studentCollections.reduce((sum, item) => sum + (item.discountNpr ?? 0), 0);
    const totalScholarship = studentCollections.reduce((sum, item) => sum + (item.scholarshipNpr ?? 0), 0);
    const lastPayment = studentCollections.sort((a, b) => b.paidDateBs.localeCompare(a.paidDateBs))[0];
    const studentAwards = awards.filter((a) => a.studentId.toString() === student._id.toString());

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
      lastPaymentDateBs: lastPayment?.paidDateBs,
      yearWise: buildProgramYearFeeSummary(studentCollections, studentAwards)
    };
  });

  return sendSuccess(res, "Student accounts fetched", accounts);
});

const YEAR_LABELS = PROGRAM_YEAR_LABELS;

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

  const [primaryDoc, secondaryDoc, collections, refunds, scholarshipAwards] =
    await Promise.all([
      college ? Batch.findById(student.batchId).lean() : SchoolClass.findById(student.classId).lean(),
      college ? Year.findById(student.yearId).lean() : Section.findById(student.sectionId).lean(),
      FeeCollection.find({ schoolId, studentId: student._id, isDeleted: false })
        .sort({ paidDateBs: -1 })
        .lean(),
      FeeRefund.find({ schoolId, studentId: student._id, isDeleted: false })
        .sort({ dateBs: -1 })
        .lean(),
      StudentScholarshipAward.find({
        schoolId,
        studentId: student._id,
        isDeleted: false
      })
        .sort({ createdAt: -1 })
        .lean()
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

  const activeAwards = scholarshipAwards.filter((a) => a.status !== "REVOKED");
  const yearWise = buildProgramYearFeeSummary(
    collections as unknown as Array<Record<string, unknown>>,
    activeAwards as unknown as Array<Record<string, unknown>>
  );

  const scholarshipStatus =
    activeAwards.length > 0
      ? activeAwards
          .map(
            (a) =>
              `Topped ${YEAR_LABELS[a.toppedProgramYear] ?? a.toppedProgramYear} → ${YEAR_LABELS[a.coversProgramYear] ?? a.coversProgramYear} scholarship`
          )
          .join("; ")
      : totalScholarship > 0
        ? "Scholarship Applied"
        : "None";

  return sendSuccess(res, "Student financial history fetched", {
    student,
    className: college ? "" : (primaryDoc?.name ?? ""),
    sectionName: college ? "" : (secondaryDoc?.name ?? ""),
    batchName: college ? (primaryDoc?.name ?? "") : undefined,
    yearName: college ? (secondaryDoc?.name ?? "") : undefined,
    guardianName: student.guardianName,
    scholarshipStatus,
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
    dueInstallments,
    yearWise,
    scholarshipAwards: scholarshipAwards.map((a) => ({
      _id: a._id.toString(),
      schoolId: schoolId.toString(),
      studentId: a.studentId.toString(),
      toppedProgramYear: a.toppedProgramYear,
      coversProgramYear: a.coversProgramYear,
      academicYearBs: a.academicYearBs || undefined,
      examName: a.examName || undefined,
      rank: a.rank ?? undefined,
      waiverType: a.waiverType as "FULL" | "PARTIAL",
      amountNpr: a.amountNpr ?? 0,
      reason: a.reason || undefined,
      status: a.status as "ACTIVE" | "APPLIED" | "REVOKED",
      feeCollectionId: a.feeCollectionId?.toString(),
      notes: a.notes || undefined,
      createdAt: a.createdAt?.toISOString?.() ?? undefined
    }))
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
  const { assertFiscalPeriodOpen } = await import("../utils/fiscalYear.js");
  await assertFiscalPeriodOpen(schoolId, payload.paidDateBs);

  const settings = await getOrCreateSettings(schoolId);
  const studentExists = await Student.findOne({ _id: payload.studentId, schoolId }).select("_id").lean();
  if (!studentExists) throw new ApiError(404, "Student not found");

  let structure = null;
  if (payload.feeStructureId) {
    structure = await FeeStructure.findOne({ _id: payload.feeStructureId, schoolId });
    if (!structure) throw new ApiError(404, "Fee structure not found");
  }

  const currentChargesNpr = payload.currentChargesNpr || structure?.amountNpr || 0;
  const accountantName = await getActorName(req);
  const feeBreakdown =
    payload.feeBreakdown.length > 0
      ? payload.feeBreakdown
      : structure
        ? [{ feeType: structure.feeType, title: structure.title, amountNpr: currentChargesNpr }]
        : [];

  const fiscalYearBs = getFiscalYearFromBsDate(payload.paidDateBs, settings.currentFiscalYearBs);
  const paymentMethod = payload.paymentMethod ?? settings.defaultPaymentMethod;

  const collection = await withFinancialTransaction(async (session) => {
    // Reload student inside the transaction to reduce lost-update races on feesDueNpr
    const studentQuery = Student.findOne({ _id: payload.studentId, schoolId });
    if (session) studentQuery.session(session);
    const student = await studentQuery;
    if (!student) throw new ApiError(404, "Student not found");

    const previousDueNpr = student.feesDueNpr ?? 0;
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

    const receiptCountQuery = FeeCollection.countDocuments({ schoolId });
    if (session) receiptCountQuery.session(session);
    const receiptCount = await receiptCountQuery;
    // Random suffix reduces duplicate receipt numbers under concurrent cashiers
    const receiptNumber =
      payload.receiptNumber?.trim() ||
      (settings.autoReceiptNumber
        ? `${generateReceiptNumber(settings.receiptPrefix, receiptCount + 1)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
        : `RCPT-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`);

    const verificationCode = generateReceiptVerificationCode(
      schoolId.toString(),
      receiptNumber,
      payload.amountPaidNpr,
      payload.paidDateBs
    );

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
          programYear: payload.programYear,
          previousDueNpr,
          currentChargesNpr,
          amountPaidNpr: payload.amountPaidNpr,
          discountNpr: payload.discountNpr,
          scholarshipNpr: payload.scholarshipNpr,
          scholarshipType: payload.scholarshipType ?? "NONE",
          lateFeeNpr,
          advancePaymentNpr: totals.advancePaymentNpr,
          remainingDueNpr: totals.remainingDueNpr,
          paymentMethod,
          bankAccountId: payload.bankAccountId,
          transactionNumber: payload.transactionNumber,
          verificationCode,
          feeBreakdown,
          attachments: payload.attachments ?? [],
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

    // Mark linked topper scholarship as APPLIED when payment used it
    if (payload.scholarshipAwardId && (payload.scholarshipNpr ?? 0) > 0) {
      await StudentScholarshipAward.findOneAndUpdate(
        {
          _id: payload.scholarshipAwardId,
          schoolId,
          studentId: payload.studentId,
          isDeleted: false
        },
        {
          status: "APPLIED",
          feeCollectionId: created._id
        },
        session ? { session } : undefined
      );
    }

    // Replay all collections for authoritative outstanding balance (handles concurrent cashiers better)
    await recalculateStudentFeesDue(payload.studentId, schoolId, session);

    await recordCashEntry(
      req,
      {
        dateBs: payload.paidDateBs,
        entryType: "CREDIT",
        category: "Fee Collection",
        description: `Fee receipt ${receiptNumber}`,
        amountNpr: payload.amountPaidNpr,
        paymentMethod,
        referenceType: "FeeCollection",
        referenceId: created._id.toString(),
        bankAccountId: payload.bankAccountId
      },
      session
    );

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
      paymentMethod,
      bankAccountId: payload.bankAccountId,
      receiptNumber,
      feeBreakdown,
      session
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

/** Record topper scholarship: topped year N finals → waive year N+1 fees. */
export const createStudentScholarshipAward = asyncHandler(async (req: Request, res: Response) => {
  const payload = studentScholarshipAwardSchema.parse(req.body);
  const schoolId = tenantObjectId(req);
  const student = await Student.findOne({ _id: payload.studentId, schoolId }).select("_id").lean();
  if (!student) throw new ApiError(404, "Student not found");

  const coversProgramYear =
    payload.coversProgramYear ??
    (payload.toppedProgramYear < 3 ? payload.toppedProgramYear + 1 : payload.toppedProgramYear);

  if (coversProgramYear === payload.toppedProgramYear && !payload.coversProgramYear) {
    // default is next year; if already year 3, still allow covering year 3 only if explicit
  }

  const existing = await StudentScholarshipAward.findOne({
    schoolId,
    studentId: payload.studentId,
    coversProgramYear,
    isDeleted: false,
    status: { $in: ["ACTIVE", "APPLIED"] }
  }).lean();
  if (existing) {
    throw new ApiError(
      400,
      `An active scholarship already covers ${YEAR_LABELS[coversProgramYear] ?? `year ${coversProgramYear}`} for this student`
    );
  }

  const created = await StudentScholarshipAward.create({
    schoolId,
    studentId: payload.studentId,
    toppedProgramYear: payload.toppedProgramYear,
    coversProgramYear,
    academicYearBs: payload.academicYearBs ?? "",
    examName: payload.examName ?? "",
    rank: payload.rank,
    waiverType: payload.waiverType,
    amountNpr: payload.amountNpr ?? 0,
    reason:
      payload.reason?.trim() ||
      `Topped ${YEAR_LABELS[payload.toppedProgramYear]} final examination — scholarship for ${YEAR_LABELS[coversProgramYear]}`,
    notes: payload.notes ?? "",
    status: "ACTIVE",
    createdBy: req.user!.userId
  });

  await recordAudit(req, {
    action: "accounting.scholarship.award",
    entity: "StudentScholarshipAward",
    entityId: created._id.toString(),
    after: created
  });

  return sendSuccess(
    res,
    `Scholarship recorded: ${YEAR_LABELS[coversProgramYear]} fee waiver (topped ${YEAR_LABELS[payload.toppedProgramYear]})`,
    created,
    201
  );
});

export const listStudentScholarshipAwards = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const filter: Record<string, unknown> = { schoolId, isDeleted: false };
  if (typeof req.query.studentId === "string" && req.query.studentId) {
    filter.studentId = req.query.studentId;
  }
  const rows = await StudentScholarshipAward.find(filter)
    .populate({ path: "studentId", populate: { path: "user", select: "fullName" } })
    .sort({ createdAt: -1 })
    .lean();
  return sendSuccess(res, "Scholarship awards fetched", rows);
});

export const revokeStudentScholarshipAward = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const award = await StudentScholarshipAward.findOne({
    _id: req.params.id,
    schoolId,
    isDeleted: false
  });
  if (!award) throw new ApiError(404, "Scholarship award not found");
  if (award.status === "APPLIED") {
    throw new ApiError(
      400,
      "This scholarship was already applied on a fee receipt. Reverse that receipt before revoking."
    );
  }
  award.status = "REVOKED";
  await award.save();
  await recordAudit(req, {
    action: "accounting.scholarship.revoke",
    entity: "StudentScholarshipAward",
    entityId: award._id.toString(),
    after: { status: "REVOKED" }
  });
  return sendSuccess(res, "Scholarship award revoked", award);
});

export const updateAccountingFeeCollection = asyncHandler(async (req: Request, res: Response) => {
  const payload = enhancedFeeCollectionSchema.partial().parse(req.body);
  const schoolId = tenantObjectId(req);
  const existing = await FeeCollection.findOne({ _id: req.params.id, schoolId, isDeleted: false });
  if (!existing) throw new ApiError(404, "Fee collection not found");

  // Posted collections cannot change money fields without reverse + re-collect
  const moneyFieldsChanged =
    (payload.amountPaidNpr !== undefined && payload.amountPaidNpr !== existing.amountPaidNpr) ||
    (payload.currentChargesNpr !== undefined && payload.currentChargesNpr !== existing.currentChargesNpr) ||
    (payload.discountNpr !== undefined && payload.discountNpr !== existing.discountNpr) ||
    (payload.scholarshipNpr !== undefined && payload.scholarshipNpr !== existing.scholarshipNpr) ||
    (payload.lateFeeNpr !== undefined && payload.lateFeeNpr !== existing.lateFeeNpr) ||
    (payload.paidDateBs !== undefined && payload.paidDateBs !== existing.paidDateBs);

  if (moneyFieldsChanged) {
    throw new ApiError(
      400,
      "Cannot change payment amounts or date on a posted fee collection. Reverse it and collect again."
    );
  }

  const before = existing.toObject();
  if (payload.notes !== undefined) existing.notes = payload.notes;
  if (payload.transactionNumber !== undefined) existing.transactionNumber = payload.transactionNumber;
  await existing.save();

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

const nextRegisterVoucher = async (
  model: { countDocuments: (filter: Record<string, unknown>) => Promise<number> },
  schoolId: import("mongoose").Types.ObjectId,
  prefix: string
): Promise<string> => {
  const count = await model.countDocuments({ schoolId });
  const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${prefix}-${String(count + 1).padStart(5, "0")}-${suffix}`;
};

export const createExpense = asyncHandler(async (req: Request, res: Response) => {
  const payload = accountingExpenseSchema.parse(req.body);
  ensureValidBsDate(payload.dateBs);
  const schoolId = tenantObjectId(req);
  const { assertFiscalPeriodOpen } = await import("../utils/fiscalYear.js");
  await assertFiscalPeriodOpen(schoolId, payload.dateBs);
  const voucherNumber =
    payload.voucherNumber?.trim() ||
    (await nextRegisterVoucher(AccountingExpense, schoolId, "EXP"));
  const expense = await AccountingExpense.create({
    ...payload,
    vendor: payload.vendor?.trim() || "",
    voucherNumber,
    schoolId,
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
    schoolId,
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
  const before = await AccountingExpense.findOne(withTenantScope(req, { _id: req.params.id, isDeleted: false }));
  if (!before) throw new ApiError(404, "Expense not found");

  // Amount/date/category changes after posting would desync journal/cash — require void + re-enter
  if (
    (payload.amountNpr !== undefined && payload.amountNpr !== before.amountNpr) ||
    (payload.dateBs !== undefined && payload.dateBs !== before.dateBs) ||
    (payload.paymentMethod !== undefined && payload.paymentMethod !== before.paymentMethod) ||
    (payload.category !== undefined && payload.category !== before.category)
  ) {
    throw new ApiError(
      400,
      "Cannot change amount, date, category, or payment method on a posted expense. Void it and create a new entry."
    );
  }

  const expense = await AccountingExpense.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id, isDeleted: false }),
    payload,
    { new: true }
  );
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
  const schoolId = tenantObjectId(req);
  const totalAmountNpr = payload.quantity * payload.unitPriceNpr;
  const voucherNumber =
    payload.voucherNumber?.trim() ||
    (await nextRegisterVoucher(AccountingPurchase, schoolId, "PUR"));
  const purchase = await AccountingPurchase.create({
    ...payload,
    totalAmountNpr,
    voucherNumber,
    schoolId,
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
  const before = await AccountingPurchase.findOne(
    withTenantScope(req, { _id: req.params.id, isDeleted: false })
  );
  if (!before) throw new ApiError(404, "Purchase not found");

  // Posted purchase amounts/date/vendor/category must not change — journal would desync
  if (
    (payload.quantity !== undefined && payload.quantity !== before.quantity) ||
    (payload.unitPriceNpr !== undefined && payload.unitPriceNpr !== before.unitPriceNpr) ||
    (payload.purchaseDateBs !== undefined && payload.purchaseDateBs !== before.purchaseDateBs) ||
    (payload.category !== undefined && payload.category !== before.category) ||
    (payload.vendor !== undefined && payload.vendor !== before.vendor)
  ) {
    throw new ApiError(
      400,
      "Cannot change quantity, price, date, category, or vendor on a posted purchase. Void it and create a new entry."
    );
  }

  if (before.paymentStatus === "PAID" && payload.paymentStatus && payload.paymentStatus !== "PAID") {
    throw new ApiError(400, "Paid purchases cannot be marked unpaid. Void the purchase if needed.");
  }

  if (
    before.paymentStatus === "PAID" &&
    payload.paymentMethod !== undefined &&
    payload.paymentMethod !== before.paymentMethod
  ) {
    throw new ApiError(400, "Cannot change payment method on a paid purchase.");
  }

  const quantity = payload.quantity ?? before.quantity;
  const unitPriceNpr = payload.unitPriceNpr ?? before.unitPriceNpr;
  const purchase = await AccountingPurchase.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id, isDeleted: false }),
    { ...payload, totalAmountNpr: quantity * unitPriceNpr },
    { new: true }
  );

  const wasPaid = before.paymentStatus === "PAID";
  const isPaid = (purchase?.paymentStatus ?? before.paymentStatus) === "PAID";
  if (!wasPaid && isPaid && purchase) {
    const schoolId = tenantObjectId(req);
    const userId = req.user!.userId as unknown as import("mongoose").Types.ObjectId;

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

    // Settle AP from original pending purchase journal
    await postPurchasePaymentJournal({
      schoolId,
      userId,
      purchaseId: purchase._id,
      dateBs: purchase.purchaseDateBs,
      amountNpr: purchase.totalAmountNpr,
      paymentMethod: purchase.paymentMethod,
      vendor: purchase.vendor
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
  const schoolId = tenantObjectId(req);
  const { assertFiscalPeriodOpen } = await import("../utils/fiscalYear.js");
  await assertFiscalPeriodOpen(schoolId, payload.dateBs);
  const voucherNumber =
    payload.voucherNumber?.trim() ||
    (await nextRegisterVoucher(AccountingIncome, schoolId, "INC"));
  const receiptNumber =
    payload.receiptNumber?.trim() ||
    (await nextRegisterVoucher(AccountingIncome, schoolId, "RCPT"));
  const income = await AccountingIncome.create({
    ...payload,
    voucherNumber,
    receiptNumber,
    schoolId,
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
  const before = await AccountingIncome.findOne(
    withTenantScope(req, { _id: req.params.id, isDeleted: false })
  );
  if (!before) throw new ApiError(404, "Income record not found");

  if (
    (payload.amountNpr !== undefined && payload.amountNpr !== before.amountNpr) ||
    (payload.dateBs !== undefined && payload.dateBs !== before.dateBs) ||
    (payload.paymentMethod !== undefined && payload.paymentMethod !== before.paymentMethod) ||
    (payload.category !== undefined && payload.category !== before.category)
  ) {
    throw new ApiError(
      400,
      "Cannot change amount, date, category, or payment method on posted income. Void it and create a new entry."
    );
  }

  const record = await AccountingIncome.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id, isDeleted: false }),
    payload,
    { new: true }
  );
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
  const salaries = await SalaryPayment.find(withTenantScope(req, { isDeleted: false }))
    .populate({ path: "teacherId", populate: { path: "user", select: "-password designation" } })
    .populate("staffId")
    .sort({ monthBs: -1, createdAt: -1 })
    .lean();

  const normalized = salaries.map((salary) => {
    const staffRef = salary.staffId as
      | {
          _id?: { toString(): string };
          fullName?: string;
          staffId?: string;
          department?: string;
          designation?: string;
        }
      | string
      | null
      | undefined;
    const teacherRef = salary.teacherId as
      | {
          _id?: { toString(): string };
          user?: { fullName?: string; email?: string; designation?: string };
          teacherCode?: string;
        }
      | string
      | null
      | undefined;
    const collegeStaff =
      staffRef && typeof staffRef === "object" && "fullName" in staffRef
        ? {
            _id: staffRef._id?.toString() ?? "",
            fullName: staffRef.fullName ?? "",
            staffId: staffRef.staffId,
            department: staffRef.department,
            designation: staffRef.designation
          }
        : undefined;
    const teacher =
      teacherRef && typeof teacherRef === "object" && teacherRef.user
        ? {
            _id: teacherRef._id?.toString() ?? "",
            user: teacherRef.user,
            teacherCode: teacherRef.teacherCode
          }
        : undefined;

    const employeeName =
      salary.staffName ||
      collegeStaff?.fullName ||
      teacher?.user?.fullName ||
      "—";
    const department = collegeStaff?.department || "";
    const designation =
      collegeStaff?.designation || teacher?.user?.designation || "";

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
      employeeName,
      department,
      designation,
      createdBy: salary.createdBy.toString()
    };
  });

  return sendSuccess(res, "Salary payments fetched", normalized);
});

export const createSalary = asyncHandler(async (req: Request, res: Response) => {
  const payload = salaryPaymentSchema.parse(req.body);
  const schoolId = tenantObjectId(req);
  const netSalaryNpr = calculateNetSalary(payload);

  // Prevent duplicate month payslip for same employee
  const dupFilter: Record<string, unknown> = {
    schoolId,
    monthBs: payload.monthBs,
    isDeleted: false
  };
  if (payload.employeeType === "TEACHER" && payload.teacherId) {
    dupFilter.teacherId = payload.teacherId;
  } else if (payload.staffId) {
    dupFilter.staffId = payload.staffId;
  }
  const existingMonth = await SalaryPayment.findOne(dupFilter).lean();
  if (existingMonth) {
    throw new ApiError(
      409,
      `A salary record already exists for this employee for ${payload.monthBs}. Edit that record instead.`
    );
  }

  if (payload.status === "PAID" && payload.paidDateBs) {
    const { assertFiscalPeriodOpen } = await import("../utils/fiscalYear.js");
    await assertFiscalPeriodOpen(schoolId, payload.paidDateBs);
  }

  const salary = await SalaryPayment.create({
    schoolId,
    employeeType: payload.employeeType,
    teacherId: payload.teacherId,
    staffId: payload.staffId,
    staffName: payload.staffName ?? "",
    monthBs: payload.monthBs,
    basicSalaryNpr: payload.basicSalaryNpr,
    allowancesNpr: payload.allowancesNpr,
    bonusNpr: payload.bonusNpr,
    advanceSalaryNpr: payload.advanceSalaryNpr,
    loanDeductionNpr: payload.loanDeductionNpr,
    taxNpr: payload.taxNpr,
    otherDeductionsNpr: payload.otherDeductionsNpr,
    netSalaryNpr,
    status: payload.status,
    paidDateBs: payload.paidDateBs || undefined,
    paymentMethod: payload.paymentMethod,
    transactionNumber: payload.transactionNumber ?? "",
    notes: payload.notes ?? "",
    attachments: payload.attachments ?? [],
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
      schoolId,
      userId: req.user!.userId as unknown as import("mongoose").Types.ObjectId,
      salaryId: salary._id,
      dateBs: payload.paidDateBs,
      amountNpr: netSalaryNpr,
      paymentMethod: payload.paymentMethod,
      monthBs: payload.monthBs
    });
  }

  await recordAudit(req, {
    action: "accounting.salary.create",
    entity: "SalaryPayment",
    entityId: salary._id.toString(),
    after: salary
  });
  return sendSuccess(res, "Salary payment recorded", salary, 201);
});

export const updateSalary = asyncHandler(async (req: Request, res: Response) => {
  const payload = salaryPaymentSchema.partial().parse(req.body);
  const existing = await SalaryPayment.findOne(
    withTenantScope(req, { _id: req.params.id, isDeleted: false })
  );
  if (!existing) throw new ApiError(404, "Salary payment not found");

  if (existing.status === "PAID" && payload.status && payload.status !== "PAID") {
    throw new ApiError(400, "Paid salary slips cannot change status. Void via reverse workflow if needed.");
  }

  const merged = { ...existing.toObject(), ...payload };
  const netSalaryNpr = calculateNetSalary(merged as Parameters<typeof calculateNetSalary>[0]);
  const before = existing.toObject();
  const salary = await SalaryPayment.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id }),
    {
      ...payload,
      netSalaryNpr,
      ...(payload.transactionNumber !== undefined
        ? { transactionNumber: payload.transactionNumber }
        : {}),
      ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
      ...(payload.attachments !== undefined ? { attachments: payload.attachments } : {})
    },
    { new: true }
  );

  const wasPaid = before.status === "PAID";
  const isPaid = (salary?.status ?? before.status) === "PAID";
  const paidDateBs = salary?.paidDateBs || payload.paidDateBs;
  if (!wasPaid && isPaid && salary && paidDateBs) {
    const schoolId = tenantObjectId(req);
    const { assertFiscalPeriodOpen } = await import("../utils/fiscalYear.js");
    await assertFiscalPeriodOpen(schoolId, paidDateBs);

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

    await postSalaryJournal({
      schoolId,
      userId: req.user!.userId as unknown as import("mongoose").Types.ObjectId,
      salaryId: salary._id,
      dateBs: paidDateBs,
      amountNpr: netSalaryNpr,
      paymentMethod: salary.paymentMethod,
      monthBs: salary.monthBs
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

/** BS month filter YYYY-MM — reject free-form input to prevent regex injection. */
const monthDateFilter = (monthBs?: string): Record<string, unknown> | undefined => {
  if (!monthBs || !/^\d{4}-\d{2}$/.test(monthBs)) return undefined;
  return { $regex: `^${monthBs}` };
};

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
    case "refunds": {
      const filter: Record<string, unknown> = { schoolId, isDeleted: false };
      const monthFilter = monthDateFilter(monthBs);
      if (monthFilter) filter.dateBs = monthFilter;
      const refunds = await FeeRefund.find(filter)
        .populate({ path: "studentId", populate: { path: "user", select: "-password" } })
        .sort({ dateBs: -1 })
        .lean();
      data = refunds.map((row) => {
        const student = row.studentId as
          | { admissionNumber?: string; user?: { fullName?: string } }
          | null
          | undefined;
        return {
          ...row,
          studentName: student?.user?.fullName ?? "—",
          admissionNumber: student?.admissionNumber ?? "—",
          approvedByName: row.approvedBy?.trim() || "—"
        };
      });
      break;
    }
    case "journal": {
      const filter: Record<string, unknown> = { schoolId, isDeleted: false };
      const monthFilter = monthDateFilter(monthBs);
      if (monthFilter) filter.dateBs = monthFilter;
      data = await JournalEntry.find(filter).sort({ dateBs: -1, createdAt: -1 }).limit(1000).lean();
      break;
    }
    case "ledger": {
      const filter: Record<string, unknown> = { schoolId, isDeleted: false };
      const monthFilter = monthDateFilter(monthBs);
      if (monthFilter) filter.dateBs = monthFilter;
      const accountCode =
        typeof req.query.accountCode === "string" ? req.query.accountCode.trim() : "";
      const entries = await JournalEntry.find(filter).sort({ dateBs: 1, createdAt: 1 }).limit(2000).lean();
      const lines: Array<Record<string, unknown>> = [];
      let running = 0;
      for (const entry of entries) {
        for (const line of entry.lines ?? []) {
          if (accountCode && line.accountCode !== accountCode) continue;
          running += (line.debitNpr ?? 0) - (line.creditNpr ?? 0);
          lines.push({
            dateBs: entry.dateBs,
            voucherNumber: entry.voucherNumber,
            accountCode: line.accountCode,
            accountName: line.accountName,
            narration: line.description || entry.narration,
            debitNpr: line.debitNpr,
            creditNpr: line.creditNpr,
            runningBalanceNpr: running,
            referenceType: entry.referenceType
          });
        }
      }
      data = lines.reverse();
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
        SalaryPayment.find({ schoolId, monthBs, status: "PAID" })
          .populate({ path: "teacherId", populate: { path: "user", select: "-password" } })
          .populate("staffId")
          .sort({ monthBs: -1 })
          .lean(),
        Student.find({ schoolId, feesDueNpr: { $gt: 0 } }).select("feesDueNpr").lean()
      ]);

      const feeCollectionNpr = sumAmount(fees, "amountPaidNpr");
      const incomeNpr = sumAmount(income, "amountNpr");
      const expenseNpr = sumAmount(expenses, "amountNpr");
      // Cash-basis summary: only paid purchases count as outflow
      const paidPurchases = purchases.filter((p) => p.paymentStatus === "PAID");
      const purchaseNpr = sumAmount(paidPurchases, "totalAmountNpr");
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
    req,
    accountKind: "STAFF"
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
  const previousAccountantPhoto = accountant.photoUrl;
  if (payload.photoUrl !== undefined) accountant.photoUrl = payload.photoUrl;

  await user.save();
  await accountant.save();

  if (payload.photoUrl !== undefined) {
    const { deleteReplacedMedia } = await import("../utils/mediaCleanup.js");
    await deleteReplacedMedia(previousAccountantPhoto, accountant.photoUrl);
  }

  const updated = await Accountant.findById(accountant._id).populate("user", "-password");
  await recordAudit(req, { action: "accounting.accountant.update", entity: "Accountant", entityId: accountant._id.toString(), before, after: updated });
  return sendSuccess(res, "Accountant updated", updated);
});

export const deleteAccountant = asyncHandler(async (req: Request, res: Response) => {
  const accountant = await Accountant.findOne(withTenantScope(req, { _id: req.params.id, isDeleted: false }));
  if (!accountant) throw new ApiError(404, "Accountant not found");

  const photoToDelete = accountant.photoUrl;
  accountant.isDeleted = true;
  accountant.status = "INACTIVE";
  accountant.photoUrl = undefined;
  await accountant.save();

  await User.findByIdAndUpdate(accountant.user, { isActive: false });
  if (photoToDelete) {
    const { deleteStoredMediaUrl } = await import("../utils/mediaCleanup.js");
    await deleteStoredMediaUrl(photoToDelete);
  }
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
    emailType: "PASSWORD_RESET",
    accountKind: "STAFF"
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
    Teacher.find(withTenantScope(req))
      .populate("user", "-password")
      .sort({ createdAt: -1 })
      .lean(),
    CollegeStaff.find(withTenantScope(req, { isDeleted: false, status: "ACTIVE" }))
      .sort({ fullName: 1 })
      .lean()
  ]);

  // Prefer active teachers with login (isActive !== false)
  const teachersOut = teachers
    .filter((t) => {
      const user = t.user as { isActive?: boolean } | null;
      if (user && user.isActive === false) return false;
      if (String(t.teacherCode || "").includes("__deleted__")) return false;
      const status = (t as { status?: string }).status;
      if (status === "INACTIVE") return false;
      return true;
    })
    .map((t) => ({
      _id: t._id.toString(),
      teacherCode: t.teacherCode,
      basicSalaryNpr: t.basicSalaryNpr ?? 0,
      user: t.user,
      designation: (t.user as { designation?: string } | null)?.designation
    }));

  const staffOut = collegeStaff.map((s) => ({
    _id: s._id.toString(),
    staffId: s.staffId,
    fullName: s.fullName,
    department: s.department ?? "",
    designation: s.designation ?? "",
    basicSalaryNpr: s.basicSalaryNpr ?? 0
  }));

  return sendSuccess(res, "Salary employees fetched", {
    teachers: teachersOut,
    collegeStaff: staffOut
  });
});