import type { FeeType } from "./types.js";

export const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;

export const VOUCHER_TYPES = ["JOURNAL", "RECEIPT", "PAYMENT", "CONTRA", "SALES", "PURCHASE"] as const;

export const JOURNAL_REFERENCE_TYPES = [
  "FeeCollection",
  "FeeRefund",
  "AccountingExpense",
  "AccountingIncome",
  "AccountingPurchase",
  "SalaryPayment",
  "CashBookEntry",
  "GoshwaraVoucher",
  "Manual"
] as const;

/** System chart of accounts codes for PHIT ERP */
export const SYSTEM_ACCOUNT_CODES = {
  CASH: "1001",
  BANK: "1101",
  STUDENT_RECEIVABLE: "1201",
  ACCOUNTS_PAYABLE: "2001",
  OPENING_BALANCE: "3001",
  FEE_INCOME: "4000",
  ADMISSION_INCOME: "4001",
  REGISTRATION_INCOME: "4002",
  TUITION_INCOME: "4003",
  EXAM_INCOME: "4004",
  LAB_INCOME: "4005",
  LIBRARY_INCOME: "4006",
  HOSTEL_INCOME: "4007",
  TRANSPORT_INCOME: "4008",
  FINE_INCOME: "4009",
  OTHER_INCOME: "4100",
  SCHOLARSHIP_EXPENSE: "5101",
  SALARY_EXPENSE: "5100",
  GENERAL_EXPENSE: "5200",
  PURCHASE_EXPENSE: "5300"
} as const;

export const FEE_TYPE_ACCOUNT_MAP: Record<FeeType, string> = {
  ADMISSION: SYSTEM_ACCOUNT_CODES.ADMISSION_INCOME,
  TUITION: SYSTEM_ACCOUNT_CODES.TUITION_INCOME,
  MONTHLY: SYSTEM_ACCOUNT_CODES.TUITION_INCOME,
  EXAM: SYSTEM_ACCOUNT_CODES.EXAM_INCOME,
  LIBRARY: SYSTEM_ACCOUNT_CODES.LIBRARY_INCOME,
  LAB: SYSTEM_ACCOUNT_CODES.LAB_INCOME,
  TRANSPORT: SYSTEM_ACCOUNT_CODES.TRANSPORT_INCOME,
  HOSTEL: SYSTEM_ACCOUNT_CODES.HOSTEL_INCOME,
  OTHER: SYSTEM_ACCOUNT_CODES.OTHER_INCOME,
  ANNUAL: SYSTEM_ACCOUNT_CODES.TUITION_INCOME,
  REGISTRATION: SYSTEM_ACCOUNT_CODES.REGISTRATION_INCOME,
  PRACTICAL: SYSTEM_ACCOUNT_CODES.LAB_INCOME,
  FINE: SYSTEM_ACCOUNT_CODES.FINE_INCOME,
  SCHOLARSHIP: SYSTEM_ACCOUNT_CODES.SCHOLARSHIP_EXPENSE,
  MISC: SYSTEM_ACCOUNT_CODES.OTHER_INCOME,
  REFUND: SYSTEM_ACCOUNT_CODES.FEE_INCOME
};

