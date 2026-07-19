import { Router } from "express";
import {
  collectAccountingFee,
  createAccountant,
  createBankAccount,
  createCashBookEntry,
  createAccountingStructure,
  createFeeStructureVersion,
  createExpense,
  createIncome,
  createPurchase,
  createSalary,
  deleteAccountant,
  deleteAccountingStructure,
  deleteBankAccount,
  deleteExpense,
  deleteIncome,
  deletePurchase,
  downloadFeeReceipt,
  generateAccountingReport,
  getAccountingDashboard,
  getAccountingSettings,
  getStudentFinancialHistory,
  listAccountants,
  listAuditLogs,
  listBankAccounts,
  listCashBook,
  listExpenses,
  listFeeReceipts,
  listIncome,
  listPurchases,
  listSalaries,
  listSalaryEmployees,
  listStudentAccounts,
  listAccountingStructures,
  resetAccountantPassword,
  reverseFeeCollection,
  updateAccountant,
  updateAccountingFeeCollection,
  updateAccountingSettings,
  updateAccountingStructure,
  updateBankAccount,
  updateExpense,
  updateIncome,
  updatePurchase,
  updateSalary
} from "../controllers/accountingController.js";
import {
  approveFinancialApproval,
  listFinancialApprovals,
  rejectFinancialApproval
} from "../controllers/accountingApprovalController.js";
import {
  closeFiscalYear,
  createChartOfAccount,
  createFeeRefund,
  createFiscalYear,
  createGoshwaraVoucher,
  createJournalEntry,
  createVendor,
  downloadBlankGoshwaraForm,
  downloadGoshwaraVoucher,
  downloadGoshwaraVoucherById,
  generateLedgerReport,
  listChartOfAccounts,
  listFeeRefunds,
  listFiscalYears,
  listGoshwaraVouchers,
  listJournalEntries,
  listVendors,
  reverseJournalEntryHandler,
  seedChartOfAccounts,
  updateChartOfAccount,
  updateVendor,
  verifyReceipt
} from "../controllers/accountingLedgerController.js";
import { authorize, protect } from "../middleware/auth.js";
import { requireAccountingPermission } from "../middleware/accountingAuth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

const managers = authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "ACCOUNTANT");
const cashiers = authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "ACCOUNTANT", "CASHIER");
const readers = authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "ACCOUNTANT", "CASHIER", "AUDITOR", "PRINCIPAL");
const approvers = authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "PRINCIPAL");
const admins = authorize("SUPER_ADMIN", "COLLEGE_ADMIN");
router.use(protect, tenantGuard);

// Dashboard & settings
router.get("/dashboard", readers, requireAccountingPermission("read"), getAccountingDashboard);
router.get("/settings", readers, requireAccountingPermission("read"), getAccountingSettings);
router.put("/settings", admins, requireAccountingPermission("manage_settings"), updateAccountingSettings);

// Fee structures
router.get("/structures", readers, requireAccountingPermission("read"), listAccountingStructures);
router.post("/structures", admins, requireAccountingPermission("manage_settings"), createAccountingStructure);
router.post("/structures/:id/version", admins, requireAccountingPermission("manage_settings"), createFeeStructureVersion);
router.put("/structures/:id", admins, requireAccountingPermission("manage_settings"), updateAccountingStructure);
router.delete("/structures/:id", admins, requireAccountingPermission("manage_settings"), deleteAccountingStructure);

// Student accounts
router.get("/student-accounts", readers, requireAccountingPermission("read"), listStudentAccounts);
router.get(
  "/student-accounts/:studentId/financial-history",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "ACCOUNTANT", "CASHIER", "AUDITOR", "PRINCIPAL", "STUDENT"),
  getStudentFinancialHistory
);

// Fee collection & receipts
router.get("/collections", readers, requireAccountingPermission("read"), listFeeReceipts);
router.post("/collections", cashiers, requireAccountingPermission("collect_fees"), collectAccountingFee);
router.put("/collections/:id", managers, requireAccountingPermission("manage_expenses"), updateAccountingFeeCollection);
router.post("/collections/:id/reverse", managers, requireAccountingPermission("reverse_transaction"), reverseFeeCollection);
router.get(
  "/collections/:id/receipt",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "ACCOUNTANT", "CASHIER", "STUDENT"),
  downloadFeeReceipt
);
router.get("/receipts", readers, requireAccountingPermission("read"), listFeeReceipts);
router.get("/receipts/verify", readers, requireAccountingPermission("read"), verifyReceipt);

// Financial approvals
router.get("/approvals", readers, requireAccountingPermission("read"), listFinancialApprovals);
router.post("/approvals/:id/approve", approvers, requireAccountingPermission("approve_transactions"), approveFinancialApproval);
router.post("/approvals/:id/reject", approvers, requireAccountingPermission("approve_transactions"), rejectFinancialApproval);

// Refunds
router.get("/refunds", readers, requireAccountingPermission("read"), listFeeRefunds);
router.post("/refunds", managers, requireAccountingPermission("reverse_transaction"), createFeeRefund);

