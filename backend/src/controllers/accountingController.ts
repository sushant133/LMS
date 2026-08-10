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
  salarySheetSaveSchema,
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
  assertStudentLoginActive,
  filterLoginActiveStudents
} from "../utils/studentLoginAccess.js";
import {
  applyScholarshipAwardToYearCollections,
  buildProgramYearFeeSummary,
  calculateFeeTotals,
  calculateNetSalary,
  capProgramYearChargesNpr,
  computeBalanceAfterEntry,
  computeYearScopedDueSnapshots,
  defaultCoversYearFromTopped,
  ensureActiveScholarshipAwardsApplied,
  filterOutOpeningTuitionCharges,
  PROGRAM_YEAR_LABELS,
  recalculateStudentFeesDue,
  reverseScholarshipAwardFromCollections
} from "../utils/accountingCalculations.js";
import { getLatestCashBalance, recordCashEntry, reverseCashEntry } from "../utils/accountingCashBook.js";
import { getFiscalYearFromBsDate } from "../utils/fiscalYear.js";
import { generateReceiptVerificationCode } from "../utils/receiptVerification.js";
import { nextVoucherNumber, nextVoucherNumberForDate } from "../utils/voucherNumbering.js";
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
import {
  bsToAdDate,
  ensureValidBsDate,
  getTodayBs,
  resolveAdBsDatePair
} from "../utils/nepaliDate.js";
import { withFinancialTransaction } from "../utils/financialTransaction.js";
import { voidFeeCollection, voidWithJournalReversal } from "../utils/accountingVoid.js";
import {
  formatNrsAmountInWords,
  hasAccountingPermission,
  isInstitutionAdmin,
  normalizeUserRole
} from "@phit-erp/shared";
import {
  buildSalarySheet,
  calculateSalarySheetLine
} from "../utils/salarySheetService.js";
import { needsApprovalForAmount } from "./accountingApprovalController.js";
import { FinancialApproval } from "../models/FinancialApproval.js";
import { getUserSecondaryRoles } from "../utils/moduleAccessService.js";
import { z } from "zod";

const reverseReasonSchema = z.object({
  reason: z.string().min(3, "Reason must be at least 3 characters")
});

const emptyToUndef = (value?: string | null): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Super Admin / College Admin only may edit/delete sensitive accounting records
 * (fee payments, salary sheet / payroll, voids that reverse books).
 */
const assertCanEditOrDeleteFeePayment = async (req: {
  user?: { userId: string; role: string };
}): Promise<void> => {
  const role = normalizeUserRole(req.user?.role ?? "");
  if (isInstitutionAdmin(role)) return;
  const secondary = await getUserSecondaryRoles(req.user!.userId);
  if (secondary.some((r) => isInstitutionAdmin(normalizeUserRole(r)))) return;
  throw new ApiError(
    403,
    "Only Super Admin or College Admin can edit or delete this accounting record"
  );
};
import { formatAddressLine } from "../utils/formatAddress.js";
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

/**
 * Display name of the signed-in user recording the entry.
 * Used for fee "Received by" / "Collected By" so Super Admin, College Admin,
 * College Administrator, and Accountant names all appear the same way.
 */
const getActorName = async (req: Request): Promise<string> => {
  if (!req.user?.userId) return "System";
  const user = await User.findById(req.user.userId).select("fullName email").lean();
  const name = user?.fullName?.trim();
  if (name) return name;
  const email = user?.email?.trim();
  if (email) return email;
  return "Staff";
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
    recentDepositCollections,
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
      .populate("staffId", "fullName staffId department designation")
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(),
    AccountingPurchase.find({ schoolId, isDeleted: false }).sort({ createdAt: -1 }).limit(8).lean(),
    FeeRefund.find({ schoolId, isDeleted: false })
      .populate({ path: "studentId", populate: { path: "user", select: "fullName" } })
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(),
    FeeCollection.find({
      schoolId,
      isDeleted: false,
      securityDepositPaidNpr: { $gt: 0 }
    })
      .populate({ path: "studentId", populate: { path: "user", select: "fullName" } })
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(),
    CashBookEntry.find({ schoolId }).sort({ dateBs: -1, createdAt: -1 }).limit(10).lean()
  ]);

  // Real payments only — exclude admission OPEN- plan rows from income / activity
  const paymentCollections = filterOutOpeningTuitionCharges(
    collections as unknown as Array<Record<string, unknown>>
  ) as typeof collections;
  const recentPayments = filterOutOpeningTuitionCharges(
    recentCollections as unknown as Array<Record<string, unknown>>
  ) as typeof recentCollections;

  const totalRegisterExpensesNpr = expenses.reduce((sum, item) => sum + item.amountNpr, 0);
  const totalSalaryPaidNpr = paidSalaries.reduce((sum, item) => sum + (item.netSalaryNpr || 0), 0);
  const totalPurchasesPaidNpr = paidPurchases.reduce((sum, item) => sum + (item.totalAmountNpr || 0), 0);
  const totalRefundsNpr = refunds.reduce((sum, item) => sum + (item.amountNpr || 0), 0);
  const totalOtherIncomeNpr = incomes.reduce((sum, item) => sum + item.amountNpr, 0);
  /** Cash received on a fee receipt = tuition paid + security deposit collected */
  const cashReceivedOnCollection = (item: {
    amountPaidNpr?: number;
    securityDepositPaidNpr?: number;
  }) =>
    (Number(item.amountPaidNpr) || 0) +
    (Number((item as { securityDepositPaidNpr?: number }).securityDepositPaidNpr) || 0);

  // Tuition fee income for cards (exclude OPEN plan rows and security deposit liability)
  const totalTuitionCollectedNpr = paymentCollections.reduce(
    (sum, item) => sum + (item.amountPaidNpr || 0),
    0
  );
  const totalIncomeNpr = totalTuitionCollectedNpr + totalOtherIncomeNpr;
  // Cash-basis outflow for dashboard card
  const totalExpensesNpr =
    totalRegisterExpensesNpr + totalSalaryPaidNpr + totalPurchasesPaidNpr + totalRefundsNpr;

  // Student collections (cash in) include fee + deposit
  const todayCollectionNpr = paymentCollections
    .filter((item) => item.paidDateBs === today)
    .reduce((sum, item) => sum + cashReceivedOnCollection(item), 0);
  const monthlyCollectionNpr = paymentCollections
    .filter((item) => typeof item.paidDateBs === "string" && item.paidDateBs.startsWith(currentMonth))
    .reduce((sum, item) => sum + cashReceivedOnCollection(item), 0);

  const feeByMonth = paymentCollections.reduce<Record<string, number>>((acc, item) => {
    if (typeof item.paidDateBs !== "string" || item.paidDateBs.length < 7) return acc;
    const month = item.paidDateBs.slice(0, 7);
    acc[month] = (acc[month] ?? 0) + cashReceivedOnCollection(item);
    return acc;
  }, {});

  const expenseByCategory = expenses.reduce<Record<string, number>>((acc, item) => {
    acc[item.category] = (acc[item.category] ?? 0) + item.amountNpr;
    return acc;
  }, {});

  // Revenue by type from cash actually received (not OPEN plan charge amounts)
  const revenueByFeeType = paymentCollections.reduce<Record<string, number>>((acc, item) => {
    const paid = Number(item.amountPaidNpr) || 0;
    const deposit = Number((item as { securityDepositPaidNpr?: number }).securityDepositPaidNpr) || 0;
    if (deposit > 0) {
      acc.SECURITY_DEPOSIT = (acc.SECURITY_DEPOSIT ?? 0) + deposit;
    }
    if (paid <= 0) return acc;
    const tuitionLines = (item.feeBreakdown ?? []).filter(
      (b) => String(b.feeType) !== "SECURITY_DEPOSIT"
    );
    const lineTotal = tuitionLines.reduce((s, b) => s + Number(b.amountNpr || 0), 0);
    if (lineTotal > 0) {
      for (const breakdown of tuitionLines) {
        const share = paid * (Number(breakdown.amountNpr || 0) / lineTotal);
        acc[breakdown.feeType] = (acc[breakdown.feeType] ?? 0) + share;
      }
    } else {
      acc.TUITION = (acc.TUITION ?? 0) + paid;
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
    recentCollections: recentPayments,
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
    recentFees: recentPayments.map((c) => {
      const feePaid = Number(c.amountPaidNpr) || 0;
      const depositPaid =
        Number((c as { securityDepositPaidNpr?: number }).securityDepositPaidNpr) || 0;
      const cashTotal = feePaid + depositPaid;
      // Avoid NPR 0.00 on deposit-only receipts; label status clearly
      let status = "PAID";
      if (depositPaid > 0 && feePaid <= 0) status = "DEPOSIT";
      else if (depositPaid > 0 && feePaid > 0) status = "FEE+DEPOSIT";
      return {
        id: c._id.toString(),
        dateBs: c.paidDateBs,
        voucherNo: c.receiptNumber,
        party: studentParty(c),
        amountNpr: cashTotal,
        status,
        linkTab: depositPaid > 0 && feePaid <= 0 ? "deposit-records" : "fee-records"
      };
    }),
    // Align with Salary Sheet / Payroll (not the legacy "Pay Salary" form)
    recentSalaries: recentSalaries.map((s) => {
      const present = Number(s.presentDays ?? 0);
      const absent = Number(s.absentDays ?? 0);
      const salaryAmt = Number(s.salaryAmountNpr ?? 0);
      const net = Number(s.netSalaryNpr ?? 0);
      const typeLabel =
        s.employeeType === "TEACHER"
          ? "Teacher"
          : s.employeeType === "STAFF"
            ? "Staff"
            : "";
      const dayBits = [
        present > 0 || absent > 0 ? `P ${present}` : "",
        absent > 0 ? `A ${absent}` : ""
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        id: s._id.toString(),
        dateBs: s.paidDateBs || s.monthBs,
        /** Payroll month (BS YYYY-MM) — primary reference for the sheet */
        voucherNo: `Payroll ${s.monthBs}`,
        party: salaryParty(s),
        amountNpr: net > 0 ? net : salaryAmt,
        status: s.status,
        linkTab: "salary-records",
        /** Extra fields for dashboard card (sheet-aligned) */
        monthBs: s.monthBs,
        employeeType: s.employeeType,
        presentDays: present,
        absentDays: absent,
        salaryAmountNpr: salaryAmt,
        netSalaryNpr: net,
        detail: [typeLabel, dayBits, s.status]
          .filter(Boolean)
          .join(" · ")
      };
    }),
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
    recentDeposits: recentDepositCollections.map((c) => {
      const depositPaid =
        Number((c as { securityDepositPaidNpr?: number }).securityDepositPaidNpr) || 0;
      const feePaid = Number(c.amountPaidNpr) || 0;
      return {
        id: c._id.toString(),
        dateBs: c.paidDateBs,
        voucherNo: c.receiptNumber,
        party: studentParty(c),
        amountNpr: depositPaid,
        status: feePaid > 0 ? "FEE+DEPOSIT" : "DEPOSIT",
        linkTab: "deposit-records"
      };
    }),
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

  const [studentsRaw, primaryGroups, secondaryGroups, collections] = await Promise.all([
    Student.find({ schoolId }).populate("user", "-password").sort({ rollNumber: 1 }).lean(),
    college ? Batch.find({ schoolId }).lean() : SchoolClass.find({ schoolId }).lean(),
    college ? Year.find({ schoolId }).lean() : Section.find({ schoolId }).lean(),
    FeeCollection.find({ schoolId, isDeleted: false }).lean()
  ]);

  // Hide students whose portal login is disabled (User.isActive === false)
  const students = filterLoginActiveStudents(studentsRaw);

  const primaryMap = new Map(primaryGroups.map((item) => [item._id.toString(), item.name]));
  const secondaryMap = new Map(secondaryGroups.map((item) => [item._id.toString(), item.name]));

  const awards = await StudentScholarshipAward.find({
    schoolId,
    isDeleted: false,
    status: { $in: ["ACTIVE", "APPLIED"] }
  }).lean();

  const accounts = students.map((student) => {
    const sid = student._id.toString();
    const studentCollections = collections.filter(
      (item) => item.studentId != null && String(item.studentId) === sid
    );
    const paymentCollections = filterOutOpeningTuitionCharges(
      studentCollections as unknown as Array<Record<string, unknown>>
    ) as typeof studentCollections;
    const totalPaid = paymentCollections.reduce((sum, item) => sum + item.amountPaidNpr, 0);
    const totalDiscount = paymentCollections.reduce((sum, item) => sum + (item.discountNpr ?? 0), 0);
    const totalScholarship = paymentCollections.reduce(
      (sum, item) => sum + (item.scholarshipNpr ?? 0),
      0
    );
    const lastPayment = paymentCollections
      .filter((c) => typeof c.paidDateBs === "string" && Number(c.amountPaidNpr) > 0)
      .sort((a, b) => b.paidDateBs.localeCompare(a.paidDateBs))[0];
    const studentAwards = awards.filter((a) => a.studentId != null && String(a.studentId) === sid);

    const primaryId = college ? student.batchId?.toString() : student.classId?.toString();
    const secondaryId = college ? student.yearId?.toString() : student.sectionId?.toString();

    const plannedFees = {
      1: Math.max(0, Number((student as { year1FeeNpr?: number }).year1FeeNpr) || 0),
      2: Math.max(0, Number((student as { year2FeeNpr?: number }).year2FeeNpr) || 0),
      3: Math.max(0, Number((student as { year3FeeNpr?: number }).year3FeeNpr) || 0)
    };
    const yearWise = buildProgramYearFeeSummary(
      studentCollections,
      studentAwards,
      plannedFees
    );
    const yearWiseRemaining = yearWise.reduce(
      (s, y) => s + Number(y.remainingNpr || 0),
      0
    );

    return {
      student,
      className: primaryId ? (primaryMap.get(primaryId) ?? "") : "",
      sectionName: secondaryId ? (secondaryMap.get(secondaryId) ?? "") : "",
      previousDueNpr: yearWiseRemaining,
      totalPaidNpr: totalPaid,
      totalDiscountNpr: totalDiscount,
      totalScholarshipNpr: totalScholarship,
      remainingDueNpr: yearWiseRemaining,
      lastPaymentDateBs: lastPayment?.paidDateBs,
      lastPaymentDateAd: (() => {
        if (!lastPayment?.paidDateBs) return undefined;
        const stored = (lastPayment as { paidDateAd?: string }).paidDateAd;
        if (stored) return stored;
        try {
          return bsToAdDate(lastPayment.paidDateBs).dateAd;
        } catch {
          return undefined;
        }
      })(),
      yearWise
    };
  });

  return sendSuccess(res, "Student accounts fetched", accounts);
});

const YEAR_LABELS = PROGRAM_YEAR_LABELS;

export const getStudentFinancialHistory = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);

  // Held deposit only from fee receipts — never treat admission planned amount as paid
  const { syncStudentSecurityDepositHeldFromLedger } = await import(
    "../utils/studentSecurityDeposit.js"
  );
  await syncStudentSecurityDepositHeldFromLedger(req.params.studentId as string, schoolId);

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

  let feeCollections = collections;
  let awardRows = scholarshipAwards as unknown as Array<Record<string, unknown>>;
  const activeBefore = awardRows.filter((a) => a.status !== "REVOKED");
  if (activeBefore.some((a) => a.status === "ACTIVE")) {
    awardRows = await ensureActiveScholarshipAwardsApplied({
      schoolId,
      studentId: student._id.toString(),
      awards: activeBefore
    });
    // Re-load collections + student after ledger apply
    feeCollections = await FeeCollection.find({
      schoolId,
      studentId: student._id,
      isDeleted: false
    })
      .sort({ paidDateBs: -1 })
      .lean();
    const refreshed = await Student.findById(student._id).lean();
    if (refreshed) {
      (student as { feesDueNpr?: number }).feesDueNpr = refreshed.feesDueNpr ?? 0;
    }
    // Keep revoked awards in list for history
    const revoked = scholarshipAwards.filter((a) => a.status === "REVOKED");
    awardRows = [
      ...awardRows,
      ...(revoked as unknown as Array<Record<string, unknown>>)
    ];
  }

  const totalRefunds = refunds.reduce((sum, item) => sum + item.amountNpr, 0);

  const activeAwards = awardRows.filter((a) => a.status !== "REVOKED");
  // Repair inflated dues when opening the fee ledger
  try {
    const repairedDue = await recalculateStudentFeesDue(student._id, schoolId);
    (student as { feesDueNpr?: number }).feesDueNpr = repairedDue;
    feeCollections = await FeeCollection.find({
      schoolId,
      studentId: student._id,
      isDeleted: false
    })
      .sort({ paidDateBs: -1 })
      .lean();
  } catch {
    // Non-blocking
  }

  const totalPaid = feeCollections.reduce((sum, item) => sum + item.amountPaidNpr, 0);
  const totalDiscount = feeCollections.reduce((sum, item) => sum + (item.discountNpr ?? 0), 0);
  const totalScholarship = feeCollections.reduce(
    (sum, item) => sum + (item.scholarshipNpr ?? 0),
    0
  );
  const totalFine = feeCollections.reduce((sum, item) => sum + (item.lateFeeNpr ?? 0), 0);
  const advanceBalance = feeCollections.reduce(
    (sum, item) => sum + (item.advancePaymentNpr ?? 0),
    0
  );

  const dueInstallments = feeCollections
    .filter((c) => c.isInstallment && c.installmentNumber && c.totalInstallments)
    .map((c) => ({
      installmentNumber: c.installmentNumber!,
      totalInstallments: c.totalInstallments!,
      amountNpr: c.amountPaidNpr,
      dueDateBs: c.paidDateBs
    }));

  const plannedFees = {
    1: Math.max(0, Number((student as { year1FeeNpr?: number }).year1FeeNpr) || 0),
    2: Math.max(0, Number((student as { year2FeeNpr?: number }).year2FeeNpr) || 0),
    3: Math.max(0, Number((student as { year3FeeNpr?: number }).year3FeeNpr) || 0)
  };
  const yearWise = buildProgramYearFeeSummary(
    feeCollections as unknown as Array<Record<string, unknown>>,
    activeAwards,
    plannedFees
  );
  const yearWiseRemaining = yearWise.reduce((s, y) => s + Number(y.remainingNpr || 0), 0);

  const scholarshipStatus =
    activeAwards.length > 0
      ? activeAwards
          .map(
            (a) =>
              `Merit in ${YEAR_LABELS[Number(a.toppedProgramYear)] ?? a.toppedProgramYear} → ${YEAR_LABELS[Number(a.coversProgramYear)] ?? a.coversProgramYear} scholarship`
          )
          .join("; ")
      : totalScholarship > 0
        ? "Scholarship Applied"
        : "None";

  const stuDeposit = student as {
    securityDepositExpectedNpr?: number;
    securityDepositNpr?: number;
    securityDepositRefundedNpr?: number;
    securityDepositWaived?: boolean;
  };

  return sendSuccess(res, "Student financial history fetched", {
    student,
    className: college ? "" : (primaryDoc?.name ?? ""),
    sectionName: college ? "" : (secondaryDoc?.name ?? ""),
    batchName: college ? (primaryDoc?.name ?? "") : undefined,
    yearName: college ? (secondaryDoc?.name ?? "") : undefined,
    guardianName: student.guardianName,
    scholarshipStatus,
    // Payable = year plan total (charged); outstanding = remaining after payments
    totalPayableNpr: yearWise.reduce((s, y) => s + Number(y.chargedNpr || 0), 0),
    outstandingDueNpr: yearWiseRemaining,
    totalPaidNpr: totalPaid,
    totalDiscountNpr: totalDiscount,
    totalScholarshipNpr: totalScholarship,
    totalFineNpr: totalFine,
    advanceBalanceNpr: advanceBalance,
    totalRefundsNpr: totalRefunds,
    securityDepositExpectedNpr: Number(stuDeposit.securityDepositExpectedNpr) || 0,
    securityDepositHeldNpr: Number(stuDeposit.securityDepositNpr) || 0,
    securityDepositRefundedNpr: Number(stuDeposit.securityDepositRefundedNpr) || 0,
    securityDepositWaived: Boolean(stuDeposit.securityDepositWaived),
    // Only real payments — admission year-fee plan rows are not payment history
    collections: filterOutOpeningTuitionCharges(
      feeCollections as unknown as Array<Record<string, unknown>>
    ),
    refunds: refunds.map((r) => ({
      _id: r._id.toString(),
      refundNumber: r.refundNumber,
      dateBs: r.dateBs,
      amountNpr: r.amountNpr,
      reason: r.reason
    })),
    dueInstallments,
    yearWise,
    scholarshipAwards: awardRows.map((a) => ({
      _id: String(a._id),
      schoolId: schoolId.toString(),
      studentId: String(a.studentId),
      toppedProgramYear: Number(a.toppedProgramYear),
      coversProgramYear: Number(a.coversProgramYear),
      academicYearBs: (a.academicYearBs as string) || undefined,
      examName: (a.examName as string) || undefined,
      rank: a.rank != null ? Number(a.rank) : undefined,
      waiverType: (a.waiverType as "FULL" | "PARTIAL") || "FULL",
      amountNpr: Number(a.amountNpr ?? 0),
      reason: (a.reason as string) || undefined,
      status: (a.status as "ACTIVE" | "APPLIED" | "REVOKED") || "ACTIVE",
      feeCollectionId: a.feeCollectionId ? String(a.feeCollectionId) : undefined,
      notes: (a.notes as string) || undefined,
      createdAt:
        a.createdAt instanceof Date
          ? a.createdAt.toISOString()
          : typeof a.createdAt === "string"
            ? a.createdAt
            : undefined
    }))
  });
});