export const DEFAULT_CHART_OF_ACCOUNTS: Array<{
  code: string;
  name: string;
  nameNp?: string;
  accountType: (typeof ACCOUNT_TYPES)[number];
  parentCode?: string;
  isSystem: boolean;
}> = [
  { code: "1000", name: "Assets", nameNp: "सम्पत्ति", accountType: "ASSET", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.CASH, name: "Cash in Hand", nameNp: "हातमा नगद", accountType: "ASSET", parentCode: "1000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.BANK, name: "Bank Accounts", nameNp: "बैंक खाता", accountType: "ASSET", parentCode: "1000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.STUDENT_RECEIVABLE, name: "Student Fees Receivable", nameNp: "विद्यार्थी बाँकी", accountType: "ASSET", parentCode: "1000", isSystem: true },
  { code: "2000", name: "Liabilities", nameNp: "दायित्व", accountType: "LIABILITY", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.ACCOUNTS_PAYABLE, name: "Accounts Payable", nameNp: "देय खाता", accountType: "LIABILITY", parentCode: "2000", isSystem: true },
  { code: "3000", name: "Equity", nameNp: "पूँजी", accountType: "EQUITY", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.OPENING_BALANCE, name: "Opening Balance Equity", nameNp: "सुरुवाती शेष", accountType: "EQUITY", parentCode: "3000", isSystem: true },
  { code: "4000", name: "Fee Income", nameNp: "शुल्क आम्दानी", accountType: "INCOME", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.ADMISSION_INCOME, name: "Admission Fee Income", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.REGISTRATION_INCOME, name: "Registration Fee Income", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.TUITION_INCOME, name: "Tuition Fee Income", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.EXAM_INCOME, name: "Exam Fee Income", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.LAB_INCOME, name: "Lab/Practical Fee Income", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.LIBRARY_INCOME, name: "Library Fee Income", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.HOSTEL_INCOME, name: "Hostel Fee Income", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.TRANSPORT_INCOME, name: "Transport Fee Income", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.FINE_INCOME, name: "Fine & Penalty Income", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.OTHER_INCOME, name: "Other Income", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: "5000", name: "Expenses", nameNp: "खर्च", accountType: "EXPENSE", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.SALARY_EXPENSE, name: "Salary & Wages", accountType: "EXPENSE", parentCode: "5000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.SCHOLARSHIP_EXPENSE, name: "Scholarship Expense", accountType: "EXPENSE", parentCode: "5000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.GENERAL_EXPENSE, name: "General Expenses", accountType: "EXPENSE", parentCode: "5000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.PURCHASE_EXPENSE, name: "Purchase Expenses", accountType: "EXPENSE", parentCode: "5000", isSystem: true }
];

export const EXPENSE_CATEGORY_ACCOUNT_MAP: Record<string, string> = {
  "Office Expenses": SYSTEM_ACCOUNT_CODES.GENERAL_EXPENSE,
  Electricity: SYSTEM_ACCOUNT_CODES.GENERAL_EXPENSE,
  Water: SYSTEM_ACCOUNT_CODES.GENERAL_EXPENSE,
  Internet: SYSTEM_ACCOUNT_CODES.GENERAL_EXPENSE,
  Furniture: SYSTEM_ACCOUNT_CODES.PURCHASE_EXPENSE,
  Maintenance: SYSTEM_ACCOUNT_CODES.GENERAL_EXPENSE,
  Library: SYSTEM_ACCOUNT_CODES.GENERAL_EXPENSE,
  Laboratory: SYSTEM_ACCOUNT_CODES.GENERAL_EXPENSE,
  Sports: SYSTEM_ACCOUNT_CODES.GENERAL_EXPENSE,
  Transport: SYSTEM_ACCOUNT_CODES.GENERAL_EXPENSE,
  Events: SYSTEM_ACCOUNT_CODES.GENERAL_EXPENSE,
  Miscellaneous: SYSTEM_ACCOUNT_CODES.GENERAL_EXPENSE
};

export const INCOME_CATEGORY_ACCOUNT_MAP: Record<string, string> = {
  Donations: SYSTEM_ACCOUNT_CODES.OTHER_INCOME,
  "Government Grants": SYSTEM_ACCOUNT_CODES.OTHER_INCOME,
  "Admission Income": SYSTEM_ACCOUNT_CODES.ADMISSION_INCOME,
  "Transport Income": SYSTEM_ACCOUNT_CODES.TRANSPORT_INCOME,
  "Hostel Income": SYSTEM_ACCOUNT_CODES.HOSTEL_INCOME,
  "Miscellaneous Income": SYSTEM_ACCOUNT_CODES.OTHER_INCOME
};