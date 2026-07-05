import type { AddressSelection, CollegeStaffRecord, FeeType, StudentRecord, TeacherRecord, UserProfile } from "./types.js";

export type PaymentMethod = "CASH" | "BANK_TRANSFER" | "CHEQUE" | "ONLINE" | "OTHER";

export type PaymentStatus = "PENDING" | "PARTIAL" | "PAID";

export type SalaryPaymentStatus = "DRAFT" | "PROCESSED" | "PAID";

export type CashBookEntryType = "DEBIT" | "CREDIT";

export type AccountingReportType =
  | "daily-fee-collection"
  | "monthly-fee-collection"
  | "pending-fees"
  | "fee-defaulters"
  | "salary-payments"
  | "expenses"
  | "purchases"
  | "income"
  | "cash-summary"
  | "financial-summary"
  | "trial-balance"
  | "balance-sheet"
  | "income-expenditure"
  | "cash-flow"
  | "student-ledger"
  | "student-due"
  | "bank-book"
  | "day-book"
  | "fee-collection-summary"
  | "scholarship-report"
  | "vendor-ledger";

export interface FeeBreakdownItem {
  feeType: FeeType;
  title: string;
  amountNpr: number;
}

export interface AccountantRecord {
  _id: string;
  schoolId: string;
  user: UserProfile;
  employeeId: string;
  gender: string;
  address: AddressSelection;
  joinedDateBs: string;
  photoUrl?: string;
  status: "ACTIVE" | "INACTIVE";
  createdAt?: string;
  updatedAt?: string;
}

export interface EnhancedFeeCollectionRecord {
  _id: string;
  schoolId: string;
  studentId: string;
  feeStructureId?: string;
  receiptNumber: string;
  paidDateBs: string;
  fiscalYearBs?: string;
  academicYearBs?: string;
  semesterBs?: string;
  previousDueNpr: number;
  currentChargesNpr: number;
  amountPaidNpr: number;
  discountNpr: number;
  scholarshipNpr: number;
  lateFeeNpr: number;
  advancePaymentNpr: number;
  remainingDueNpr: number;
  paymentMethod: PaymentMethod;
  bankAccountId?: string;
  transactionNumber?: string;
  verificationCode?: string;
  feeBreakdown: FeeBreakdownItem[];
  isInstallment: boolean;
  installmentNumber?: number;
  totalInstallments?: number;
  notes?: string;
  accountantName: string;
  createdBy: string;
  printCount?: number;
  lastPrintedAt?: string;
  isDeleted?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface StudentAccountSummary {
  student: StudentRecord;
  className: string;
  sectionName: string;
  previousDueNpr: number;
  totalPaidNpr: number;
  totalDiscountNpr: number;
  totalScholarshipNpr: number;
  remainingDueNpr: number;
  lastPaymentDateBs?: string;
}

export interface AccountingExpenseRecord {
  _id: string;
  schoolId: string;
  category: string;
  vendor: string;
  dateBs: string;
  amountNpr: number;
  paymentMethod: PaymentMethod;
  description: string;
  attachmentUrl?: string;
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AccountingPurchaseRecord {
  _id: string;
  schoolId: string;
  category: string;
  vendor: string;
  purchaseDateBs: string;
  invoiceNumber: string;
  quantity: number;
  unitPriceNpr: number;
  totalAmountNpr: number;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  description?: string;
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AccountingIncomeRecord {
  _id: string;
  schoolId: string;
  category: string;
  source: string;
  dateBs: string;
  amountNpr: number;
  paymentMethod: PaymentMethod;
  description?: string;
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SalaryPaymentRecord {
  _id: string;
  schoolId: string;
  employeeType: "TEACHER" | "STAFF";
  teacherId?: string;
  staffId?: string;
  staffName?: string;
  monthBs: string;
  basicSalaryNpr: number;
  allowancesNpr: number;
  bonusNpr: number;
  advanceSalaryNpr: number;
  loanDeductionNpr: number;
  taxNpr: number;
  otherDeductionsNpr: number;
  netSalaryNpr: number;
  status: SalaryPaymentStatus;
  paidDateBs?: string;
  paymentMethod: PaymentMethod;
  createdBy: string;
  teacher?: TeacherRecord;
  collegeStaff?: Pick<CollegeStaffRecord, "_id" | "fullName">;
  createdAt?: string;
  updatedAt?: string;
}

export interface BankAccountRecord {
  _id: string;
  schoolId: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  branch?: string;
  openingBalanceNpr: number;
  currentBalanceNpr: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CashBookEntryRecord {
  _id: string;
  schoolId: string;
  dateBs: string;
  entryType: CashBookEntryType;
  category: string;
  description: string;
  amountNpr: number;
  paymentMethod: PaymentMethod;
  referenceType?: string;
  referenceId?: string;
  balanceAfterNpr: number;
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AccountingSettingsRecord {
  _id: string;
  schoolId: string;
  lateFinePercent: number;
  lateFineGraceDays: number;
  receiptPrefix: string;
  autoReceiptNumber: boolean;
  defaultPaymentMethod: PaymentMethod;
  voucherPrefix: string;
  currentFiscalYearBs: string;
  auditLockDateBs?: string;
  panNumber?: string;
  vatNumber?: string;
  tdsEnabled: boolean;
  institutionSignatureUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AccountingDashboardResponse {
  stats: Array<{ label: string; value: number; change?: string }>;
  feeChart: Array<{ label: string; amount: number }>;
  expenseChart: Array<{ label: string; amount: number }>;
  collectionTrend: Array<{ label: string; amount: number }>;
  revenueSources: Array<{ label: string; amount: number }>;
  recentCollections: EnhancedFeeCollectionRecord[];
  recentExpenses: AccountingExpenseRecord[];
  recentTransactions: Array<{
    dateBs: string;
    type: string;
    description: string;
    amountNpr: number;
    entryType: "DEBIT" | "CREDIT";
  }>;
  pendingFeesTotal: number;
  todayCollectionNpr: number;
  monthlyCollectionNpr: number;
  cashBalanceNpr: number;
  bankBalanceNpr: number;
  pendingApprovals: number;
}

export interface StudentFinancialHistory {
  student: StudentRecord;
  className: string;
  sectionName: string;
  batchName?: string;
  yearName?: string;
  guardianName?: string;
  scholarshipStatus?: string;
  totalPayableNpr: number;
  outstandingDueNpr: number;
  totalPaidNpr: number;
  totalDiscountNpr: number;
  totalScholarshipNpr: number;
  totalFineNpr: number;
  advanceBalanceNpr: number;
  totalRefundsNpr: number;
  collections: EnhancedFeeCollectionRecord[];
  refunds: Array<{ _id?: string; refundNumber?: string; dateBs: string; amountNpr: number; reason: string }>;
  dueInstallments: Array<{ installmentNumber: number; totalInstallments: number; amountNpr: number; dueDateBs?: string }>;
}

export interface AuditLogRecord {
  _id: string;
  schoolId: string;
  actorUserId: string | { fullName?: string; email?: string };
  actorRole: string;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
  userAgent?: string;
  createdAt?: string;
}