export const listFeeReceipts = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const collections = await FeeCollection.find(withTenantScope(req, { isDeleted: false }))
    .populate({
      path: "studentId",
      populate: [
        { path: "user", select: "fullName email phone" },
        { path: "batchId", select: "name" },
        { path: "yearId", select: "name" },
        { path: "classId", select: "name" },
        { path: "sectionId", select: "name" }
      ]
    })
    .sort({ paidDateBs: -1 })
    .lean();

  // Overlay year-scoped remaining (Y1 receipt → Y1 remaining only, not all years).
  // Group all ledger rows (incl. OPEN plan charges) per student, then recompute.
  const awards = await StudentScholarshipAward.find({
    schoolId,
    isDeleted: false,
    status: { $in: ["ACTIVE", "APPLIED"] }
  }).lean();

  const byStudent = new Map<string, Array<Record<string, unknown>>>();
  for (const row of collections) {
    const sid =
      row.studentId && typeof row.studentId === "object" && "_id" in row.studentId
        ? String((row.studentId as { _id: unknown })._id)
        : String(row.studentId ?? "");
    if (!sid) continue;
    const list = byStudent.get(sid) ?? [];
    list.push(row as unknown as Record<string, unknown>);
    byStudent.set(sid, list);
  }

  const remainingById = new Map<
    string,
    { previousDueNpr: number; remainingDueNpr: number }
  >();
  for (const [sid, rows] of byStudent) {
    const studentDoc = rows[0]?.studentId as
      | {
          year1FeeNpr?: number;
          year2FeeNpr?: number;
          year3FeeNpr?: number;
        }
      | undefined;
    const planned = {
      1: Math.max(0, Number(studentDoc?.year1FeeNpr) || 0),
      2: Math.max(0, Number(studentDoc?.year2FeeNpr) || 0),
      3: Math.max(0, Number(studentDoc?.year3FeeNpr) || 0)
    };
    const studentAwards = awards.filter(
      (a) => a.studentId != null && String(a.studentId) === sid
    );
    const snaps = computeYearScopedDueSnapshots(
      rows,
      studentAwards as unknown as Array<Record<string, unknown>>,
      planned
    );
    for (const [id, snap] of snaps) {
      remainingById.set(id, snap);
    }
  }

  const withYearRemaining = collections.map((row) => {
    const snap = remainingById.get(String(row._id));
    if (!snap) return row;
    return {
      ...row,
      previousDueNpr: snap.previousDueNpr,
      remainingDueNpr: snap.remainingDueNpr
    };
  });

  // Hide system OPEN- year-plan rows (fee structure at admission, not payments)
  const paymentsOnly = filterOutOpeningTuitionCharges(
    withYearRemaining as unknown as Array<Record<string, unknown>>
  );
  return sendSuccess(res, "Fee receipts fetched", paymentsOnly);
});

