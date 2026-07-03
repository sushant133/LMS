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
  type AccountingReportType
} from "@nepal-school-erp/shared";
import { env } from "../config/env.js";
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
import { Teacher } from "../models/Teacher.js";
import { User } from "../models/User.js";
import { calculateFeeTotals, calculateNetSalary, generateReceiptNumber } from "../utils/accountingCalculations.js";
import { recordAudit } from "../utils/audit.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { ensureValidBsDate } from "../utils/nepaliDate.js";
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

const recordCashEntry = async (
  req: Request,
  params: {
    dateBs: string;
    entryType: "DEBIT" | "CREDIT";
    category: string;
    description: string;
    amountNpr: number;
    paymentMethod: string;
    referenceType?: string;
    referenceId?: string;
  }
) => {
  const schoolId = tenantObjectId(req);
  const lastEntry = await CashBookEntry.findOne({ schoolId }).sort({ createdAt: -1 }).lean();
  const previousBalance = lastEntry?.balanceAfterNpr ?? 0;
  const balanceAfterNpr =
    params.entryType === "CREDIT" ? previousBalance + params.amountNpr : previousBalance - params.amountNpr;

  await CashBookEntry.create({
    schoolId,
    dateBs: params.dateBs,
    entryType: params.entryType,
    category: params.category,
    description: params.description,
    amountNpr: params.amountNpr,
    paymentMethod: params.paymentMethod,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    balanceAfterNpr,
    createdBy: req.user!.userId
  });
};

export const getAccountingDashboard = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const today = new Date().toISOString().slice(0, 10);

  const [collections, expenses, students, recentCollections, recentExpenses, lastCashEntry, bankAccounts] =
    await Promise.all([
      FeeCollection.find({ schoolId }).lean(),
      AccountingExpense.find({ schoolId }).lean(),
      Student.find({ schoolId }).lean(),
      FeeCollection.find({ schoolId }).sort({ createdAt: -1 }).limit(5).lean(),
      AccountingExpense.find({ schoolId }).sort({ createdAt: -1 }).limit(5).lean(),
      CashBookEntry.findOne({ schoolId }).sort({ createdAt: -1 }).lean(),
      BankAccount.find({ schoolId, isActive: true }).lean()
    ]);

  const totalCollected = collections.reduce((sum, item) => sum + item.amountPaidNpr, 0);
  const totalExpenses = expenses.reduce((sum, item) => sum + item.amountNpr, 0);
  const pendingFees = students.reduce((sum, item) => sum + (item.feesDueNpr ?? 0), 0);
  const bankBalance = bankAccounts.reduce((sum, item) => sum + item.currentBalanceNpr, 0);

  const feeByMonth = collections.reduce<Record<string, number>>((acc, item) => {
    const month = item.paidDateBs.slice(0, 7);
    acc[month] = (acc[month] ?? 0) + item.amountPaidNpr;
    return acc;
  }, {});

  const expenseByCategory = expenses.reduce<Record<string, number>>((acc, item) => {
    acc[item.category] = (acc[item.category] ?? 0) + item.amountNpr;
    return acc;
  }, {});

  return sendSuccess(res, "Accounting dashboard fetched", {
    stats: [
      { label: "Total Collected", value: totalCollected },
      { label: "Total Expenses", value: totalExpenses },
      { label: "Pending Fees", value: pendingFees },
      { label: "Students", value: students.length }
    ],
    feeChart: Object.entries(feeByMonth).map(([label, amount]) => ({ label, amount })),
    expenseChart: Object.entries(expenseByCategory).map(([label, amount]) => ({ label, amount })),
    recentCollections,
    recentExpenses,
    pendingFeesTotal: pendingFees,
    cashBalanceNpr: lastCashEntry?.balanceAfterNpr ?? 0,
    bankBalanceNpr: bankBalance,
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
  const structure = await FeeStructure.create({ ...payload, schoolId });
  await recordAudit(req, { action: "accounting.structure.create", entity: "FeeStructure", entityId: structure._id.toString(), after: structure });
  return sendSuccess(res, "Fee structure created", structure, 201);
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
    FeeCollection.find({ schoolId }).lean()
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

  const [primaryDoc, secondaryDoc, collections] = await Promise.all([
    college ? Batch.findById(student.batchId).lean() : SchoolClass.findById(student.classId).lean(),
    college ? Year.findById(student.yearId).lean() : Section.findById(student.sectionId).lean(),
    FeeCollection.find({ schoolId, studentId: student._id }).sort({ paidDateBs: -1 }).lean()
  ]);

  const totalPaid = collections.reduce((sum, item) => sum + item.amountPaidNpr, 0);
  const totalDiscount = collections.reduce((sum, item) => sum + (item.discountNpr ?? 0), 0);
  const totalScholarship = collections.reduce((sum, item) => sum + (item.scholarshipNpr ?? 0), 0);

  return sendSuccess(res, "Student financial history fetched", {
    student,
    className: primaryDoc?.name ?? "",
    sectionName: secondaryDoc?.name ?? "",
    outstandingDueNpr: student.feesDueNpr ?? 0,
    totalPaidNpr: totalPaid,
    totalDiscountNpr: totalDiscount,
    totalScholarshipNpr: totalScholarship,
    totalRefundsNpr: 0,
    collections,
    refunds: []
  });
});

