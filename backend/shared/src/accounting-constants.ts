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

/** System chart of accounts codes for PHIT ERP (Nepal college) */
export const SYSTEM_ACCOUNT_CODES = {
  CASH: "1001",
  BANK: "1101",
  STUDENT_RECEIVABLE: "1201",
  ACCOUNTS_PAYABLE: "2001",
  REFUND_PAYABLE: "2101",
  OPENING_BALANCE: "3001",
  CAPITAL: "3002",
  /** Leaf “general fee income” — must not share code with parent group 4000 */
  FEE_INCOME: "4090",
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
  DONATION_INCOME: "4101",
  CERTIFICATE_INCOME: "4102",
  FORM_SALES_INCOME: "4103",
  INTEREST_INCOME: "4104",
  SCHOLARSHIP_EXPENSE: "5101",
  SALARY_EXPENSE: "5100",
  GENERAL_EXPENSE: "5200",
  PURCHASE_EXPENSE: "5300",
  REFUND_EXPENSE: "5400",
  LAB_EXPENSE: "5201",
  LIBRARY_EXPENSE: "5202",
  ELECTRICITY_EXPENSE: "5203",
  INTERNET_EXPENSE: "5204",
  MAINTENANCE_EXPENSE: "5205",
  HOSPITAL_EXPENSE: "5206",
  COMMUNITY_FIELD_EXPENSE: "5207",
  OFFICE_EXPENSE: "5208",
  MISC_EXPENSE: "5209"
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
  REFUND: SYSTEM_ACCOUNT_CODES.OTHER_INCOME
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
  { code: SYSTEM_ACCOUNT_CODES.CASH, name: "Cash", nameNp: "नगद", accountType: "ASSET", parentCode: "1000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.BANK, name: "Bank", nameNp: "बैंक", accountType: "ASSET", parentCode: "1000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.STUDENT_RECEIVABLE, name: "Student Fees Receivable", nameNp: "विद्यार्थी बाँकी", accountType: "ASSET", parentCode: "1000", isSystem: true },
  { code: "2000", name: "Liabilities", nameNp: "दायित्व", accountType: "LIABILITY", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.ACCOUNTS_PAYABLE, name: "Accounts Payable", nameNp: "देय खाता", accountType: "LIABILITY", parentCode: "2000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.REFUND_PAYABLE, name: "Refund Payable", nameNp: "फिर्ता देय", accountType: "LIABILITY", parentCode: "2000", isSystem: true },
  { code: "3000", name: "Equity", nameNp: "पूँजी", accountType: "EQUITY", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.CAPITAL, name: "Capital", nameNp: "पूँजी", accountType: "EQUITY", parentCode: "3000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.OPENING_BALANCE, name: "Opening Balance Equity", nameNp: "सुरुवाती शेष", accountType: "EQUITY", parentCode: "3000", isSystem: true },
  { code: "4000", name: "Income", nameNp: "आम्दानी", accountType: "INCOME", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.FEE_INCOME, name: "Fee Income (General)", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.ADMISSION_INCOME, name: "Admission Fee", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.REGISTRATION_INCOME, name: "Registration Fee", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.TUITION_INCOME, name: "Tuition Fee", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.EXAM_INCOME, name: "Examination Fee", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.LAB_INCOME, name: "Laboratory Fee", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.LIBRARY_INCOME, name: "Library Fee", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.HOSTEL_INCOME, name: "Hostel Fee", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.TRANSPORT_INCOME, name: "Transport Fee", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.FINE_INCOME, name: "Fine", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.DONATION_INCOME, name: "Donation", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.CERTIFICATE_INCOME, name: "Certificate Fee", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.FORM_SALES_INCOME, name: "Form Sales", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.INTEREST_INCOME, name: "Interest", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.OTHER_INCOME, name: "Miscellaneous Income", accountType: "INCOME", parentCode: "4000", isSystem: true },
  { code: "5000", name: "Expenses", nameNp: "खर्च", accountType: "EXPENSE", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.SALARY_EXPENSE, name: "Salary Expense", accountType: "EXPENSE", parentCode: "5000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.SCHOLARSHIP_EXPENSE, name: "Scholarship Expense", accountType: "EXPENSE", parentCode: "5000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.LAB_EXPENSE, name: "Laboratory Expense", accountType: "EXPENSE", parentCode: "5000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.LIBRARY_EXPENSE, name: "Library Expense", accountType: "EXPENSE", parentCode: "5000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.ELECTRICITY_EXPENSE, name: "Electricity Expense", accountType: "EXPENSE", parentCode: "5000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.INTERNET_EXPENSE, name: "Internet Expense", accountType: "EXPENSE", parentCode: "5000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.MAINTENANCE_EXPENSE, name: "Maintenance Expense", accountType: "EXPENSE", parentCode: "5000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.HOSPITAL_EXPENSE, name: "Hospital Expense", accountType: "EXPENSE", parentCode: "5000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.COMMUNITY_FIELD_EXPENSE, name: "Community Field Expense", accountType: "EXPENSE", parentCode: "5000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.OFFICE_EXPENSE, name: "Office Expense", accountType: "EXPENSE", parentCode: "5000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.MISC_EXPENSE, name: "Miscellaneous Expense", accountType: "EXPENSE", parentCode: "5000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.GENERAL_EXPENSE, name: "General Expenses", accountType: "EXPENSE", parentCode: "5000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.PURCHASE_EXPENSE, name: "Purchase Expenses", accountType: "EXPENSE", parentCode: "5000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.REFUND_EXPENSE, name: "Refund Expense", accountType: "EXPENSE", parentCode: "5000", isSystem: true }
];

export const EXPENSE_CATEGORY_ACCOUNT_MAP: Record<string, string> = {
  Electricity: SYSTEM_ACCOUNT_CODES.ELECTRICITY_EXPENSE,
  Water: SYSTEM_ACCOUNT_CODES.MISC_EXPENSE,
  Internet: SYSTEM_ACCOUNT_CODES.INTERNET_EXPENSE,
  Fuel: SYSTEM_ACCOUNT_CODES.GENERAL_EXPENSE,
  Maintenance: SYSTEM_ACCOUNT_CODES.MAINTENANCE_EXPENSE,
  Office: SYSTEM_ACCOUNT_CODES.OFFICE_EXPENSE,
  "Office Expenses": SYSTEM_ACCOUNT_CODES.OFFICE_EXPENSE,
  Printing: SYSTEM_ACCOUNT_CODES.OFFICE_EXPENSE,
  Travel: SYSTEM_ACCOUNT_CODES.GENERAL_EXPENSE,
  "Community Field": SYSTEM_ACCOUNT_CODES.COMMUNITY_FIELD_EXPENSE,
  Hospital: SYSTEM_ACCOUNT_CODES.HOSPITAL_EXPENSE,
  Library: SYSTEM_ACCOUNT_CODES.LIBRARY_EXPENSE,
  Laboratory: SYSTEM_ACCOUNT_CODES.LAB_EXPENSE,
  Furniture: SYSTEM_ACCOUNT_CODES.PURCHASE_EXPENSE,
  Sports: SYSTEM_ACCOUNT_CODES.GENERAL_EXPENSE,
  Transport: SYSTEM_ACCOUNT_CODES.GENERAL_EXPENSE,
  Events: SYSTEM_ACCOUNT_CODES.GENERAL_EXPENSE,
  Miscellaneous: SYSTEM_ACCOUNT_CODES.MISC_EXPENSE
};

export const PURCHASE_CATEGORY_ACCOUNT_MAP: Record<string, string> = {
  "Laboratory Equipment": SYSTEM_ACCOUNT_CODES.LAB_EXPENSE,
  Books: SYSTEM_ACCOUNT_CODES.LIBRARY_EXPENSE,
  Furniture: SYSTEM_ACCOUNT_CODES.PURCHASE_EXPENSE,
  Stationery: SYSTEM_ACCOUNT_CODES.OFFICE_EXPENSE,
  "Computer Equipment": SYSTEM_ACCOUNT_CODES.PURCHASE_EXPENSE,
  Computers: SYSTEM_ACCOUNT_CODES.PURCHASE_EXPENSE,
  Chemicals: SYSTEM_ACCOUNT_CODES.LAB_EXPENSE,
  "Medical Equipment": SYSTEM_ACCOUNT_CODES.HOSPITAL_EXPENSE,
  "Office Supplies": SYSTEM_ACCOUNT_CODES.OFFICE_EXPENSE,
  "Sports Equipment": SYSTEM_ACCOUNT_CODES.PURCHASE_EXPENSE,
  "Other Assets": SYSTEM_ACCOUNT_CODES.PURCHASE_EXPENSE,
  Others: SYSTEM_ACCOUNT_CODES.PURCHASE_EXPENSE
};

export const INCOME_CATEGORY_ACCOUNT_MAP: Record<string, string> = {
  Donation: SYSTEM_ACCOUNT_CODES.DONATION_INCOME,
  Donations: SYSTEM_ACCOUNT_CODES.DONATION_INCOME,
  "Certificate Fee": SYSTEM_ACCOUNT_CODES.CERTIFICATE_INCOME,
  "Form Sales": SYSTEM_ACCOUNT_CODES.FORM_SALES_INCOME,
  Fine: SYSTEM_ACCOUNT_CODES.FINE_INCOME,
  Interest: SYSTEM_ACCOUNT_CODES.INTEREST_INCOME,
  "Miscellaneous Income": SYSTEM_ACCOUNT_CODES.OTHER_INCOME,
  "Government Grants": SYSTEM_ACCOUNT_CODES.OTHER_INCOME,
  "Admission Income": SYSTEM_ACCOUNT_CODES.ADMISSION_INCOME,
  "Transport Income": SYSTEM_ACCOUNT_CODES.TRANSPORT_INCOME,
  "Hostel Income": SYSTEM_ACCOUNT_CODES.HOSTEL_INCOME
};