export const collectAccountingFee = asyncHandler(async (req: Request, res: Response) => {
  const payload = enhancedFeeCollectionSchema.parse(req.body);
  const { dateBs: paidDateBs, dateAd: paidDateAd } = resolveAdBsDatePair({
    dateBs: payload.paidDateBs,
    dateAd: payload.paidDateAd
  });

  const schoolId = tenantObjectId(req);
  const { assertFiscalPeriodOpen } = await import("../utils/fiscalYear.js");
  await assertFiscalPeriodOpen(schoolId, paidDateBs);

  const settings = await getOrCreateSettings(schoolId);
  const studentExists = await Student.findOne({ _id: payload.studentId, schoolId }).select("_id").lean();
  if (!studentExists) throw new ApiError(404, "Student not found");
  await assertStudentLoginActive(payload.studentId, schoolId, "recording fee payments");

  let structure = null;
  if (payload.feeStructureId) {
    structure = await FeeStructure.findOne({ _id: payload.feeStructureId, schoolId });
    if (!structure) throw new ApiError(404, "Fee structure not found");
  }

  const currentChargesNpr = payload.currentChargesNpr || structure?.amountNpr || 0;
  const securityDepositPaidNpr = Math.max(0, Number(payload.securityDepositPaidNpr) || 0);
  const accountantName = await getActorName(req);
  let feeBreakdown =
    payload.feeBreakdown.length > 0
      ? [...payload.feeBreakdown]
      : structure
        ? [{ feeType: structure.feeType, title: structure.title, amountNpr: currentChargesNpr }]
        : [];

  // Append security deposit line when collecting deposit with this receipt
  if (securityDepositPaidNpr > 0) {
    const hasDepositLine = feeBreakdown.some(
      (b) => String(b.feeType) === "SECURITY_DEPOSIT"
    );
    if (!hasDepositLine) {
      feeBreakdown = [
        ...feeBreakdown,
        {
          feeType: "SECURITY_DEPOSIT" as const,
          title: "Security / caution deposit",
          amountNpr: securityDepositPaidNpr
        }
      ];
    }
  }

  const fiscalYearBs = getFiscalYearFromBsDate(paidDateBs, settings.currentFiscalYearBs);
  const paymentMethod = payload.paymentMethod ?? settings.defaultPaymentMethod;
  const cashReceivedNpr = (payload.amountPaidNpr || 0) + securityDepositPaidNpr;

  const collection = await withFinancialTransaction(async (session) => {
    // Reload student inside the transaction to reduce lost-update races on feesDueNpr
    const studentQuery = Student.findOne({ _id: payload.studentId, schoolId });
    if (session) studentQuery.session(session);
    const student = await studentQuery;
    if (!student) throw new ApiError(404, "Student not found");

    if (securityDepositPaidNpr > 0) {
      if (student.securityDepositWaived) {
        throw new ApiError(
          400,
          "Security deposit was marked not taken / cancelled for this student. Clear that flag before recording a deposit."
        );
      }
      student.securityDepositNpr =
        (Number(student.securityDepositNpr) || 0) + securityDepositPaidNpr;
      // If expected was never set, adopt first collected amount as expected plan
      if (!(Number(student.securityDepositExpectedNpr) > 0)) {
        student.securityDepositExpectedNpr = student.securityDepositNpr;
      }
      await student.save(session ? { session } : undefined);
    }

    const previousDueNpr = student.feesDueNpr ?? 0;
    // Late fee / fine is disabled for student fee collections.
    const lateFeeNpr = 0;

    // Avoid double-charging: admission OPEN rows already booked year plan fees.
    // Payment "Fee charged" should only add unbilled amount for that program year.
    let effectiveChargesNpr = currentChargesNpr;
    const programYear = payload.programYear;
    if (programYear === 1 || programYear === 2 || programYear === 3) {
      const priorYearQuery = FeeCollection.find({
        schoolId,
        studentId: payload.studentId,
        programYear,
        isDeleted: false
      }).select("currentChargesNpr");
      if (session) priorYearQuery.session(session);
      const priorYearRows = await priorYearQuery.lean();
      const priorCharged = priorYearRows.reduce(
        (s, r) => s + Number(r.currentChargesNpr ?? 0),
        0
      );
      const plannedMap: Record<number, number> = {
        1: Math.max(0, Number(student.year1FeeNpr) || 0),
        2: Math.max(0, Number(student.year2FeeNpr) || 0),
        3: Math.max(0, Number(student.year3FeeNpr) || 0)
      };
      effectiveChargesNpr = capProgramYearChargesNpr({
        programYear,
        requestedChargesNpr: currentChargesNpr,
        priorChargedNpr: priorCharged,
        plannedYearFeeNpr: plannedMap[programYear] ?? 0
      });
    }

    const totals = calculateFeeTotals({
      previousDueNpr,
      currentChargesNpr: effectiveChargesNpr,
      amountPaidNpr: payload.amountPaidNpr,
      discountNpr: payload.discountNpr,
      scholarshipNpr: payload.scholarshipNpr,
      lateFeeNpr
    });

    // Gap-free per-fiscal-year series from VoucherCounter. The old number came from
    // countDocuments() plus a random suffix, which skipped numbers (voided receipts were
    // still counted) and raced between concurrent cashiers.
    const receiptNumber =
      payload.receiptNumber?.trim() ||
      (await nextVoucherNumber({
        schoolId,
        prefix: settings.receiptPrefix,
        fiscalYearBs,
        session
      }));

    const verificationCode = generateReceiptVerificationCode(
      schoolId.toString(),
      receiptNumber,
      cashReceivedNpr,
      paidDateBs
    );

    // Align breakdown with effective (non-duplicated) charges
    let storedBreakdown = feeBreakdown;
    if (effectiveChargesNpr <= 0) {
      storedBreakdown = feeBreakdown.filter(
        (b) => String(b.feeType) === "SECURITY_DEPOSIT"
      );
    } else if (
      effectiveChargesNpr !== currentChargesNpr &&
      storedBreakdown.length > 0
    ) {
      storedBreakdown = storedBreakdown.map((b) =>
        String(b.feeType) === "SECURITY_DEPOSIT"
          ? b
          : { ...b, amountNpr: effectiveChargesNpr }
      );
    }

    const [created] = await FeeCollection.create(
      [
        {
          schoolId,
          studentId: payload.studentId,
          feeStructureId: payload.feeStructureId,
          receiptNumber,
          paidDateBs,
          paidDateAd,
          fiscalYearBs,
          academicYearBs: payload.academicYearBs ?? structure?.academicYearBs,
          semesterBs: payload.semesterBs ?? structure?.semesterBs,
          programYear: payload.programYear,
          previousDueNpr,
          currentChargesNpr: effectiveChargesNpr,
          amountPaidNpr: payload.amountPaidNpr,
          securityDepositPaidNpr,
          discountNpr: payload.discountNpr,
          scholarshipNpr: payload.scholarshipNpr,
          scholarshipType: payload.scholarshipType ?? "NONE",
          lateFeeNpr,
          advancePaymentNpr: totals.advancePaymentNpr,
          remainingDueNpr: totals.remainingDueNpr,
          paymentMethod,
          bankAccountId: payload.bankAccountId,
          transactionNumber: payload.transactionNumber,
          // Always the person recording this payment
          // (Super Admin / College Admin / College Administrator / Accountant)
          receivedByName:
            payload.receivedByName?.trim() || accountantName,
          paidByName: payload.paidByName?.trim() || "",
          verificationCode,
          feeBreakdown: storedBreakdown,
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
    // and rewrite remainingDueNpr on each receipt to that program year's balance only.
    await recalculateStudentFeesDue(payload.studentId, schoolId, session);

    if (cashReceivedNpr > 0) {
      const cashCategory =
        securityDepositPaidNpr > 0 && payload.amountPaidNpr <= 0
          ? "Security Deposit Collection"
          : securityDepositPaidNpr > 0
            ? "Fee Collection + Security Deposit"
            : "Fee Collection";
      await recordCashEntry(
        req,
        {
          dateBs: paidDateBs,
          entryType: "CREDIT",
          category: cashCategory,
          description:
            securityDepositPaidNpr > 0
              ? `Receipt ${receiptNumber} (fee ${payload.amountPaidNpr} + deposit ${securityDepositPaidNpr})`
              : `Fee receipt ${receiptNumber}`,
          amountNpr: cashReceivedNpr,
          paymentMethod,
          referenceType: "FeeCollection",
          referenceId: created._id.toString(),
          bankAccountId: payload.bankAccountId
        },
        session
      );
    }

    await postFeeCollectionJournal({
      schoolId,
      userId: req.user!.userId as unknown as import("mongoose").Types.ObjectId,
      collectionId: created._id,
      studentId: payload.studentId,
      dateBs: paidDateBs,
      amountPaidNpr: payload.amountPaidNpr,
      securityDepositPaidNpr,
      discountNpr: payload.discountNpr,
      scholarshipNpr: payload.scholarshipNpr,
      lateFeeNpr,
      paymentMethod,
      bankAccountId: payload.bankAccountId,
      receiptNumber,
      feeBreakdown,
      session
    });

    // Re-read so remainingDueNpr is the year-scoped value written by recalculate
    const refreshedQuery = FeeCollection.findById(created._id);
    if (session) refreshedQuery.session(session);
    const refreshed = await refreshedQuery;
    return refreshed ?? created;
  });

  await recordAudit(req, {
    action: "accounting.fee.collect",
    entity: "FeeCollection",
    entityId: collection._id.toString(),
    after: collection
  });

  return sendSuccess(
    res,
    securityDepositPaidNpr > 0
      ? "Fee and security deposit recorded successfully"
      : "Fee collected successfully",
    collection,
    201
  );
});

/** Record merit scholarship: merit in Entrance/1st/2nd final → waive next program year fees. */
export const createStudentScholarshipAward = asyncHandler(async (req: Request, res: Response) => {
  const payload = studentScholarshipAwardSchema.parse(req.body);
  const schoolId = tenantObjectId(req);
  const student = await Student.findOne({ _id: payload.studentId, schoolId }).select("_id").lean();
  if (!student) throw new ApiError(404, "Student not found");
  await assertStudentLoginActive(payload.studentId, schoolId, "recording scholarships");

  const coversProgramYear =
    payload.coversProgramYear ?? defaultCoversYearFromTopped(payload.toppedProgramYear);

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

  const toppedLabel = YEAR_LABELS[payload.toppedProgramYear] ?? `Year ${payload.toppedProgramYear}`;
  const coversLabel = YEAR_LABELS[coversProgramYear] ?? `Year ${coversProgramYear}`;
  const examPhrase =
    payload.toppedProgramYear === 0
      ? "Entrance examination"
      : `${toppedLabel} final examination`;

  const created = await StudentScholarshipAward.create({
    schoolId,
    studentId: payload.studentId,
    toppedProgramYear: payload.toppedProgramYear,
    coversProgramYear,
    academicYearBs: payload.academicYearBs ?? "",
    examName: payload.examName ?? (payload.toppedProgramYear === 0 ? "Entrance" : ""),
    rank: payload.rank,
    waiverType: payload.waiverType,
    amountNpr: payload.amountNpr ?? 0,
    reason:
      payload.reason?.trim() ||
      `Merit in ${examPhrase} — scholarship for ${coversLabel}`,
    notes: payload.notes ?? "",
    status: "ACTIVE",
    createdBy: req.user!.userId
  });

  // Zero (or reduce) year fee dues on opening tuition charges for the covered year.
  const applied = await applyScholarshipAwardToYearCollections({
    schoolId,
    studentId: payload.studentId,
    coversProgramYear,
    waiverType: payload.waiverType ?? "FULL",
    amountNpr: payload.amountNpr ?? 0,
    awardId: created._id.toString(),
    scholarshipType: "TOPPER_YEAR_WAIVER"
  });

  if (applied.appliedNpr > 0) {
    created.status = "APPLIED";
    if (applied.collectionIds[0]) {
      created.feeCollectionId = applied
        .collectionIds[0] as unknown as typeof created.feeCollectionId;
    }
    if (payload.waiverType === "FULL" || !payload.waiverType) {
      if (!created.amountNpr) {
        created.amountNpr = applied.appliedNpr;
      }
    }
    await created.save();
  }

  await recordAudit(req, {
    action: "accounting.scholarship.award",
    entity: "StudentScholarshipAward",
    entityId: created._id.toString(),
    after: created
  });

  return sendSuccess(
    res,
    `Merit scholarship recorded: ${coversLabel} fee waiver (based on ${toppedLabel})${
      applied.appliedNpr > 0
        ? ` — NPR ${applied.appliedNpr.toLocaleString("en-NP")} applied; year dues set to zero`
        : ""
    }`,
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
  if (typeof req.query.status === "string" && req.query.status) {
    filter.status = req.query.status;
  }
  const rows = await StudentScholarshipAward.find(filter)
    .populate({
      path: "studentId",
      select: "admissionNumber registrationNumber batchId yearId user",
      populate: [
        { path: "user", select: "fullName email phone" },
        { path: "batchId", select: "name" },
        { path: "yearId", select: "name" }
      ]
    })
    .sort({ createdAt: -1 })
    .lean();
  return sendSuccess(res, "Scholarship awards fetched", rows);
});

export const updateStudentScholarshipAward = asyncHandler(async (req: Request, res: Response) => {
  const payload = studentScholarshipAwardSchema.partial().parse(req.body);
  const schoolId = tenantObjectId(req);
  const award = await StudentScholarshipAward.findOne({
    _id: req.params.id,
    schoolId,
    isDeleted: false
  });
  if (!award) throw new ApiError(404, "Scholarship award not found");
  if (award.status === "REVOKED") {
    throw new ApiError(400, "Cannot edit a revoked scholarship");
  }

  const before = award.toObject();
  const prevCovers = award.coversProgramYear;
  const prevStudentId = award.studentId.toString();

  if (payload.studentId) {
    const student = await Student.findOne({ _id: payload.studentId, schoolId }).select("_id").lean();
    if (!student) throw new ApiError(404, "Student not found");
    await assertStudentLoginActive(payload.studentId, schoolId, "recording scholarships");
    award.studentId = student._id as typeof award.studentId;
  }

  if (payload.toppedProgramYear !== undefined) {
    award.toppedProgramYear = payload.toppedProgramYear;
  }
  if (payload.coversProgramYear !== undefined) {
    award.coversProgramYear = payload.coversProgramYear;
  } else if (payload.toppedProgramYear !== undefined) {
    award.coversProgramYear = defaultCoversYearFromTopped(payload.toppedProgramYear);
  }
  if (payload.academicYearBs !== undefined) award.academicYearBs = payload.academicYearBs ?? "";
  if (payload.examName !== undefined) award.examName = payload.examName ?? "";
  if (payload.rank !== undefined) award.rank = payload.rank;
  if (payload.waiverType !== undefined) award.waiverType = payload.waiverType;
  if (payload.amountNpr !== undefined) award.amountNpr = payload.amountNpr;
  if (payload.notes !== undefined) award.notes = payload.notes ?? "";
  if (payload.reason !== undefined && payload.reason.trim()) {
    award.reason = payload.reason.trim();
  } else {
    const toppedLabel = YEAR_LABELS[award.toppedProgramYear] ?? String(award.toppedProgramYear);
    const coversLabel = YEAR_LABELS[award.coversProgramYear] ?? String(award.coversProgramYear);
    const examPhrase =
      award.toppedProgramYear === 0
        ? "Entrance examination"
        : `${toppedLabel} final examination`;
    award.reason = `Merit in ${examPhrase} — scholarship for ${coversLabel}`;
  }

  // Undo previous ledger application, then re-apply with new settings
  await reverseScholarshipAwardFromCollections({
    schoolId,
    studentId: prevStudentId,
    coversProgramYear: prevCovers,
    feeCollectionId: award.feeCollectionId
  });

  const dup = await StudentScholarshipAward.findOne({
    schoolId,
    studentId: award.studentId,
    coversProgramYear: award.coversProgramYear,
    isDeleted: false,
    status: { $in: ["ACTIVE", "APPLIED"] },
    _id: { $ne: award._id }
  }).lean();
  if (dup) {
    throw new ApiError(
      400,
      `Another active scholarship already covers ${YEAR_LABELS[award.coversProgramYear]} for this student`
    );
  }

  award.status = "ACTIVE";
  award.feeCollectionId = undefined;

  const applied = await applyScholarshipAwardToYearCollections({
    schoolId,
    studentId: award.studentId,
    coversProgramYear: award.coversProgramYear,
    waiverType: award.waiverType ?? "FULL",
    amountNpr: award.amountNpr ?? 0,
    awardId: award._id.toString(),
    scholarshipType: "TOPPER_YEAR_WAIVER"
  });

  if (applied.appliedNpr > 0) {
    award.status = "APPLIED";
    if (applied.collectionIds[0]) {
      award.feeCollectionId = applied
        .collectionIds[0] as unknown as typeof award.feeCollectionId;
    }
    if ((award.waiverType === "FULL" || !award.waiverType) && !award.amountNpr) {
      award.amountNpr = applied.appliedNpr;
    }
  }

  await award.save();

  await recordAudit(req, {
    action: "accounting.scholarship.update",
    entity: "StudentScholarshipAward",
    entityId: award._id.toString(),
    before,
    after: award
  });

  return sendSuccess(res, "Scholarship updated — student fee ledger refreshed", award);
});

export const revokeStudentScholarshipAward = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const award = await StudentScholarshipAward.findOne({
    _id: req.params.id,
    schoolId,
    isDeleted: false
  });
  if (!award) throw new ApiError(404, "Scholarship award not found");
  if (award.status === "REVOKED") {
    throw new ApiError(400, "Scholarship is already revoked");
  }

  const before = award.toObject();

  // Undo scholarship amounts on fee rows so student dues return to payable
  await reverseScholarshipAwardFromCollections({
    schoolId,
    studentId: award.studentId,
    coversProgramYear: award.coversProgramYear,
    feeCollectionId: award.feeCollectionId
  });

  award.status = "REVOKED";
  award.feeCollectionId = undefined;
  await award.save();

  await recordAudit(req, {
    action: "accounting.scholarship.revoke",
    entity: "StudentScholarshipAward",
    entityId: award._id.toString(),
    before,
    after: { status: "REVOKED" }
  });
  return sendSuccess(
    res,
    "Scholarship revoked — student fee dues restored where applicable",
    award
  );
});

export const deleteStudentScholarshipAward = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const award = await StudentScholarshipAward.findOne({
    _id: req.params.id,
    schoolId,
    isDeleted: false
  });
  if (!award) throw new ApiError(404, "Scholarship award not found");

  const before = award.toObject();

  if (award.status !== "REVOKED") {
    await reverseScholarshipAwardFromCollections({
      schoolId,
      studentId: award.studentId,
      coversProgramYear: award.coversProgramYear,
      feeCollectionId: award.feeCollectionId
    });
  }

  award.status = "REVOKED";
  award.isDeleted = true;
  award.feeCollectionId = undefined;
  await award.save();

  await recordAudit(req, {
    action: "accounting.scholarship.delete",
    entity: "StudentScholarshipAward",
    entityId: award._id.toString(),
    before,
    after: { isDeleted: true, status: "REVOKED" }
  });

  return sendSuccess(
    res,
    "Scholarship deleted — student fee ledger corrected",
    award
  );
});