export const listFeeReceipts = asyncHandler(async (req: Request, res: Response) => {
  const collections = await FeeCollection.find(withTenantScope(req))
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
  const totals = calculateFeeTotals({
    previousDueNpr,
    currentChargesNpr,
    amountPaidNpr: payload.amountPaidNpr,
    discountNpr: payload.discountNpr,
    scholarshipNpr: payload.scholarshipNpr,
    lateFeeNpr: payload.lateFeeNpr
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

  const collection = await FeeCollection.create({
    schoolId,
    studentId: payload.studentId,
    feeStructureId: payload.feeStructureId,
    receiptNumber,
    paidDateBs: payload.paidDateBs,
    previousDueNpr,
    currentChargesNpr,
    amountPaidNpr: payload.amountPaidNpr,
    discountNpr: payload.discountNpr,
    scholarshipNpr: payload.scholarshipNpr,
    lateFeeNpr: payload.lateFeeNpr,
    advancePaymentNpr: totals.advancePaymentNpr,
    remainingDueNpr: totals.remainingDueNpr,
    paymentMethod: payload.paymentMethod,
    feeBreakdown,
    isInstallment: payload.isInstallment,
    installmentNumber: payload.installmentNumber,
    notes: payload.notes,
    accountantName,
    createdBy: req.user!.userId
  });

  student.feesDueNpr = totals.remainingDueNpr;
  await student.save();

  await recordCashEntry(req, {
    dateBs: payload.paidDateBs,
    entryType: "CREDIT",
    category: "Fee Collection",
    description: `Fee receipt ${receiptNumber}`,
    amountNpr: payload.amountPaidNpr,
    paymentMethod: payload.paymentMethod,
    referenceType: "FeeCollection",
    referenceId: collection._id.toString()
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

export const downloadFeeReceipt = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const collection = await FeeCollection.findOne({ _id: req.params.id, schoolId });
  if (!collection) throw new ApiError(404, "Receipt not found");

  if (req.user?.role === "STUDENT") {
    const ownStudent = await Student.findOne({ schoolId, user: req.user.userId }).lean();
    if (!ownStudent || ownStudent._id.toString() !== collection.studentId.toString()) {
      throw new ApiError(403, "You can only download your own receipts");
    }
  }

  const [school, student, classDoc, sectionDoc, settings] = await Promise.all([
    School.findById(schoolId).lean(),
    Student.findById(collection.studentId).populate("user", "-password").lean(),
    Student.findById(collection.studentId).then((s) => (s ? SchoolClass.findById(s.classId).lean() : null)),
    Student.findById(collection.studentId).then((s) => (s ? Section.findById(s.sectionId).lean() : null)),
    Setting.findOne({ schoolId }).lean()
  ]);

  if (!student || !school) throw new ApiError(404, "Receipt data incomplete");

  const feeTitle = collection.feeBreakdown?.map((item) => item.title).join(", ") || "College Fee";

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
      feeBreakdown: collection.feeBreakdown ?? []
    },
    res
  );
});

export const listExpenses = asyncHandler(async (req: Request, res: Response) => {
  const expenses = await AccountingExpense.find(withTenantScope(req)).sort({ dateBs: -1 });
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
  const expense = await AccountingExpense.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));
  if (!expense) throw new ApiError(404, "Expense not found");
  await recordAudit(req, { action: "accounting.expense.delete", entity: "AccountingExpense", entityId: String(req.params.id), before: expense });
  return sendSuccess(res, "Expense deleted");
});

export const listPurchases = asyncHandler(async (req: Request, res: Response) => {
  const purchases = await AccountingPurchase.find(withTenantScope(req)).sort({ purchaseDateBs: -1 });
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

  await recordAudit(req, { action: "accounting.purchase.update", entity: "AccountingPurchase", entityId: String(req.params.id), before, after: purchase });
  return sendSuccess(res, "Purchase updated", purchase);
});

