import type { AddressSelection, FeeType, StudentRecord, TeacherRecord, UserProfile } from "./types";

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
  | "cash-summary";

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
  previousDueNpr: number;
  currentChargesNpr: number;
  amountPaidNpr: number;
  discountNpr: number;
  scholarshipNpr: number;
  lateFeeNpr: number;
  advancePaymentNpr: number;
  remainingDueNpr: number;
  paymentMethod: PaymentMethod;
  feeBreakdown: FeeBreakdownItem[];
  isInstallment: boolean;
  installmentNumber?: number;
  notes?: string;
  accountantName: string;
  createdBy: string;
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
  createdAt?: string;
  updatedAt?: string;
}

export interface AccountingDashboardResponse {
  stats: Array<{ label: string; value: number; change?: string }>;
  feeChart: Array<{ label: string; amount: number }>;
  expenseChart: Array<{ label: string; amount: number }>;
  recentCollections: EnhancedFeeCollectionRecord[];
  recentExpenses: AccountingExpenseRecord[];
  pendingFeesTotal: number;
  cashBalanceNpr: number;
  bankBalanceNpr: number;
}

export interface StudentFinancialHistory {
  student: StudentRecord;
  className: string;
  sectionName: string;
  outstandingDueNpr: number;
  totalPaidNpr: number;
  totalDiscountNpr: number;
  totalScholarshipNpr: number;
  totalRefundsNpr: number;
  collections: EnhancedFeeCollectionRecord[];
  refunds: Array<{ dateBs: string; amountNpr: number; reason: string }>;
}

export interface AuditLogRecord {
  _id: string;
  schoolId: string;
  actorUserId: string;
  actorRole: string;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  createdAt?: string;
}