/**
 * Super Admin / College Admin: edit a posted fee payment.
 * Non-financial fields update in place. Money / date / method changes reverse
 * the original journal + cash book lines, re-post with new values, and
 * recalculate the student outstanding balance (profile + ledger).
 */
export const updateAccountingFeeCollection = asyncHandler(async (req: Request, res: Response) => {
  await assertCanEditOrDeleteFeePayment(req);

  const payload = enhancedFeeCollectionSchema.partial().parse(req.body);
  const schoolId = tenantObjectId(req);
  const userId = req.user!.userId as unknown as import("mongoose").Types.ObjectId;
  const existing = await FeeCollection.findOne({
    _id: req.params.id,
    schoolId,
    isDeleted: false
  });
  if (!existing) throw new ApiError(404, "Fee collection not found");

  const settings = await getOrCreateSettings(schoolId);
  if (settings.auditLockDateBs && existing.paidDateBs <= settings.auditLockDateBs) {
    throw new ApiError(403, "This fiscal period is audit-locked. Cannot edit.");
  }

  const before = existing.toObject();

  // Resolve payment date pair if either calendar was sent
  let nextPaidDateBs = existing.paidDateBs;
  let nextPaidDateAd =
    (existing as { paidDateAd?: string }).paidDateAd ||
    (() => {
      try {
        return bsToAdDate(existing.paidDateBs).dateAd;
      } catch {
        return "";
      }
    })();

  if (payload.paidDateBs !== undefined || payload.paidDateAd !== undefined) {
    const pair = resolveAdBsDatePair({
      dateBs: payload.paidDateBs ?? existing.paidDateBs,
      dateAd: payload.paidDateAd ?? nextPaidDateAd
    });
    nextPaidDateBs = pair.dateBs;
    nextPaidDateAd = pair.dateAd;
    await assertFiscalPeriodOpenIfNeeded(schoolId, nextPaidDateBs);
  }

  const nextAmountPaid =
    payload.amountPaidNpr !== undefined ? payload.amountPaidNpr : existing.amountPaidNpr;
  const prevDepositPaid = Math.max(
    0,
    Number((existing as { securityDepositPaidNpr?: number }).securityDepositPaidNpr) || 0
  );
  const nextDepositPaid =
    payload.securityDepositPaidNpr !== undefined
      ? Math.max(0, Number(payload.securityDepositPaidNpr) || 0)
      : prevDepositPaid;
  let nextCharges =
    payload.currentChargesNpr !== undefined
      ? payload.currentChargesNpr
      : existing.currentChargesNpr;
  const nextDiscount =
    payload.discountNpr !== undefined ? payload.discountNpr : existing.discountNpr ?? 0;
  const nextScholarship =
    payload.scholarshipNpr !== undefined
      ? payload.scholarshipNpr
      : existing.scholarshipNpr ?? 0;
  // Late fee / fine disabled for student fee collections
  const nextLateFee = 0;
  const nextPaymentMethod =
    payload.paymentMethod !== undefined ? payload.paymentMethod : existing.paymentMethod;
  const nextBankAccountId =
    payload.bankAccountId !== undefined ? payload.bankAccountId : existing.bankAccountId?.toString();
  type BreakdownLine = { feeType: string; title: string; amountNpr: number };
  const existingBreakdown: BreakdownLine[] = (existing.feeBreakdown ?? []).map((b) => ({
    feeType: String(b.feeType),
    title: String(b.title),
    amountNpr: Number(b.amountNpr) || 0
  }));
  let nextFeeBreakdown: BreakdownLine[] =
    payload.feeBreakdown !== undefined && payload.feeBreakdown.length > 0
      ? payload.feeBreakdown.map((b) => ({
          feeType: String(b.feeType),
          title: String(b.title),
          amountNpr: Number(b.amountNpr) || 0
        }))
      : existingBreakdown;
  // Keep fee breakdown deposit line in sync with securityDepositPaidNpr
  if (nextDepositPaid > 0) {
    const withoutDeposit = nextFeeBreakdown.filter(
      (b) => String(b.feeType) !== "SECURITY_DEPOSIT"
    );
    nextFeeBreakdown = [
      ...withoutDeposit,
      {
        feeType: "SECURITY_DEPOSIT",
        title: "Security / caution deposit",
        amountNpr: nextDepositPaid
      }
    ];
  } else {
    nextFeeBreakdown = nextFeeBreakdown.filter(
      (b) => String(b.feeType) !== "SECURITY_DEPOSIT"
    );
  }
  const nextProgramYear =
    payload.programYear !== undefined ? payload.programYear : existing.programYear;
  const nextScholarshipType =
    payload.scholarshipType !== undefined
      ? payload.scholarshipType
      : existing.scholarshipType ?? "NONE";

  const accountingFieldsChanged =
    nextAmountPaid !== existing.amountPaidNpr ||
    nextDepositPaid !== prevDepositPaid ||
    nextCharges !== existing.currentChargesNpr ||
    nextDiscount !== (existing.discountNpr ?? 0) ||
    nextScholarship !== (existing.scholarshipNpr ?? 0) ||
    nextLateFee !== (existing.lateFeeNpr ?? 0) ||
    nextPaidDateBs !== existing.paidDateBs ||
    nextPaymentMethod !== existing.paymentMethod ||
    (payload.feeBreakdown !== undefined && payload.feeBreakdown.length > 0) ||
    payload.securityDepositPaidNpr !== undefined;

  const updated = await withFinancialTransaction(async (session) => {
    if (accountingFieldsChanged) {
      // Reverse original GL + cash impact (student balance fixed after re-post)
      await reverseJournalEntry(schoolId, userId, "FeeCollection", existing._id);
      await reverseCashEntry(
        req,
        "FeeCollection",
        existing._id.toString(),
        existing.paidDateBs,
        session
      );
    }

    // Cap charges against year plan / other rows so edit cannot re-double OPEN plan
    const programYearForCap =
      payload.programYear !== undefined ? payload.programYear : existing.programYear;
    if (programYearForCap === 1 || programYearForCap === 2 || programYearForCap === 3) {
      const studentPlanQuery = Student.findOne({
        _id: existing.studentId,
        schoolId
      }).select("year1FeeNpr year2FeeNpr year3FeeNpr");
      if (session) studentPlanQuery.session(session);
      const studentForPlan = await studentPlanQuery.lean();
      const priorYearQuery = FeeCollection.find({
        schoolId,
        studentId: existing.studentId,
        programYear: programYearForCap,
        isDeleted: false,
        _id: { $ne: existing._id }
      }).select("currentChargesNpr");
      if (session) priorYearQuery.session(session);
      const priorYearRows = await priorYearQuery.lean();
      const priorCharged = priorYearRows.reduce(
        (s, r) => s + Number(r.currentChargesNpr ?? 0),
        0
      );
      const plannedMap: Record<number, number> = {
        1: Math.max(0, Number(studentForPlan?.year1FeeNpr) || 0),
        2: Math.max(0, Number(studentForPlan?.year2FeeNpr) || 0),
        3: Math.max(0, Number(studentForPlan?.year3FeeNpr) || 0)
      };
      nextCharges = capProgramYearChargesNpr({
        programYear: programYearForCap,
        requestedChargesNpr: nextCharges,
        priorChargedNpr: priorCharged,
        plannedYearFeeNpr: plannedMap[programYearForCap] ?? 0
      });
    }

    // Snapshot previous due for the receipt only (authoritative balance via recalculate after)
    const studentBalQuery = Student.findById(existing.studentId).select("feesDueNpr");
    if (session) studentBalQuery.session(session);
    const studentBal = await studentBalQuery.lean();
    const previousDueNpr = Math.max(0, Number(studentBal?.feesDueNpr ?? 0));

    const totals = calculateFeeTotals({
      previousDueNpr,
      currentChargesNpr: nextCharges,
      amountPaidNpr: nextAmountPaid,
      discountNpr: nextDiscount,
      scholarshipNpr: nextScholarship,
      lateFeeNpr: nextLateFee
    });

    existing.paidDateBs = nextPaidDateBs;
    (existing as { paidDateAd?: string }).paidDateAd = nextPaidDateAd;
    existing.fiscalYearBs = getFiscalYearFromBsDate(
      nextPaidDateBs,
      settings.currentFiscalYearBs
    );
    existing.amountPaidNpr = nextAmountPaid;
    (existing as { securityDepositPaidNpr?: number }).securityDepositPaidNpr =
      nextDepositPaid;
    existing.currentChargesNpr = nextCharges;
    existing.discountNpr = nextDiscount;
    existing.scholarshipNpr = nextScholarship;
    existing.lateFeeNpr = nextLateFee;
    existing.previousDueNpr = previousDueNpr;
    existing.remainingDueNpr = totals.remainingDueNpr;
    existing.advancePaymentNpr = totals.advancePaymentNpr;
    existing.paymentMethod = nextPaymentMethod;
    if (payload.bankAccountId !== undefined) {
      existing.bankAccountId = payload.bankAccountId
        ? (payload.bankAccountId as unknown as typeof existing.bankAccountId)
        : undefined;
    }
    if (payload.transactionNumber !== undefined) {
      existing.transactionNumber = emptyToUndef(payload.transactionNumber) ?? "";
    }
    if (payload.receivedByName !== undefined) {
      (existing as { receivedByName?: string }).receivedByName =
        payload.receivedByName?.trim() || "";
    }
    if (payload.paidByName !== undefined) {
      (existing as { paidByName?: string }).paidByName = payload.paidByName?.trim() || "";
    }
    if (payload.notes !== undefined) existing.notes = payload.notes;
    if (payload.attachments !== undefined) {
      existing.attachments = payload.attachments as typeof existing.attachments;
    }
    if (nextProgramYear !== undefined) existing.programYear = nextProgramYear;
    if (nextScholarshipType) existing.scholarshipType = nextScholarshipType;
    existing.feeBreakdown = nextFeeBreakdown as typeof existing.feeBreakdown;
    if (payload.academicYearBs !== undefined) {
      existing.academicYearBs = emptyToUndef(payload.academicYearBs);
    }
    if (payload.semesterBs !== undefined) {
      existing.semesterBs = emptyToUndef(payload.semesterBs);
    }

    await existing.save(session ? { session } : undefined);

    // Adjust student held deposit when deposit amount on this receipt changes
    if (nextDepositPaid !== prevDepositPaid) {
      const studentQuery = Student.findOne({ _id: existing.studentId, schoolId });
      if (session) studentQuery.session(session);
      const student = await studentQuery;
      if (student) {
        if (nextDepositPaid > 0 && student.securityDepositWaived) {
          throw new ApiError(
            400,
            "Security deposit was marked not taken for this student. Cannot set deposit on this receipt."
          );
        }
        const delta = nextDepositPaid - prevDepositPaid;
        const held = Math.max(0, Number(student.securityDepositNpr) || 0);
        const refunded = Math.max(0, Number(student.securityDepositRefundedNpr) || 0);
        const nextHeld = Math.max(refunded, held + delta);
        student.securityDepositNpr = nextHeld;
        if (nextHeld > 0 && !(Number(student.securityDepositExpectedNpr) > 0)) {
          student.securityDepositExpectedNpr = nextHeld;
        }
        await student.save(session ? { session } : undefined);
      }
    }

    if (accountingFieldsChanged) {
      const cashReceived = nextAmountPaid + nextDepositPaid;
      if (cashReceived > 0) {
        await recordCashEntry(
          req,
          {
            dateBs: nextPaidDateBs,
            entryType: "CREDIT",
            category:
              nextDepositPaid > 0
                ? "Fee Collection + Security Deposit"
                : "Fee Collection",
            description: `Fee receipt ${existing.receiptNumber} (edited)`,
            amountNpr: cashReceived,
            paymentMethod: nextPaymentMethod,
            referenceType: "FeeCollection",
            referenceId: existing._id.toString(),
            bankAccountId: nextBankAccountId
          },
          session
        );
      }

      await postFeeCollectionJournal({
        schoolId,
        userId,
        collectionId: existing._id,
        studentId: existing.studentId,
        dateBs: nextPaidDateBs,
        amountPaidNpr: nextAmountPaid,
        securityDepositPaidNpr: nextDepositPaid,
        discountNpr: nextDiscount,
        scholarshipNpr: nextScholarship,
        lateFeeNpr: nextLateFee,
        paymentMethod: nextPaymentMethod,
        bankAccountId: nextBankAccountId,
        receiptNumber: existing.receiptNumber,
        feeBreakdown: (existing.feeBreakdown ?? []).map((item) => ({
          feeType: item.feeType,
          title: item.title,
          amountNpr: item.amountNpr
        })),
        session
      });
    }

    await recalculateStudentFeesDue(existing.studentId, schoolId, session);
    // Re-read year-scoped remaining after snapshot sync
    const refreshedQuery = FeeCollection.findById(existing._id);
    if (session) refreshedQuery.session(session);
    const refreshed = await refreshedQuery;
    return refreshed ?? existing;
  });

  await recordAudit(req, {
    action: "accounting.fee.update",
    entity: "FeeCollection",
    entityId: existing._id.toString(),
    before,
    after: updated
  });

  return sendSuccess(
    res,
    accountingFieldsChanged
      ? "Fee payment updated — accounts and student balance corrected"
      : "Fee collection updated",
    updated
  );
});

