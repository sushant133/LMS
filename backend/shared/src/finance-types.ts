/** Finance Management — independent of ERP Accounting (ledger/journals/fees). */

export type FinanceTransactionType = "EXPENSE" | "INCOME";

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
  netPositionNpr: number;
  monthlyExpenseSummary: Array<{ month: string; amountNpr: number }>;
  monthlyIncomeSummary: Array<{ month: string; amountNpr: number }>;
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
  attachmentCount: number;
  createdByName?: string;
}

export interface FinanceReportResponse {
  reportType: string;
  title: string;
  generatedAt: string;
  filters: Record<string, string | undefined>;
  totals: {
    expenseNpr: number;
    incomeNpr: number;
    netNpr: number;
    count: number;
  };
  rows: FinanceReportRow[];
}
