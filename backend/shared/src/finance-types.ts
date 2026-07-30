/** Finance Management — independent of ERP Accounting (ledger/journals/fees). */

export type FinanceTransactionType = "EXPENSE" | "INCOME" | "CREDIT";

export type FinanceExpenseType =
  | "COLLEGE_EXPENSE"
  | "OTHER_EXPENSE"
  | "EXTERNAL_EXPENSE";

export type FinancePaymentMethod =
  | "CASH"
  | "BANK_TRANSFER"
  | "CHEQUE"
  | "ONLINE"
  | "UPI"
  | "CARD"
  | "OTHER";

export type FinanceCategoryKind = "EXPENSE" | "INCOME" | "BOTH";

export interface FinanceAttachment {
  url: string;
  path?: string;
  originalName: string;
  mimeType: string;
  size: number;
  kind?: string;
  uploadedAt?: string;
  uploadedBy?: string;
}

export interface FinanceCategoryRecord {
  _id: string;
  schoolId: string;
  name: string;
  kind: FinanceCategoryKind;
  description?: string;
  isSystem?: boolean;
  isActive: boolean;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
}

export type FinanceOwnerScope =
  | "INSTITUTION"
  | "COLLEGE_ADMINISTRATOR"
  | "STAFF";

export interface FinanceTransactionRecord {
  _id: string;
  schoolId: string;
  transactionType: FinanceTransactionType;
  /** BS date YYYY-MM-DD */
  dateBs: string;
  title: string;
  categoryId: string;
  categoryName?: string;
  /** Only for EXPENSE */
  expenseType?: FinanceExpenseType;
  /** Free-text source for INCOME */
  incomeSource?: string;
  description?: string;
  vendorPayee?: string;
  amountNpr: number;
  paymentMethod: FinancePaymentMethod;
  referenceNumber?: string;
  remarks?: string;
  attachments: FinanceAttachment[];
  /**
   * INSTITUTION = admin/superadmin archive.
   * COLLEGE_ADMINISTRATOR = personal book of a College Administrator (COLLEGE_VIEWER).
   * STAFF = personal book of college staff (only when admin grants access).
   */
  ownerScope?: FinanceOwnerScope;
  /**
   * Reserved for a future optional link to Accounting.
   * Never auto-posted to ledger today.
   */
  accountingLinkId?: string | null;
  createdBy: string;
  createdByName?: string;
  updatedBy?: string;
  updatedByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface FinanceDashboardResponse {
  totalCollegeExpensesNpr: number;
  totalOtherExpensesNpr: number;
  totalExternalExpensesNpr: number;
  totalExpensesNpr: number;
  totalIncomeNpr: number;
  /** Purchases / sales recorded on credit (not settled in cash yet). */
  totalCreditNpr: number;
  netPositionNpr: number;
  monthlyExpenseSummary: Array<{ month: string; amountNpr: number }>;
  monthlyIncomeSummary: Array<{ month: string; amountNpr: number }>;
  monthlyCreditSummary?: Array<{ month: string; amountNpr: number }>;
  recentTransactions: FinanceTransactionRecord[];
  categoryBreakdown: Array<{
    categoryId: string;
    categoryName: string;
    transactionType: FinanceTransactionType;
    amountNpr: number;
    count: number;
  }>;
  filters: {
    yearBs?: string;
    monthBs?: string;
    categoryId?: string;
  };
}

export interface FinanceReportRow {
  dateBs: string;
  transactionType: FinanceTransactionType;
  categoryName: string;
  title: string;
  amountNpr: number;
  paymentMethod: FinancePaymentMethod;
  referenceNumber?: string;
  vendorPayee?: string;
  expenseType?: FinanceExpenseType;
  incomeSource?: string;
  ownerScope?: FinanceOwnerScope;
  attachmentCount: number;
  createdByName?: string;
  createdBy?: string;
}

export interface FinanceReportResponse {
  reportType: string;
  title: string;
  generatedAt: string;
  filters: Record<string, string | undefined>;
  totals: {
    expenseNpr: number;
    incomeNpr: number;
    creditNpr?: number;
    netNpr: number;
    count: number;
  };
  rows: FinanceReportRow[];
}

/** Admin Staff Access panel — college staff + personal finance grant. */
export interface FinanceStaffAccessRecord {
  staffId: string;
  staffCode: string;
  fullName: string;
  email?: string;
  phone?: string;
  designation: string;
  department?: string;
  category: string;
  categoryLabel?: string;
  status: "ACTIVE" | "INACTIVE";
  userId?: string;
  userRole?: string;
  userActive?: boolean;
  hasLogin: boolean;
  /** Admin-granted personal Finance Management access */
  financeAccessEnabled: boolean;
  photoUrl?: string;
}