export const reverseFeeCollection = asyncHandler(async (req: Request, res: Response) => {
  await assertCanEditOrDeleteFeePayment(req);

  const payload = reverseReasonSchema.parse(req.body ?? { reason: "Deleted by administrator" });
  const schoolId = tenantObjectId(req);
  const userId = req.user!.userId as unknown as import("mongoose").Types.ObjectId;

  const collection = await FeeCollection.findOne({
    _id: req.params.id,
    schoolId,
    isDeleted: false
  });
  if (!collection) throw new ApiError(404, "Fee collection not found");

  const settings = await getOrCreateSettings(schoolId);
  if (settings.auditLockDateBs && collection.paidDateBs <= settings.auditLockDateBs) {
    throw new ApiError(403, "This fiscal period is audit-locked. Cannot reverse.");
  }

  // Institution admins never need dual approval (needsApprovalForAmount already skips them)
  const requiresApproval = await needsApprovalForAmount(
    schoolId,
    collection.amountPaidNpr,
    req.user!.role,
    req.user!.userId
  );
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

  return sendSuccess(
    res,
    "Fee payment deleted — journal, cash book, and student balance updated"
  );
});

/**
 * Super Admin / College Admin — edit a student's security deposit *plan*
 * (admission expected amount / waived). Does not change held cash from receipts.
 */
export const updateStudentSecurityDepositPlan = asyncHandler(
  async (req: Request, res: Response) => {
    await assertCanEditOrDeleteFeePayment(req);

    const schema = z.object({
      securityDepositExpectedNpr: z.number().min(0).optional(),
      securityDepositWaived: z.boolean().optional()
    });
    const payload = schema.parse(req.body ?? {});
    if (
      payload.securityDepositExpectedNpr === undefined &&
      payload.securityDepositWaived === undefined
    ) {
      throw new ApiError(
        400,
        "Provide securityDepositExpectedNpr and/or securityDepositWaived"
      );
    }

    const schoolId = tenantObjectId(req);
    const student = await Student.findOne(
      withTenantScope(req, { _id: req.params.studentId })
    );
    if (!student) throw new ApiError(404, "Student not found");

    try {
      const { syncStudentSecurityDepositHeldFromLedger } = await import(
        "../utils/studentSecurityDeposit.js"
      );
      await syncStudentSecurityDepositHeldFromLedger(student._id, schoolId);
      const latest = await Student.findById(student._id).select(
        "securityDepositNpr securityDepositRefundedNpr securityDepositExpectedNpr securityDepositWaived"
      );
      if (latest) {
        student.securityDepositNpr = latest.securityDepositNpr;
        student.securityDepositRefundedNpr = latest.securityDepositRefundedNpr;
        student.securityDepositExpectedNpr = latest.securityDepositExpectedNpr;
        student.securityDepositWaived = latest.securityDepositWaived;
      }
    } catch {
      // use in-memory student fields
    }

    const before = {
      securityDepositExpectedNpr: Number(student.securityDepositExpectedNpr) || 0,
      securityDepositNpr: Number(student.securityDepositNpr) || 0,
      securityDepositRefundedNpr: Number(student.securityDepositRefundedNpr) || 0,
      securityDepositWaived: Boolean(student.securityDepositWaived)
    };

    const held = Math.max(0, Number(student.securityDepositNpr) || 0);
    const refunded = Math.max(0, Number(student.securityDepositRefundedNpr) || 0);
    const remainingHeld = Math.max(0, held - refunded);

    const nextWaived =
      payload.securityDepositWaived !== undefined
        ? Boolean(payload.securityDepositWaived)
        : Boolean(student.securityDepositWaived);

    if (nextWaived && remainingHeld > 0.001) {
      throw new ApiError(
        400,
        `Cannot mark deposit as not taken while ${remainingHeld} NPR is still held. Delete deposit receipts or refund first.`
      );
    }

    let nextExpected = nextWaived
      ? 0
      : payload.securityDepositExpectedNpr !== undefined
        ? Math.max(0, Number(payload.securityDepositExpectedNpr) || 0)
        : Math.max(0, Number(student.securityDepositExpectedNpr) || 0);

    // If plan is cleared but money is still held, keep expected at least held so status stays coherent
    if (!nextWaived && nextExpected < remainingHeld - 0.001) {
      // Allow plan lower than held only when explicitly set — still due becomes 0 (overpaid plan)
      // Leave as user requested; stillDue = max(0, expected - held) already handles overpay.
    }

    student.securityDepositWaived = nextWaived;
    student.securityDepositExpectedNpr = nextExpected;
    await student.save();

    const after = {
      securityDepositExpectedNpr: nextExpected,
      securityDepositNpr: held,
      securityDepositRefundedNpr: refunded,
      securityDepositWaived: nextWaived
    };

    await recordAudit(req, {
      action: "accounting.security_deposit.plan_update",
      entity: "Student",
      entityId: String(student._id),
      before,
      after
    });

    return sendSuccess(res, "Student security deposit plan updated", {
      studentId: String(student._id),
      ...after
    });
  }
);

/**
 * Super Admin / College Admin — clear a student's deposit plan from Student status.
 * Held amounts from receipts are never deleted here (use deposit receipt Delete).
 * - If nothing held: zeros plan + clears waived flag
 * - If money held: zeros plan only (held stays); refuse if trying to wipe with held and waived
 */
export const clearStudentSecurityDepositPlan = asyncHandler(
  async (req: Request, res: Response) => {
    await assertCanEditOrDeleteFeePayment(req);

    const payload = reverseReasonSchema.parse(
      req.body ?? { reason: "Deposit plan cleared by administrator" }
    );

    const schoolId = tenantObjectId(req);
    const student = await Student.findOne(
      withTenantScope(req, { _id: req.params.studentId })
    );
    if (!student) throw new ApiError(404, "Student not found");

    try {
      const { syncStudentSecurityDepositHeldFromLedger } = await import(
        "../utils/studentSecurityDeposit.js"
      );
      await syncStudentSecurityDepositHeldFromLedger(student._id, schoolId);
      const latest = await Student.findById(student._id).select(
        "securityDepositNpr securityDepositRefundedNpr securityDepositExpectedNpr securityDepositWaived"
      );
      if (latest) {
        student.securityDepositNpr = latest.securityDepositNpr;
        student.securityDepositRefundedNpr = latest.securityDepositRefundedNpr;
        student.securityDepositExpectedNpr = latest.securityDepositExpectedNpr;
        student.securityDepositWaived = latest.securityDepositWaived;
      }
    } catch {
      // continue
    }

    const before = {
      securityDepositExpectedNpr: Number(student.securityDepositExpectedNpr) || 0,
      securityDepositNpr: Number(student.securityDepositNpr) || 0,
      securityDepositRefundedNpr: Number(student.securityDepositRefundedNpr) || 0,
      securityDepositWaived: Boolean(student.securityDepositWaived)
    };

    const held = Math.max(0, Number(student.securityDepositNpr) || 0);
    const refunded = Math.max(0, Number(student.securityDepositRefundedNpr) || 0);
    const remainingHeld = Math.max(0, held - refunded);
    const hadPlan =
      before.securityDepositExpectedNpr > 0.001 || before.securityDepositWaived;

    if (!hadPlan && remainingHeld <= 0.001) {
      throw new ApiError(400, "No security deposit plan to clear for this student");
    }

    // Clear plan only — never zero held from ledger here
    if (remainingHeld <= 0.001) {
      // No money held: remove plan entirely
      student.securityDepositExpectedNpr = 0;
      student.securityDepositWaived = false;
    } else if (
      before.securityDepositWaived ||
      before.securityDepositExpectedNpr > remainingHeld + 0.001
    ) {
      // Drop waived flag / unpaid plan remainder; align plan with held → status PAID
      student.securityDepositExpectedNpr = remainingHeld;
      student.securityDepositWaived = false;
    } else {
      throw new ApiError(
        400,
        `This student has ${remainingHeld} NPR held from deposit receipts and no extra plan to clear. Delete deposit receipts under Deposit receipts to reverse money.`
      );
    }

    await student.save();

    const after = {
      securityDepositExpectedNpr: Number(student.securityDepositExpectedNpr) || 0,
      securityDepositNpr: held,
      securityDepositRefundedNpr: refunded,
      securityDepositWaived: Boolean(student.securityDepositWaived),
      reason: payload.reason
    };

    await recordAudit(req, {
      action: "accounting.security_deposit.plan_clear",
      entity: "Student",
      entityId: String(student._id),
      before,
      after
    });

    return sendSuccess(
      res,
      remainingHeld > 0.001
        ? "Deposit plan cleared — held amount from receipts is unchanged (delete deposit receipts to reverse money)"
        : "Student security deposit plan cleared",
      {
        studentId: String(student._id),
        ...after
      }
    );
  }
);