// Expenses, purchases, income (void = soft-delete, never hard-delete)
router.get("/expenses", readers, requireAccountingPermission("read"), listExpenses);
router.post("/expenses", managers, requireAccountingPermission("manage_expenses"), createExpense);
router.put("/expenses/:id", managers, requireAccountingPermission("manage_expenses"), updateExpense);
router.delete("/expenses/:id", admins, requireAccountingPermission("reverse_transaction"), deleteExpense);

router.get("/purchases", readers, requireAccountingPermission("read"), listPurchases);
router.post("/purchases", managers, requireAccountingPermission("manage_purchases"), createPurchase);
router.put("/purchases/:id", managers, requireAccountingPermission("manage_purchases"), updatePurchase);
router.delete("/purchases/:id", admins, requireAccountingPermission("reverse_transaction"), deletePurchase);

router.get("/income", readers, requireAccountingPermission("read"), listIncome);
router.post("/income", managers, requireAccountingPermission("manage_income"), createIncome);
router.put("/income/:id", managers, requireAccountingPermission("manage_income"), updateIncome);
router.delete("/income/:id", admins, requireAccountingPermission("reverse_transaction"), deleteIncome);

// Salaries
router.get("/salaries", readers, requireAccountingPermission("read"), listSalaries);
router.get("/salary-employees", readers, requireAccountingPermission("read"), listSalaryEmployees);
router.post("/salaries", managers, requireAccountingPermission("manage_salaries"), createSalary);
router.put("/salaries/:id", managers, requireAccountingPermission("manage_salaries"), updateSalary);

// Bank & cash
router.get("/bank-accounts", readers, requireAccountingPermission("read"), listBankAccounts);
router.post("/bank-accounts", admins, requireAccountingPermission("manage_settings"), createBankAccount);
router.put("/bank-accounts/:id", admins, requireAccountingPermission("manage_settings"), updateBankAccount);
router.delete("/bank-accounts/:id", admins, requireAccountingPermission("manage_settings"), deleteBankAccount);

router.get("/cash-book", readers, requireAccountingPermission("read"), listCashBook);
router.post("/cash-book", managers, requireAccountingPermission("manage_expenses"), createCashBookEntry);

// Chart of accounts & journal entries
router.get("/chart-of-accounts", readers, requireAccountingPermission("read"), listChartOfAccounts);
router.post("/chart-of-accounts", admins, requireAccountingPermission("manage_coa"), createChartOfAccount);
router.post("/chart-of-accounts/seed", admins, requireAccountingPermission("manage_coa"), seedChartOfAccounts);
router.put("/chart-of-accounts/:id", admins, requireAccountingPermission("manage_coa"), updateChartOfAccount);

router.get("/journal-entries", readers, requireAccountingPermission("read"), listJournalEntries);
router.post("/journal-entries", managers, requireAccountingPermission("manage_journal"), createJournalEntry);
router.post("/journal-entries/:id/reverse", managers, requireAccountingPermission("reverse_transaction"), reverseJournalEntryHandler);
router.get(
  "/journal-entries/:id/goshwara-voucher",
  readers,
  requireAccountingPermission("read"),
  downloadGoshwaraVoucher
);

// Goshwara vouchers (create → Voucher record + JournalEntry)
router.get("/goshwara-vouchers", readers, requireAccountingPermission("read"), listGoshwaraVouchers);
router.get(
  "/goshwara-vouchers/blank-form",
  readers,
  requireAccountingPermission("read"),
  downloadBlankGoshwaraForm
);
router.post(
  "/goshwara-vouchers",
  managers,
  requireAccountingPermission("manage_journal"),
  createGoshwaraVoucher
);
router.get(
  "/goshwara-vouchers/:id/pdf",
  readers,
  requireAccountingPermission("read"),
  downloadGoshwaraVoucherById
);

// Vendors
router.get("/vendors", readers, requireAccountingPermission("read"), listVendors);
router.post("/vendors", managers, requireAccountingPermission("manage_purchases"), createVendor);
router.put("/vendors/:id", managers, requireAccountingPermission("manage_purchases"), updateVendor);

// Fiscal years
router.get("/fiscal-years", readers, requireAccountingPermission("read"), listFiscalYears);
router.post("/fiscal-years", admins, requireAccountingPermission("manage_settings"), createFiscalYear);
router.post("/fiscal-years/:id/close", admins, requireAccountingPermission("manage_settings"), closeFiscalYear);

// Reports
router.get("/reports/:reportType", readers, requireAccountingPermission("read"), generateAccountingReport);
router.get("/ledger-reports/:reportType", readers, requireAccountingPermission("read"), generateLedgerReport);

// Audit & staff
router.get("/audit-logs", readers, requireAccountingPermission("view_audit"), listAuditLogs);
router.get("/accountants", admins, requireAccountingPermission("manage_staff"), listAccountants);
router.post("/accountants", admins, requireAccountingPermission("manage_staff"), createAccountant);
router.put("/accountants/:id", admins, requireAccountingPermission("manage_staff"), updateAccountant);
router.delete("/accountants/:id", admins, requireAccountingPermission("manage_staff"), deleteAccountant);
router.post("/accountants/:id/reset-password", admins, requireAccountingPermission("manage_staff"), resetAccountantPassword);

export default router;