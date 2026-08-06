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
  /** Input VAT paid on purchases, recoverable against output VAT (staged; unused today). */
  VAT_RECEIVABLE: "1301",
  /** Fixed assets, one control account per Income Tax Act depreciation pool. */
  FIXED_ASSET_LAND: "1400",
  FIXED_ASSET_POOL_A: "1401",
  FIXED_ASSET_POOL_B: "1402",
  FIXED_ASSET_POOL_C: "1403",
  FIXED_ASSET_POOL_D: "1404",
  FIXED_ASSET_POOL_E: "1405",
  /** Contra-asset: accumulated depreciation across all pools. */
  ACCUMULATED_DEPRECIATION: "1450",
  ACCOUNTS_PAYABLE: "2001",
  REFUND_PAYABLE: "2101",
  /** Tax withheld from salaries/vendors and owed to the IRD until deposited. */
  TDS_PAYABLE: "2103",
  /** Output VAT collected on taxable supplies (staged; unused while all supplies are exempt). */
  VAT_PAYABLE: "2104",
  /** Student admission security / caution deposits held (refundable liability) */
  SECURITY_DEPOSIT_LIABILITY: "2102",
  OPENING_BALANCE: "3001",
  CAPITAL: "3002",
  /**
   * Accumulated Fund (retained earnings). Year-end closing transfers the net
   * surplus/deficit of income and expense accounts here, so cumulative equity
   * carries across fiscal years.
   */
  ACCUMULATED_FUND: "3003",
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
  DEPRECIATION_EXPENSE: "5210",
  /** Gain (credit) or loss (debit) on disposal of a fixed asset. */
  ASSET_DISPOSAL: "4105",
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
  REFUND: SYSTEM_ACCOUNT_CODES.OTHER_INCOME,
  /** Deposit is a liability, not income */
  SECURITY_DEPOSIT: SYSTEM_ACCOUNT_CODES.SECURITY_DEPOSIT_LIABILITY
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
  {
    code: SYSTEM_ACCOUNT_CODES.VAT_RECEIVABLE,
    name: "VAT Receivable (Input)",
    nameNp: "मू.अ.कर प्राप्य",
    accountType: "ASSET",
    parentCode: "1000",
    isSystem: true
  },
  { code: SYSTEM_ACCOUNT_CODES.FIXED_ASSET_LAND, name: "Land", nameNp: "जग्गा", accountType: "ASSET", parentCode: "1000", isSystem: true },
  {
    code: SYSTEM_ACCOUNT_CODES.FIXED_ASSET_POOL_A,
    name: "Buildings & Structures (Pool A)",
    nameNp: "भवन तथा संरचना",
    accountType: "ASSET",
    parentCode: "1000",
    isSystem: true
  },
  {
    code: SYSTEM_ACCOUNT_CODES.FIXED_ASSET_POOL_B,
    name: "Computers, Furniture & Office Equipment (Pool B)",
    nameNp: "कम्प्युटर, फर्निचर तथा कार्यालय उपकरण",
    accountType: "ASSET",
    parentCode: "1000",
    isSystem: true
  },
  {
    code: SYSTEM_ACCOUNT_CODES.FIXED_ASSET_POOL_C,
    name: "Vehicles (Pool C)",
    nameNp: "सवारी साधन",
    accountType: "ASSET",
    parentCode: "1000",
    isSystem: true
  },
  {
    code: SYSTEM_ACCOUNT_CODES.FIXED_ASSET_POOL_D,
    name: "Plant, Machinery & Other Assets (Pool D)",
    nameNp: "मेसिनरी तथा अन्य सम्पत्ति",
    accountType: "ASSET",
    parentCode: "1000",
    isSystem: true
  },
  {
    code: SYSTEM_ACCOUNT_CODES.FIXED_ASSET_POOL_E,
    name: "Intangible Assets (Pool E)",
    nameNp: "अमूर्त सम्पत्ति",
    accountType: "ASSET",
    parentCode: "1000",
    isSystem: true
  },
  {
    code: SYSTEM_ACCOUNT_CODES.ACCUMULATED_DEPRECIATION,
    name: "Accumulated Depreciation",
    nameNp: "संचित ह्रास कट्टी",
    accountType: "ASSET",
    parentCode: "1000",
    isSystem: true
  },
  { code: "2000", name: "Liabilities", nameNp: "दायित्व", accountType: "LIABILITY", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.ACCOUNTS_PAYABLE, name: "Accounts Payable", nameNp: "देय खाता", accountType: "LIABILITY", parentCode: "2000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.REFUND_PAYABLE, name: "Refund Payable", nameNp: "फिर्ता देय", accountType: "LIABILITY", parentCode: "2000", isSystem: true },
  {
    code: SYSTEM_ACCOUNT_CODES.TDS_PAYABLE,
    name: "TDS Payable",
    nameNp: "अग्रिम कर कट्टी देय",
    accountType: "LIABILITY",
    parentCode: "2000",
    isSystem: true
  },
  {
    code: SYSTEM_ACCOUNT_CODES.VAT_PAYABLE,
    name: "VAT Payable (Output)",
    nameNp: "मू.अ.कर देय",
    accountType: "LIABILITY",
    parentCode: "2000",
    isSystem: true
  },
  {
    code: SYSTEM_ACCOUNT_CODES.SECURITY_DEPOSIT_LIABILITY,
    name: "Student Security Deposit",
    nameNp: "विद्यार्थी धरौटी",
    accountType: "LIABILITY",
    parentCode: "2000",
    isSystem: true
  },
  { code: "3000", name: "Equity", nameNp: "पूँजी", isSystem: true, accountType: "EQUITY" },
  { code: SYSTEM_ACCOUNT_CODES.CAPITAL, name: "Capital", nameNp: "पूँजी", accountType: "EQUITY", parentCode: "3000", isSystem: true },
  { code: SYSTEM_ACCOUNT_CODES.OPENING_BALANCE, name: "Opening Balance Equity", nameNp: "सुरुवाती शेष", accountType: "EQUITY", parentCode: "3000", isSystem: true },
  {
    code: SYSTEM_ACCOUNT_CODES.ACCUMULATED_FUND,
    name: "Accumulated Fund",
    nameNp: "संचित कोष",
    accountType: "EQUITY",
    parentCode: "3000",
    isSystem: true
  },
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
  {
    code: SYSTEM_ACCOUNT_CODES.ASSET_DISPOSAL,
    name: "Gain / (Loss) on Asset Disposal",
    nameNp: "सम्पत्ति बिक्री नाफा/नोक्सान",
    accountType: "INCOME",
    parentCode: "4000",
    isSystem: true
  },
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
  {
    code: SYSTEM_ACCOUNT_CODES.DEPRECIATION_EXPENSE,
    name: "Depreciation",
    nameNp: "ह्रास कट्टी",
    accountType: "EXPENSE",
    parentCode: "5000",
    isSystem: true
  },
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
/**
 * Depreciation pools per the Income Tax Act 2058, Schedule 2.
 *
 * Nepal taxes depreciation on a *pooled, diminishing-balance* basis rather than per asset:
 * every asset in a class joins that class's pool and the whole pool depreciates at the
 * statutory rate on its written-down value. Land is deliberately not a pool — it is not
 * depreciable.
 */
export const DEPRECIATION_POOLS = [
  {
    pool: "A",
    label: "Buildings & structures of a permanent nature",
    labelNp: "स्थायी प्रकृतिका भवन तथा संरचना",
    ratePercent: 5,
    accountCode: SYSTEM_ACCOUNT_CODES.FIXED_ASSET_POOL_A
  },
  {
    pool: "B",
    label: "Computers, data handling equipment, fixtures, office furniture & equipment",
    labelNp: "कम्प्युटर, फर्निचर तथा कार्यालय उपकरण",
    ratePercent: 25,
    accountCode: SYSTEM_ACCOUNT_CODES.FIXED_ASSET_POOL_B
  },
  {
    pool: "C",
    label: "Automobiles, buses and minibuses",
    labelNp: "सवारी साधन, बस तथा मिनिबस",
    ratePercent: 20,
    accountCode: SYSTEM_ACCOUNT_CODES.FIXED_ASSET_POOL_C
  },
  {
    pool: "D",
    label: "Plant, machinery and any depreciable asset not in another pool",
    labelNp: "मेसिनरी तथा अन्य ह्रासयोग्य सम्पत्ति",
    ratePercent: 15,
    accountCode: SYSTEM_ACCOUNT_CODES.FIXED_ASSET_POOL_D
  },
  {
    pool: "E",
    label: "Intangible assets (amortised over useful life)",
    labelNp: "अमूर्त सम्पत्ति",
    ratePercent: 0,
    accountCode: SYSTEM_ACCOUNT_CODES.FIXED_ASSET_POOL_E
  },
  {
    pool: "LAND",
    label: "Land (not depreciable)",
    labelNp: "जग्गा (ह्रास नलाग्ने)",
    ratePercent: 0,
    accountCode: SYSTEM_ACCOUNT_CODES.FIXED_ASSET_LAND
  }
] as const;

export const DEPRECIATION_POOL_KEYS = DEPRECIATION_POOLS.map((p) => p.pool);
export type DepreciationPool = (typeof DEPRECIATION_POOLS)[number]["pool"];

export const getDepreciationPool = (pool: string) =>
  DEPRECIATION_POOLS.find((entry) => entry.pool === pool);

export const DEPRECIATION_METHODS = ["WDV", "SLM"] as const;
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];