/** Ensure fiscal period is open for a BS date (lazy import to avoid circular deps). */
const assertFiscalPeriodOpenIfNeeded = async (
  schoolId: import("mongoose").Types.ObjectId,
  dateBs: string
): Promise<void> => {
  const { assertFiscalPeriodOpen } = await import("../utils/fiscalYear.js");
  await assertFiscalPeriodOpen(schoolId, dateBs);
};

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

  const [classDoc, sectionDoc, studentCollections, studentAwards] = await Promise.all([
    college
      ? Batch.findById(student.batchId).lean()
      : SchoolClass.findById(student.classId).lean(),
    college ? Year.findById(student.yearId).lean() : Section.findById(student.sectionId).lean(),
    FeeCollection.find({
      schoolId,
      studentId: collection.studentId,
      isDeleted: false
    })
      .sort({ createdAt: 1 })
      .lean(),
    StudentScholarshipAward.find({
      schoolId,
      studentId: collection.studentId,
      isDeleted: false,
      status: { $in: ["ACTIVE", "APPLIED"] }
    }).lean()
  ]);

  // Remaining on PDF must match this receipt's program year, not all-years total
  const plannedFees = {
    1: Math.max(0, Number((student as { year1FeeNpr?: number }).year1FeeNpr) || 0),
    2: Math.max(0, Number((student as { year2FeeNpr?: number }).year2FeeNpr) || 0),
    3: Math.max(0, Number((student as { year3FeeNpr?: number }).year3FeeNpr) || 0)
  };
  const yearSnaps = computeYearScopedDueSnapshots(
    studentCollections as unknown as Array<Record<string, unknown>>,
    studentAwards as unknown as Array<Record<string, unknown>>,
    plannedFees
  );
  const yearRemaining =
    yearSnaps.get(String(collection._id))?.remainingDueNpr ??
    Number(collection.remainingDueNpr ?? 0);

  const depositPaid = Math.max(
    0,
    Number((collection as { securityDepositPaidNpr?: number }).securityDepositPaidNpr) || 0
  );
  const feeTitle =
    collection.feeBreakdown?.map((item) => item.title).join(", ") ||
    (depositPaid > 0 && collection.amountPaidNpr <= 0
      ? "Security Deposit"
      : "College Fee");
  const isReprint = (collection.printCount ?? 0) > 0;
  const printAction = isReprint ? "accounting.receipt.reprint" : "accounting.receipt.print";
  const cashTotal = collection.amountPaidNpr + depositPaid;

  collection.printCount = (collection.printCount ?? 0) + 1;
  collection.lastPrintedAt = new Date();
  collection.lastPrintedBy = req.user!.userId as unknown as import("mongoose").Types.ObjectId;
  // Heal stored remaining if it still holds all-years total
  if (Number(collection.remainingDueNpr ?? 0) !== yearRemaining) {
    collection.remainingDueNpr = yearRemaining;
    const prevSnap = yearSnaps.get(String(collection._id));
    if (prevSnap) collection.previousDueNpr = prevSnap.previousDueNpr;
  }
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

  const schoolAddress = formatAddressLine(
    settings?.address ?? (school as { address?: Parameters<typeof formatAddressLine>[0] }).address
  );

  await generateFeeReceiptPDF(
    {
      schoolName: settings?.schoolName ?? school.name,
      schoolNameNp: settings?.schoolNameNp ?? school.nameNp,
      schoolAddress,
      receiptNumber: collection.receiptNumber,
      paidDateBs: collection.paidDateBs,
      studentName: String((student.user as { fullName?: string } | null)?.fullName ?? ""),
      admissionNumber: student.admissionNumber,
      className: classDoc?.name ?? "",
      sectionName: sectionDoc?.name ?? "",
      feeTitle,
      amountPaidNpr: cashTotal,
      discountNpr: collection.discountNpr ?? 0,
      lateFeeNpr: collection.lateFeeNpr ?? 0,
      totalPaid: cashTotal,
      scholarshipNpr: collection.scholarshipNpr ?? 0,
      remainingDueNpr: yearRemaining,
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

/**
 * Voucher number for the expense / purchase / income registers.
 *
 * These used to count the register's own documents and append random characters, so the
 * series was neither sequential nor gap-free and two users saving at once could collide.
 * Each prefix now owns an independent per-fiscal-year counter — which also fixes income
 * records, where `INC` and `RCPT` were both derived from the same document count and so
 * always moved in lockstep.
 */
const nextRegisterVoucher = async (
  schoolId: import("mongoose").Types.ObjectId,
  prefix: string,
  dateBs: string
): Promise<string> => nextVoucherNumberForDate({ schoolId, prefix, dateBs });

export const createExpense = asyncHandler(async (req: Request, res: Response) => {
  const payload = accountingExpenseSchema.parse(req.body);
  ensureValidBsDate(payload.dateBs);
  const schoolId = tenantObjectId(req);
  const { assertFiscalPeriodOpen } = await import("../utils/fiscalYear.js");
  await assertFiscalPeriodOpen(schoolId, payload.dateBs);
  const voucherNumber =
    payload.voucherNumber?.trim() ||
    (await nextRegisterVoucher(schoolId, "EXP", payload.dateBs));
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

  const requiresApproval = await needsApprovalForAmount(
    schoolId,
    expense.amountNpr,
    req.user!.role,
    req.user!.userId
  );
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
  const { assertFiscalPeriodOpen } = await import("../utils/fiscalYear.js");
  await assertFiscalPeriodOpen(schoolId, payload.purchaseDateBs);
  const totalAmountNpr = payload.quantity * payload.unitPriceNpr;
  const voucherNumber =
    payload.voucherNumber?.trim() ||
    (await nextRegisterVoucher(schoolId, "PUR", payload.purchaseDateBs));
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

  const requiresApproval = await needsApprovalForAmount(
    schoolId,
    purchase.totalAmountNpr,
    req.user!.role,
    req.user!.userId
  );
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
    (await nextRegisterVoucher(schoolId, "INC", payload.dateBs));
  // Non-fee income shares the fee receipt series, so every rupee received across the
  // institution is covered by one continuous, gap-free receipt book.
  const settings = await getOrCreateSettings(schoolId);
  const receiptNumber =
    payload.receiptNumber?.trim() ||
    (await nextRegisterVoucher(schoolId, settings.receiptPrefix, payload.dateBs));
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

  const requiresApproval = await needsApprovalForAmount(
    schoolId,
    record.amountNpr,
    req.user!.role,
    req.user!.userId
  );
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
  /**
   * Avoid nested .populate() select quirks (mixed include/exclude projections throw
   * MongoServerError and surface as HTTP 500). Resolve employee names with plain
   * ObjectId lookups instead.
   */
  const salaries = await SalaryPayment.find(withTenantScope(req, { isDeleted: false }))
    .sort({ monthBs: -1, createdAt: -1 })
    .lean();

  const teacherIds = [
    ...new Set(
      salaries
        .map((s) => (s.teacherId ? String(s.teacherId) : ""))
        .filter(Boolean)
    )
  ];
  const staffIds = [
    ...new Set(
      salaries
        .map((s) => (s.staffId ? String(s.staffId) : ""))
        .filter(Boolean)
    )
  ];

  const [teachers, staffRows] = await Promise.all([
    teacherIds.length
      ? Teacher.find({ _id: { $in: teacherIds } })
          .select("teacherCode user basicSalaryNpr")
          .populate({ path: "user", select: "fullName email designation" })
          .lean()
      : Promise.resolve([]),
    staffIds.length
      ? CollegeStaff.find({ _id: { $in: staffIds } })
          .select("fullName staffId department designation basicSalaryNpr")
          .lean()
      : Promise.resolve([])
  ]);

  const teacherById = new Map(
    teachers.map((t) => {
      const user = t.user as
        | { _id?: unknown; fullName?: string; email?: string; designation?: string }
        | null
        | undefined;
      return [
        String(t._id),
        {
          _id: String(t._id),
          teacherCode: t.teacherCode,
          user: user
            ? {
                _id: user._id ? String(user._id) : undefined,
                fullName: user.fullName,
                email: user.email,
                designation: user.designation
              }
            : undefined
        }
      ] as const;
    })
  );
  const staffById = new Map(
    staffRows.map((s) => [
      String(s._id),
      {
        _id: String(s._id),
        fullName: s.fullName ?? "",
        staffId: s.staffId,
        department: s.department,
        designation: s.designation
      }
    ])
  );

  const normalized = salaries.map((salary) => {
    const teacherId = salary.teacherId ? String(salary.teacherId) : undefined;
    const staffId = salary.staffId ? String(salary.staffId) : undefined;
    const teacher = teacherId ? teacherById.get(teacherId) : undefined;
    const collegeStaff = staffId ? staffById.get(staffId) : undefined;

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
      _id: String(salary._id),
      schoolId: salary.schoolId ? String(salary.schoolId) : "",
      teacherId,
      staffId,
      teacher,
      collegeStaff,
      employeeName,
      department,
      designation,
      createdBy: salary.createdBy ? String(salary.createdBy) : "",
      paymentMethod: salary.paymentMethod || "BANK_TRANSFER",
      status: salary.status || "DRAFT",
      attachments: Array.isArray(salary.attachments) ? salary.attachments : []
    };
  });

  return sendSuccess(res, "Salary payments fetched", normalized);
});

const resolvePayrollAmounts = (payload: {
  basicSalaryNpr: number;
  presentDays?: number;
  absentDays?: number;
  extraDuty?: number;
  extraAmountNpr?: number;
  absentDeductionNpr?: number;
  salaryAmountNpr?: number;
  taxNpr?: number;
  allowancesNpr?: number;
  bonusNpr?: number;
  advanceSalaryNpr?: number;
  loanDeductionNpr?: number;
  otherDeductionsNpr?: number;
  workingDaysInMonth?: number;
}) => {
  const useSheet =
    payload.presentDays !== undefined ||
    payload.absentDays !== undefined ||
    payload.extraDuty !== undefined ||
    payload.extraAmountNpr !== undefined ||
    payload.salaryAmountNpr !== undefined;

  if (useSheet) {
    const calc = calculateSalarySheetLine({
      monthlySalaryNpr: payload.basicSalaryNpr,
      presentDays: payload.presentDays ?? 0,
      absentDays: payload.absentDays ?? 0,
      extraDuty: payload.extraDuty ?? 0,
      workingDaysInMonth: payload.workingDaysInMonth ?? 30,
      extraAmountOverrideNpr:
        payload.extraAmountNpr !== undefined &&
        (payload.extraDuty === undefined || payload.extraDuty === 0)
          ? payload.extraAmountNpr
          : undefined
    });
    return {
      absentDeductionNpr: calc.absentDeductionNpr,
      extraAmountNpr: calc.extraAmountNpr,
      salaryAmountNpr: calc.salaryAmountNpr,
      taxNpr: calc.tax1PercentNpr,
      netSalaryNpr: calc.netSalaryNpr
    };
  }

  return {
    absentDeductionNpr: payload.absentDeductionNpr ?? 0,
    extraAmountNpr: payload.extraAmountNpr ?? 0,
    salaryAmountNpr: payload.salaryAmountNpr ?? 0,
    taxNpr: payload.taxNpr ?? 0,
    netSalaryNpr: calculateNetSalary(
      payload as Parameters<typeof calculateNetSalary>[0]
    )
  };
};

export const getSalarySheet = asyncHandler(async (req: Request, res: Response) => {
  const monthBs = String(req.query.monthBs || "").trim();
  if (!/^\d{4}-\d{2}$/.test(monthBs)) {
    throw new ApiError(400, "monthBs is required (YYYY-MM BS)");
  }
  const schoolId = tenantObjectId(req);
  const sheet = await buildSalarySheet({
    schoolId,
    monthBs,
    department: typeof req.query.department === "string" ? req.query.department : "",
    employeeType:
      req.query.employeeType === "TEACHER" || req.query.employeeType === "STAFF"
        ? req.query.employeeType
        : "",
    employeeId: typeof req.query.employeeId === "string" ? req.query.employeeId : "",
    search: typeof req.query.q === "string" ? req.query.q : ""
  });
  return sendSuccess(res, "Salary sheet generated", sheet);
});

export const saveSalarySheet = asyncHandler(async (req: Request, res: Response) => {
  // Entire salary sheet write path is Super Admin / College Admin only
  await assertCanEditOrDeleteFeePayment(req);

  const payload = salarySheetSaveSchema.parse(req.body);
  const schoolId = tenantObjectId(req);
  const userId = req.user!.userId;

  // Admins may save fully manual money columns
  const canManualValues = true;

  // Derive working days from BS calendar for consistent per-day rates
  const [y, m] = payload.monthBs.split("-").map(Number);
  const { getDaysInBsMonth } = await import("../utils/nepaliDate.js");
  const workingDaysInMonth =
    y && m ? getDaysInBsMonth(y, m) : 30;

  if (payload.status === "PAID" && payload.paidDateBs) {
    const { assertFiscalPeriodOpen } = await import("../utils/fiscalYear.js");
    await assertFiscalPeriodOpen(schoolId, payload.paidDateBs);
  }

  const savedIds: string[] = [];

  for (const row of payload.rows) {
    const calc = calculateSalarySheetLine({
      monthlySalaryNpr: row.monthlySalaryNpr,
      presentDays: row.presentDays,
      absentDays: row.absentDays,
      extraDuty: row.extraDuty,
      workingDaysInMonth,
      extraAmountOverrideNpr:
        row.extraAmountNpr !== undefined && row.extraDuty === 0
          ? row.extraAmountNpr
          : undefined
    });

    // Only Super Admin / College Admin may persist manual money overrides
    const useManualValues =
      canManualValues && Boolean(row.valuesManualOverride);
    if (Boolean(row.valuesManualOverride) && !canManualValues) {
      throw new ApiError(
        403,
        "Only Super Admin or College Admin can save manually edited salary amounts"
      );
    }

    const money = useManualValues
      ? {
          absentDeductionNpr: Math.max(0, Number(row.absentDeductionNpr ?? 0)),
          extraAmountNpr: Math.max(0, Number(row.extraAmountNpr ?? 0)),
          salaryAmountNpr: Math.max(0, Number(row.salaryAmountNpr ?? 0)),
          taxNpr: Math.max(0, Number(row.tax1PercentNpr ?? 0)),
          netSalaryNpr: Math.max(0, Number(row.netSalaryNpr ?? calc.netSalaryNpr))
        }
      : {
          absentDeductionNpr: calc.absentDeductionNpr,
          extraAmountNpr: calc.extraAmountNpr,
          salaryAmountNpr: calc.salaryAmountNpr,
          taxNpr: calc.tax1PercentNpr,
          netSalaryNpr: calc.netSalaryNpr
        };

    const docFields = {
      employeeType: row.employeeType,
      teacherId: row.employeeType === "TEACHER" ? row.teacherId : undefined,
      staffId: row.employeeType === "STAFF" ? row.staffId : undefined,
      staffName: row.employeeName ?? "",
      monthBs: payload.monthBs,
      basicSalaryNpr: row.monthlySalaryNpr,
      allowancesNpr: 0,
      bonusNpr: 0,
      advanceSalaryNpr: 0,
      loanDeductionNpr: 0,
      otherDeductionsNpr: 0,
      presentDays: row.presentDays,
      absentDays: row.absentDays,
      extraDuty: row.extraDuty,
      absentDeductionNpr: money.absentDeductionNpr,
      extraAmountNpr: money.extraAmountNpr,
      salaryAmountNpr: money.salaryAmountNpr,
      taxNpr: money.taxNpr,
      netSalaryNpr: money.netSalaryNpr,
      attendanceManualOverride: Boolean(row.attendanceManualOverride),
      valuesManualOverride: useManualValues,
      attendanceIncomplete: false,
      notes: row.remarks ?? "",
      status: payload.status,
      paidDateBs: payload.paidDateBs || undefined,
      paymentMethod: payload.paymentMethod
    };

    let existing = null as InstanceType<typeof SalaryPayment> | null;
    if (row.salaryPaymentId) {
      existing = await SalaryPayment.findOne({
        _id: row.salaryPaymentId,
        schoolId,
        isDeleted: false
      });
    }
    if (!existing) {
      const filter: Record<string, unknown> = {
        schoolId,
        monthBs: payload.monthBs,
        isDeleted: false
      };
      if (row.employeeType === "TEACHER" && row.teacherId) filter.teacherId = row.teacherId;
      if (row.employeeType === "STAFF" && row.staffId) filter.staffId = row.staffId;
      existing = await SalaryPayment.findOne(filter);
    }

    if (existing) {
      if (existing.status === "PAID" && payload.status !== "PAID") {
        continue;
      }
      const wasPaid = existing.status === "PAID";
      Object.assign(existing, docFields);
      await existing.save();
      savedIds.push(String(existing._id));

      if (!wasPaid && payload.status === "PAID" && payload.paidDateBs) {
        await recordCashEntry(req, {
          dateBs: payload.paidDateBs,
          entryType: "DEBIT",
          category: "Salary",
          description: `Salary payment ${payload.monthBs} — ${row.employeeName || ""}`,
          amountNpr: money.netSalaryNpr,
          paymentMethod: payload.paymentMethod,
          referenceType: "SalaryPayment",
          referenceId: existing._id.toString()
        });
        await postSalaryJournal({
          schoolId,
          userId: userId as unknown as import("mongoose").Types.ObjectId,
          salaryId: existing._id,
          dateBs: payload.paidDateBs,
          amountNpr: money.netSalaryNpr,
          taxNpr: money.taxNpr,
          paymentMethod: payload.paymentMethod,
          monthBs: payload.monthBs
        });
      }
    } else {
      const created = await SalaryPayment.create({
        ...docFields,
        schoolId,
        createdBy: userId
      });
      savedIds.push(String(created._id));

      if (payload.status === "PAID" && payload.paidDateBs) {
        await recordCashEntry(req, {
          dateBs: payload.paidDateBs,
          entryType: "DEBIT",
          category: "Salary",
          description: `Salary payment ${payload.monthBs} — ${row.employeeName || ""}`,
          amountNpr: money.netSalaryNpr,
          paymentMethod: payload.paymentMethod,
          referenceType: "SalaryPayment",
          referenceId: created._id.toString()
        });
        await postSalaryJournal({
          schoolId,
          userId: userId as unknown as import("mongoose").Types.ObjectId,
          salaryId: created._id,
          dateBs: payload.paidDateBs,
          amountNpr: money.netSalaryNpr,
          taxNpr: money.taxNpr,
          paymentMethod: payload.paymentMethod,
          monthBs: payload.monthBs
        });
      }
    }
  }

  await recordAudit(req, {
    action: "accounting.salary.sheet.save",
    entity: "SalaryPayment",
    entityId: payload.monthBs,
    after: { monthBs: payload.monthBs, count: savedIds.length, status: payload.status }
  });

  const sheet = await buildSalarySheet({ schoolId, monthBs: payload.monthBs });
  return sendSuccess(res, `Salary sheet saved (${savedIds.length} employee(s))`, {
    ...sheet,
    savedIds,
    totalNetInWords: formatNrsAmountInWords(sheet.totals.totalNetSalaryNpr)
  });
});

export const createSalary = asyncHandler(async (req: Request, res: Response) => {
  // Super Admin / College Admin only — no accountant / other staff writes
  await assertCanEditOrDeleteFeePayment(req);

  const payload = salaryPaymentSchema.parse(req.body);
  const schoolId = tenantObjectId(req);
  const amounts = resolvePayrollAmounts(payload);
  const netSalaryNpr = amounts.netSalaryNpr;

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
    taxNpr: amounts.taxNpr,
    otherDeductionsNpr: payload.otherDeductionsNpr,
    presentDays: payload.presentDays ?? 0,
    absentDays: payload.absentDays ?? 0,
    extraDuty: payload.extraDuty ?? 0,
    absentDeductionNpr: amounts.absentDeductionNpr,
    extraAmountNpr: amounts.extraAmountNpr,
    salaryAmountNpr: amounts.salaryAmountNpr,
    attendanceIncomplete: payload.attendanceIncomplete ?? false,
    attendanceManualOverride: payload.attendanceManualOverride ?? false,
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
      taxNpr: amounts.taxNpr,
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
  // Super Admin / College Admin only — no accountant / other staff writes
  await assertCanEditOrDeleteFeePayment(req);

  const payload = salaryPaymentSchema.partial().parse(req.body);
  const existing = await SalaryPayment.findOne(
    withTenantScope(req, { _id: req.params.id, isDeleted: false })
  );
  if (!existing) throw new ApiError(404, "Salary payment not found");

  if (existing.status === "PAID" && payload.status && payload.status !== "PAID") {
    throw new ApiError(400, "Paid salary slips cannot change status. Void via reverse workflow if needed.");
  }

  const merged = { ...existing.toObject(), ...payload };
  const amounts = resolvePayrollAmounts(
    merged as Parameters<typeof resolvePayrollAmounts>[0]
  );
  const netSalaryNpr = amounts.netSalaryNpr;
  const before = existing.toObject();
  const salary = await SalaryPayment.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id }),
    {
      ...payload,
      taxNpr: amounts.taxNpr,
      absentDeductionNpr: amounts.absentDeductionNpr,
      extraAmountNpr: amounts.extraAmountNpr,
      salaryAmountNpr: amounts.salaryAmountNpr,
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
      taxNpr: amounts.taxNpr,
      paymentMethod: salary.paymentMethod,
      monthBs: salary.monthBs
    });
  }

  await recordAudit(req, { action: "accounting.salary.update", entity: "SalaryPayment", entityId: String(req.params.id), before, after: salary });
  return sendSuccess(res, "Salary payment updated", salary);
});

