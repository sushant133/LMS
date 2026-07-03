import { Router } from "express";
import {
  collectAccountingFee,
  createAccountant,
  createBankAccount,
  createCashBookEntry,
  createAccountingStructure,
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
import { authorize, protect } from "../middleware/auth.js";
import { tenantGuard } from "../middleware/tenant.js";

const router = Router();

const managers = authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "ACCOUNTANT");
const admins = authorize("SUPER_ADMIN", "COLLEGE_ADMIN");

router.use(protect, tenantGuard);

router.get("/dashboard", managers, getAccountingDashboard);

router.get("/structures", managers, listAccountingStructures);
router.post("/structures", admins, createAccountingStructure);
router.put("/structures/:id", admins, updateAccountingStructure);
router.delete("/structures/:id", admins, deleteAccountingStructure);

router.get("/student-accounts", managers, listStudentAccounts);
router.get(
  "/student-accounts/:studentId/financial-history",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "ACCOUNTANT", "STUDENT"),
  getStudentFinancialHistory
);

router.get("/collections", managers, listFeeReceipts);
router.post("/collections", managers, collectAccountingFee);
router.put("/collections/:id", managers, updateAccountingFeeCollection);
router.get(
  "/collections/:id/receipt",
  authorize("SUPER_ADMIN", "COLLEGE_ADMIN", "ACCOUNTANT", "STUDENT"),
  downloadFeeReceipt
);
router.get("/receipts", managers, listFeeReceipts);

router.get("/expenses", managers, listExpenses);
router.post("/expenses", managers, createExpense);
router.put("/expenses/:id", managers, updateExpense);
router.delete("/expenses/:id", admins, deleteExpense);

router.get("/purchases", managers, listPurchases);
router.post("/purchases", managers, createPurchase);
router.put("/purchases/:id", managers, updatePurchase);
router.delete("/purchases/:id", admins, deletePurchase);

router.get("/income", managers, listIncome);
router.post("/income", managers, createIncome);
router.put("/income/:id", managers, updateIncome);
router.delete("/income/:id", admins, deleteIncome);

router.get("/salaries", managers, listSalaries);
router.get("/salary-employees", managers, listSalaryEmployees);
router.post("/salaries", managers, createSalary);
router.put("/salaries/:id", managers, updateSalary);

router.get("/bank-accounts", managers, listBankAccounts);
router.post("/bank-accounts", admins, createBankAccount);
router.put("/bank-accounts/:id", admins, updateBankAccount);
router.delete("/bank-accounts/:id", admins, deleteBankAccount);

router.get("/cash-book", managers, listCashBook);
router.post("/cash-book", managers, createCashBookEntry);

router.get("/reports/:reportType", managers, generateAccountingReport);
router.get("/audit-logs", admins, listAuditLogs);

router.get("/settings", admins, getAccountingSettings);
router.put("/settings", admins, updateAccountingSettings);

router.get("/accountants", admins, listAccountants);
router.post("/accountants", admins, createAccountant);
router.put("/accountants/:id", admins, updateAccountant);
router.delete("/accountants/:id", admins, deleteAccountant);
router.post("/accountants/:id/reset-password", admins, resetAccountantPassword);

export default router;