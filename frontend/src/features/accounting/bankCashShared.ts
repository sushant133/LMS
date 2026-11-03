import { getTodayBs } from "@munatech/nepali-datepicker";
import type { BankCashSectionKey } from "@phit-erp/shared";

/** Value used for Cash in Hand wherever a Cash / Bank choice is made. */
export const CASH = "CASH";

export const npr = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "—"
    : `NPR ${Number(value).toLocaleString("en-NP", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Plain amount for dense tables (no currency prefix). */
export const amount = (value: number | null | undefined) =>
  value ? Number(value).toLocaleString("en-NP", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";

export const todayBs = () => {
  const d = getTodayBs();
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
};

/** First day of the current BS month. */
export const monthStartBs = () => `${todayBs().slice(0, 8)}01`;

/** Nepal's fiscal year starts on Shrawan 1 (month 04). */
export const fiscalYearStartBs = () => {
  const d = getTodayBs();
  return `${d.month >= 4 ? d.year : d.year - 1}-04-01`;
};

export const bankLabel = (bank: { bankName: string; accountNumber: string }) =>
  `${bank.bankName} (${bank.accountNumber})`;

/** Accounting tab that owns each section's records. */
export const SECTION_TAB: Partial<Record<BankCashSectionKey, string>> = {
  STUDENT_FEE: "fee-records",
  SECURITY_DEPOSIT: "deposit-records",
  OTHER_RECEIPT: "income",
  DIRECT_EXPENSE: "purchases",
  INDIRECT_EXPENSE: "expenses",
  SALARY: "salary-records",
  REFUND: "refund-records",
  JOURNAL: "journal-entries",
};

export const SECTION_LABEL: Record<BankCashSectionKey, string> = {
  STUDENT_FEE: "Student Fee Records",
  SECURITY_DEPOSIT: "Security Deposits",
  OTHER_RECEIPT: "Other Receipts",
  DIRECT_EXPENSE: "Direct Expense",
  INDIRECT_EXPENSE: "Indirect Expenses",
  TRANSFER: "Cash ↔ Bank Transfer",
  SALARY: "Salary Sheet / Payroll",
  REFUND: "Refund Records",
  JOURNAL: "Journal Entries",
  CASH_BOOK: "Cash Book",
};

/** Voucher type badge for a section (Receipt / Payment / Contra / Journal). */
export const sectionVoucherKind = (key: BankCashSectionKey, debit: number) => {
  if (key === "TRANSFER") return "Contra";
  if (key === "JOURNAL" || key === "CASH_BOOK") return "Journal";
  return debit > 0 ? "Receipt" : "Payment";
};

/** Payment methods posted to Bank in the ledger (everything except Cash / Other). */
export const isBankPaymentMethod = (method: string | undefined): boolean =>
  Boolean(method) && method !== "CASH" && method !== "OTHER";