/**
 * Super Admin / College Admin only — soft-delete a salary payroll row.
 * If the slip was PAID, reverse journal + cash book entries for audit integrity.
 */
export const deleteSalary = asyncHandler(async (req: Request, res: Response) => {
  await assertCanEditOrDeleteFeePayment(req);

  const payload = reverseReasonSchema.parse(
    req.body ?? { reason: "Deleted by administrator from salary dashboard" }
  );
  const schoolId = tenantObjectId(req);
  const userId = req.user!.userId as unknown as import("mongoose").Types.ObjectId;

  const salary = await SalaryPayment.findOne(
    withTenantScope(req, { _id: req.params.id, isDeleted: false })
  );
  if (!salary) throw new ApiError(404, "Salary payment not found");

  const before = salary.toObject();
  const wasPaid = salary.status === "PAID";
  const reverseDateBs =
    salary.paidDateBs ||
    (typeof salary.monthBs === "string" && /^\d{4}-\d{2}$/.test(salary.monthBs)
      ? `${salary.monthBs}-01`
      : getTodayBs());

  await withFinancialTransaction(async (session) => {
    if (wasPaid) {
      await voidWithJournalReversal(
        req,
        salary,
        schoolId,
        userId,
        "SalaryPayment",
        payload.reason,
        reverseDateBs,
        session
      );
    } else {
      salary.isDeleted = true;
      (salary as { deletedAt?: Date }).deletedAt = new Date();
      (salary as { deletedBy?: import("mongoose").Types.ObjectId }).deletedBy =
        userId;
      (salary as { voidReason?: string }).voidReason = payload.reason;
      await salary.save(session ? { session } : undefined);
    }
  });

  await recordAudit(req, {
    action: "accounting.salary.delete",
    entity: "SalaryPayment",
    entityId: String(req.params.id),
    before,
    after: { isDeleted: true, voidReason: payload.reason }
  });

  return sendSuccess(
    res,
    wasPaid
      ? "Salary payment deleted — journal and cash book reversed"
      : "Salary payment deleted"
  );
});

/**
 * Archive list: months that already have saved salary sheet / payroll rows.
 * Used by Salary Sheet → Saved months history.
 */