export const deletePurchase = asyncHandler(async (req: Request, res: Response) => {
  const purchase = await AccountingPurchase.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));
  if (!purchase) throw new ApiError(404, "Purchase not found");
  await recordAudit(req, { action: "accounting.purchase.delete", entity: "AccountingPurchase", entityId: String(req.params.id), before: purchase });
  return sendSuccess(res, "Purchase deleted");
});

export const listIncome = asyncHandler(async (req: Request, res: Response) => {
  const income = await AccountingIncome.find(withTenantScope(req)).sort({ dateBs: -1 });
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
  const record = await AccountingIncome.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));
  if (!record) throw new ApiError(404, "Income record not found");
  await recordAudit(req, { action: "accounting.income.delete", entity: "AccountingIncome", entityId: String(req.params.id), before: record });
  return sendSuccess(res, "Income deleted");
});

export const listSalaries = asyncHandler(async (req: Request, res: Response) => {
  const salaries = await SalaryPayment.find(withTenantScope(req))
    .populate({ path: "teacherId", populate: { path: "user", select: "-password" } })
    .sort({ monthBs: -1 });
  return sendSuccess(res, "Salary payments fetched", salaries);
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
  const lastEntry = await CashBookEntry.findOne({ schoolId }).sort({ createdAt: -1 }).lean();
  const previousBalance = lastEntry?.balanceAfterNpr ?? 0;
  const balanceAfterNpr =
    payload.entryType === "CREDIT" ? previousBalance + payload.amountNpr : previousBalance - payload.amountNpr;

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
  const filter = withTenantScope(req);
  if (typeof req.query.entity === "string") {
    Object.assign(filter, { entity: req.query.entity });
  }
  const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  return sendSuccess(res, "Audit logs fetched", logs);
});

export const generateAccountingReport = asyncHandler(async (req: Request, res: Response) => {
  const reportType = req.params.reportType as AccountingReportType;
  const schoolId = tenantObjectId(req);
  const monthBs = typeof req.query.monthBs === "string" ? req.query.monthBs : undefined;
  const dateBs = typeof req.query.dateBs === "string" ? req.query.dateBs : undefined;

  let data: unknown = [];

  switch (reportType) {
    case "daily-fee-collection": {
      const filter: Record<string, unknown> = { schoolId };
      if (dateBs) filter.paidDateBs = dateBs;
      data = await FeeCollection.find(filter).sort({ paidDateBs: -1 }).lean();
      break;
    }
    case "monthly-fee-collection": {
      const filter: Record<string, unknown> = { schoolId };
      if (monthBs) filter.paidDateBs = { $regex: `^${monthBs}` };
      data = await FeeCollection.find(filter).sort({ paidDateBs: -1 }).lean();
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
        .lean();
      break;
    }
    case "expenses":
      data = await AccountingExpense.find({ schoolId }).sort({ dateBs: -1 }).lean();
      break;
    case "purchases":
      data = await AccountingPurchase.find({ schoolId }).sort({ purchaseDateBs: -1 }).lean();
      break;
    case "income":
      data = await AccountingIncome.find({ schoolId }).sort({ dateBs: -1 }).lean();
      break;
    case "cash-summary":
      data = await CashBookEntry.find({ schoolId }).sort({ dateBs: -1 }).lean();
      break;
    default:
      throw new ApiError(400, "Invalid report type");
  }

  if (req.query.format === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${reportType}.csv"`);
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      return res.send("No data");
    }
    const headers = Object.keys(rows[0] as Record<string, unknown>).join(",");
    const body = rows
      .map((row) =>
        Object.values(row as Record<string, unknown>)
          .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");
    return res.send(`${headers}\n${body}`);
  }

  return sendSuccess(res, "Report generated", { reportType, data });
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

  const user = await User.create({
    schoolId: req.tenantSchoolId,
    fullName: payload.fullName,
    email,
    phone: payload.phone,
    password: payload.password ?? env.DEFAULT_USER_PASSWORD,
    role: "ACCOUNTANT",
    isActive: payload.status === "ACTIVE",
    mustChangePassword: !payload.password
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
  return sendSuccess(res, "Accountant created", populated, 201);
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

  user.password = password ?? env.DEFAULT_USER_PASSWORD;
  user.mustChangePassword = true;
  await user.save();

  await recordAudit(req, { action: "accounting.accountant.reset-password", entity: "Accountant", entityId: accountant._id.toString() });
  return sendSuccess(res, "Accountant password reset");
});

export const listSalaryEmployees = asyncHandler(async (req: Request, res: Response) => {
  const teachers = await Teacher.find(withTenantScope(req))
    .populate("user", "-password")
    .sort({ createdAt: -1 });
  return sendSuccess(res, "Salary employees fetched", teachers);
});