export const listSalarySheetMonths = asyncHandler(
  async (req: Request, res: Response) => {
    const schoolId = tenantObjectId(req);
    const grouped = await SalaryPayment.aggregate<{
      _id: string;
      employeeCount: number;
      totalNetSalaryNpr: number;
      totalSalaryAmountNpr: number;
      draftCount: number;
      processedCount: number;
      paidCount: number;
      paidDates: Array<string | null | undefined>;
      paymentMethods: Array<string | null | undefined>;
      updatedAt: Date | null;
    }>([
      {
        $match: {
          schoolId,
          isDeleted: false,
          monthBs: { $type: "string", $ne: "" }
        }
      },
      {
        $group: {
          _id: "$monthBs",
          employeeCount: { $sum: 1 },
          totalNetSalaryNpr: { $sum: { $ifNull: ["$netSalaryNpr", 0] } },
          totalSalaryAmountNpr: {
            $sum: { $ifNull: ["$salaryAmountNpr", 0] }
          },
          draftCount: {
            $sum: { $cond: [{ $eq: ["$status", "DRAFT"] }, 1, 0] }
          },
          processedCount: {
            $sum: { $cond: [{ $eq: ["$status", "PROCESSED"] }, 1, 0] }
          },
          paidCount: {
            $sum: { $cond: [{ $eq: ["$status", "PAID"] }, 1, 0] }
          },
          paidDates: { $push: "$paidDateBs" },
          paymentMethods: { $push: "$paymentMethod" },
          updatedAt: { $max: "$updatedAt" }
        }
      },
      { $sort: { _id: -1 } }
    ]);

    const months = grouped.map((g) => {
      const monthBs = String(g._id || "").trim();
      const draftCount = Number(g.draftCount || 0);
      const processedCount = Number(g.processedCount || 0);
      const paidCount = Number(g.paidCount || 0);
      const distinctStatuses = [
        draftCount > 0 ? "DRAFT" : null,
        processedCount > 0 ? "PROCESSED" : null,
        paidCount > 0 ? "PAID" : null
      ].filter(Boolean) as Array<"DRAFT" | "PROCESSED" | "PAID">;
      const status =
        distinctStatuses.length === 1
          ? distinctStatuses[0]!
          : distinctStatuses.length > 1
            ? ("MIXED" as const)
            : ("DRAFT" as const);

      const paidDateBs =
        (g.paidDates || [])
          .map((d) => (typeof d === "string" ? d.trim() : ""))
          .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
          .sort()
          .at(-1) || undefined;

      const methods = (g.paymentMethods || [])
        .map((m) => (typeof m === "string" ? m.trim() : ""))
        .filter(Boolean);
      const paymentMethod = methods[0] || undefined;

      return {
        monthBs,
        employeeCount: Number(g.employeeCount || 0),
        totalNetSalaryNpr: Math.round(Number(g.totalNetSalaryNpr || 0) * 100) / 100,
        totalSalaryAmountNpr:
          Math.round(Number(g.totalSalaryAmountNpr || 0) * 100) / 100,
        status,
        draftCount,
        processedCount,
        paidCount,
        paidDateBs,
        paymentMethod,
        updatedAt: g.updatedAt ? new Date(g.updatedAt).toISOString() : undefined
      };
    });

    return sendSuccess(res, "Salary sheet months fetched", months);
  }
);

/**
 * Super Admin / College Admin — delete an entire payroll month (all employees).
 * Paid rows reverse journal + cash book; drafts are soft-deleted.
 */
export const deleteSalarySheetMonth = asyncHandler(
  async (req: Request, res: Response) => {
    await assertCanEditOrDeleteFeePayment(req);

    const monthBs = String(req.params.monthBs || "").trim();
    if (!/^\d{4}-\d{2}$/.test(monthBs)) {
      throw new ApiError(400, "monthBs must be YYYY-MM (BS)");
    }

    const payload = reverseReasonSchema.parse(
      req.body ?? {
        reason: `Deleted entire salary sheet for ${monthBs} by administrator`
      }
    );
    const schoolId = tenantObjectId(req);
    const userId = req.user!.userId as unknown as import("mongoose").Types.ObjectId;

    const salaries = await SalaryPayment.find(
      withTenantScope(req, { monthBs, isDeleted: false })
    );
    if (salaries.length === 0) {
      throw new ApiError(404, `No salary sheet found for ${monthBs}`);
    }

    let paidReversed = 0;
    let softDeleted = 0;

    await withFinancialTransaction(async (session) => {
      for (const salary of salaries) {
        const wasPaid = salary.status === "PAID";
        const reverseDateBs =
          salary.paidDateBs ||
          (typeof salary.monthBs === "string" &&
          /^\d{4}-\d{2}$/.test(salary.monthBs)
            ? `${salary.monthBs}-01`
            : getTodayBs());

        if (wasPaid) {
          await voidWithJournalReversal(
            req,
            salary,
            schoolId,
            userId,
            "SalaryPayment",
            payload.reason,
            reverseDateBs,
            session
          );
          paidReversed += 1;
        } else {
          salary.isDeleted = true;
          (salary as { deletedAt?: Date }).deletedAt = new Date();
          (salary as { deletedBy?: import("mongoose").Types.ObjectId }).deletedBy =
            userId;
          (salary as { voidReason?: string }).voidReason = payload.reason;
          await salary.save(session ? { session } : undefined);
          softDeleted += 1;
        }
      }
    });

    await recordAudit(req, {
      action: "accounting.salary.month_delete",
      entity: "SalaryPayment",
      entityId: monthBs,
      before: {
        monthBs,
        count: salaries.length,
        ids: salaries.map((s) => String(s._id))
      },
      after: {
        isDeleted: true,
        voidReason: payload.reason,
        paidReversed,
        softDeleted
      }
    });

    return sendSuccess(
      res,
      paidReversed > 0
        ? `Salary sheet for ${monthBs} deleted — ${paidReversed} paid row(s) reversed, ${softDeleted} draft/processed removed`
        : `Salary sheet for ${monthBs} deleted (${softDeleted} employee row(s))`,
      { monthBs, paidReversed, softDeleted, total: salaries.length }
    );
  }
);

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

const isBsDay = (value?: string): value is string =>
  Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

/**
 * Build a Mongo date filter for a BS date field.
 * Priority: exact dateBs → from/to range → month prefix.
 */
const bsFieldDateFilter = (
  field: string,
  opts: {
    fromDateBs?: string;
    toDateBs?: string;
    monthBs?: string;
    dateBs?: string;
  }
): Record<string, unknown> => {
  if (isBsDay(opts.dateBs)) {
    return { [field]: opts.dateBs };
  }
  if (isBsDay(opts.fromDateBs) || isBsDay(opts.toDateBs)) {
    const range: Record<string, string> = {};
    if (isBsDay(opts.fromDateBs)) range.$gte = opts.fromDateBs;
    if (isBsDay(opts.toDateBs)) range.$lte = opts.toDateBs;
    return { [field]: range };
  }
  const monthFilter = monthDateFilter(opts.monthBs);
  if (monthFilter) return { [field]: monthFilter };
  return {};
};

export const generateAccountingReport = asyncHandler(async (req: Request, res: Response) => {
  const reportType = req.params.reportType as AccountingReportType;
  const schoolId = tenantObjectId(req);
  let monthBs = typeof req.query.monthBs === "string" ? req.query.monthBs : undefined;
  const dateBs = typeof req.query.dateBs === "string" ? req.query.dateBs : undefined;
  const fromDateBs =
    typeof req.query.fromDateBs === "string" ? req.query.fromDateBs.trim() : undefined;
  const toDateBs =
    typeof req.query.toDateBs === "string" ? req.query.toDateBs.trim() : undefined;

  // Derive month from from-date when month not provided (financial summary / salary)
  if ((!monthBs || !/^\d{4}-\d{2}$/.test(monthBs)) && isBsDay(fromDateBs)) {
    monthBs = fromDateBs.slice(0, 7);
  }

  const dateOpts = { fromDateBs, toDateBs, monthBs, dateBs };

  let data: unknown = [];
  let summaryPayload: FinancialSummaryReport | null = null;

  switch (reportType) {
    case "daily-fee-collection": {
      const filter: Record<string, unknown> = {
        schoolId,
        isDeleted: false,
        ...bsFieldDateFilter("paidDateBs", dateOpts)
      };
      data = await FeeCollection.find(filter)
        .populate({ path: "studentId", populate: { path: "user", select: "-password" } })
        .sort({ paidDateBs: -1 })
        .lean();
      break;
    }
    case "monthly-fee-collection": {
      const filter: Record<string, unknown> = {
        schoolId,
        isDeleted: false,
        ...bsFieldDateFilter("paidDateBs", dateOpts)
      };
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
      const filter: Record<string, unknown> = { schoolId, isDeleted: false };
      // Prefer paid-date range when provided; else month sheet key
      const paidRange = bsFieldDateFilter("paidDateBs", dateOpts);
      if (Object.keys(paidRange).length > 0 && (isBsDay(fromDateBs) || isBsDay(toDateBs) || isBsDay(dateBs))) {
        Object.assign(filter, paidRange);
      } else if (monthBs) {
        filter.monthBs = monthBs;
      }
      // Flat populate (include-only) — avoid nested mixed projections
      data = await SalaryPayment.find(filter)
        .populate({ path: "teacherId", populate: { path: "user", select: "fullName email designation" } })
        .populate("staffId")
        .sort({ monthBs: -1 })
        .lean();
      break;
    }
    case "expenses": {
      const filter: Record<string, unknown> = {
        schoolId,
        isDeleted: false,
        ...bsFieldDateFilter("dateBs", dateOpts)
      };
      data = await AccountingExpense.find(filter).sort({ dateBs: -1 }).lean();
      break;
    }
    case "purchases": {
      const filter: Record<string, unknown> = {
        schoolId,
        isDeleted: false,
        ...bsFieldDateFilter("purchaseDateBs", dateOpts)
      };
      data = await AccountingPurchase.find(filter).sort({ purchaseDateBs: -1 }).lean();
      break;
    }
    case "income": {
      const filter: Record<string, unknown> = {
        schoolId,
        isDeleted: false,
        ...bsFieldDateFilter("dateBs", dateOpts)
      };
      data = await AccountingIncome.find(filter).sort({ dateBs: -1 }).lean();
      break;
    }
    case "refunds": {
      const filter: Record<string, unknown> = {
        schoolId,
        isDeleted: false,
        ...bsFieldDateFilter("dateBs", dateOpts)
      };
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
      const filter: Record<string, unknown> = {
        schoolId,
        isDeleted: false,
        ...bsFieldDateFilter("dateBs", dateOpts)
      };
      data = await JournalEntry.find(filter).sort({ dateBs: -1, createdAt: -1 }).limit(1000).lean();
      break;
    }
    case "ledger": {
      const filter: Record<string, unknown> = {
        schoolId,
        isDeleted: false,
        ...bsFieldDateFilter("dateBs", dateOpts)
      };
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
      const filter: Record<string, unknown> = {
        schoolId,
        ...bsFieldDateFilter("dateBs", dateOpts)
      };
      data = await CashBookEntry.find(filter).sort({ dateBs: -1, createdAt: -1 }).lean();
      break;
    }
    case "financial-summary": {
      if (!monthBs || !/^\d{4}-\d{2}$/.test(monthBs)) {
        throw new ApiError(
          400,
          "Select From date (BS) or month so the financial summary period can be determined"
        );
      }

      // Prefer explicit from–to day range when both ends are set; else full month
      const feeDateFilter =
        isBsDay(fromDateBs) || isBsDay(toDateBs)
          ? bsFieldDateFilter("paidDateBs", dateOpts)
          : { paidDateBs: monthDateFilter(monthBs) };
      const dayDateFilter =
        isBsDay(fromDateBs) || isBsDay(toDateBs)
          ? bsFieldDateFilter("dateBs", dateOpts)
          : { dateBs: monthDateFilter(monthBs) };
      const purchaseDateFilter =
        isBsDay(fromDateBs) || isBsDay(toDateBs)
          ? bsFieldDateFilter("purchaseDateBs", dateOpts)
          : { purchaseDateBs: monthDateFilter(monthBs) };
      const [fees, income, expenses, purchases, salaries, pendingStudents] = await Promise.all([
        FeeCollection.find({ schoolId, isDeleted: false, ...feeDateFilter })
          .populate({ path: "studentId", populate: { path: "user", select: "-password" } })
          .sort({ paidDateBs: -1 })
          .lean(),
        AccountingIncome.find({ schoolId, isDeleted: false, ...dayDateFilter })
          .sort({ dateBs: -1 })
          .lean(),
        AccountingExpense.find({ schoolId, isDeleted: false, ...dayDateFilter })
          .sort({ dateBs: -1 })
          .lean(),
        AccountingPurchase.find({ schoolId, isDeleted: false, ...purchaseDateFilter })
          .sort({ purchaseDateBs: -1 })
          .lean(),
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

      const periodLabel =
        isBsDay(fromDateBs) || isBsDay(toDateBs)
          ? `BS ${fromDateBs || "…"} → ${toDateBs || "…"}`
          : `BS ${monthBs}`;

      summaryPayload = {
        reportType: "financial-summary",
        period: { monthBs, label: periodLabel },
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