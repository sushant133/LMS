import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { JournalVoucherDetails } from "@phit-erp/shared";
import { useQuery } from "@tanstack/react-query";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  PURCHASE_CATEGORIES,
  type BankAccountRecord,
  type BankCashSummary,
  type BankCashTransferType,
  type BatchRecord,
  type StudentRecord,
  type YearRecord,
} from "@phit-erp/shared";
import { AlertTriangle, CheckCircle2, FileText, NotebookPen, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader } from "components/ui/card";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { SearchSelect, type SearchSelectOption } from "components/ui/search-select";
import { Select } from "components/ui/select";
import { useAuth } from "features/auth/AuthProvider";
import { api, unwrap } from "lib/api";
import { cn, parseErrorMessage } from "lib/utils";
import { CASH, amount, bankLabel, npr, todayBs } from "./bankCashShared";
import { invalidateAccountingQueries } from "./invalidateAccountingQueries";
import { BankCashSectionTitle } from "./BankCashSectionTitle";

/**
 * Accounts a row can be posted to. Each is saved through that section's own
 * API, so the record shows in its section and its journal voucher is posted
 * automatically (Dr / Cr always equal).
 */
type EntryAccount =
  | "STUDENT_FEE"
  | "SECURITY_DEPOSIT"
  | "OTHER_RECEIPT"
  | "DIRECT_EXPENSE"
  | "INDIRECT_EXPENSE"
  | "TRANSFER";

const ENTRY_ACCOUNTS: Record<EntryAccount, { label: string; side: "debit" | "credit" | "both"; contra: string }> = {
  STUDENT_FEE: { label: "Student Fee Records", side: "debit", contra: "Student Fee (receivable)" },
  SECURITY_DEPOSIT: { label: "Security Deposits", side: "debit", contra: "Security Deposit held" },
  OTHER_RECEIPT: { label: "Other Receipts", side: "debit", contra: "Other Income" },
  DIRECT_EXPENSE: { label: "Direct Expense", side: "credit", contra: "Direct Expense" },
  INDIRECT_EXPENSE: { label: "Indirect Expenses", side: "credit", contra: "Indirect Expenses" },
  TRANSFER: { label: "Cash ↔ Bank Transfer", side: "both", contra: "" },
};

/** Sections with their own workflow — opened from here, not posted from the grid. */
const SECTION_LINKS = [
  { value: "link:fee-records", label: "Student Fee Records — full form", hint: "Discount, scholarship, new charges", tab: "fee-records" },
  { value: "link:salary-records", label: "Salary Sheet / Payroll", hint: "Prepare, approve and pay salaries", tab: "salary-records" },
  { value: "link:refund-records", label: "Refund Records", hint: "Refunds need approval", tab: "refund-records" },
  { value: "link:journal-entries", label: "Journal Entries", hint: "Adjustments without cash / bank", tab: "journal-entries" },
] as const;

const ACCOUNT_OPTIONS: SearchSelectOption[] = [
  ...(["STUDENT_FEE", "SECURITY_DEPOSIT", "OTHER_RECEIPT"] as const).map((key) => ({
    value: key,
    label: ENTRY_ACCOUNTS[key].label,
    group: "Receipt — money in (Debit)",
  })),
  ...(["DIRECT_EXPENSE", "INDIRECT_EXPENSE"] as const).map((key) => ({
    value: key,
    label: ENTRY_ACCOUNTS[key].label,
    group: "Payment — money out (Credit)",
  })),
  {
    value: "TRANSFER",
    label: ENTRY_ACCOUNTS.TRANSFER.label,
    hint: "Deposit, withdrawal, bank to bank",
    group: "Contra — between Cash and Bank",
    keywords: "deposit withdraw contra",
  },
  ...SECTION_LINKS.map((link) => ({
    value: link.value,
    label: `${link.label} →`,
    hint: link.hint,
    group: "Open section",
  })),
];

interface EntryRow {
  key: number;
  dateBs: string;
  account: EntryAccount | "";
  description: string;
  cashBank: string;
  debit?: number;
  credit?: number;
  remarks: string;
  studentId: string;
  programYear: string;
  receiptNumber: string;
  category: string;
  vendor: string;
  billNumber: string;
  otherSide: string;
  /** Student Fee: fee head the payment is credited to (Tuition by default). */
  feeType: string;
  /** Direct / Indirect Expense: printed on its Journal Voucher (AGF No. 10). */
  voucher: JournalVoucherDetails;
  error?: string;
}

const isExpense = (account: EntryRow["account"]) =>
  account === "DIRECT_EXPENSE" || account === "INDIRECT_EXPENSE";

/** Journal Voucher fields; required ones must be filled before an expense row is saved. */
const VOUCHER_FIELDS: Array<{
  key: keyof JournalVoucherDetails;
  label: string;
  required?: boolean;
  wide?: boolean;
  placeholder?: string;
}> = [
  { key: "narration", label: "Narration", required: true, wide: true, placeholder: "Being … paid for …" },
  { key: "receiptNo", label: "Bill / Receipt No.", required: true },
  { key: "chequeNo", label: "Cheque No." },
  { key: "chequeDateBs", label: "Cheque Date (BS)", placeholder: "YYYY-MM-DD" },
  { key: "preparedByName", label: "Prepared By", required: true },
  { key: "preparedByDesignation", label: "Designation (Prepared)", placeholder: "e.g. Accountant" },
  { key: "checkedByName", label: "Checked By", required: true },
  { key: "approvedByName", label: "Approved By", required: true },
  { key: "receivedByName", label: "Received By (payee)", required: true },
  { key: "receivedByDesignation", label: "Designation (Received)" },
];

let rowKey = 0;
const newRow = (base?: Partial<EntryRow>): EntryRow => ({
  key: ++rowKey,
  dateBs: base?.dateBs ?? todayBs(),
  account: "",
  description: "",
  cashBank: base?.cashBank ?? CASH,
  remarks: "",
  studentId: "",
  programYear: "1",
  receiptNumber: "",
  category: "",
  vendor: "",
  billNumber: "",
  otherSide: "",
  feeType: "TUITION",
  voucher: {},
});

/** Fee heads offered for a student fee row (each posts to its own fee income account). */
const FEE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "TUITION", label: "Tuition fee" },
  { value: "ADMISSION", label: "Admission fee" },
  { value: "REGISTRATION", label: "Registration fee" },
  { value: "EXAM", label: "Examination fee" },
  { value: "LAB", label: "Laboratory fee" },
  { value: "LIBRARY", label: "Library fee" },
  { value: "HOSTEL", label: "Hostel fee" },
  { value: "TRANSPORT", label: "Transport fee" },
  { value: "FINE", label: "Fine / late fee" },
];

const isBlank = (row: EntryRow) =>
  !row.account && !row.description.trim() && !row.debit && !row.credit && !row.remarks.trim();

interface BankCashEntryProps {
  banks: BankAccountRecord[];
  summary?: BankCashSummary;
  onOpenSection: (tab: string) => void;
}

export const BankCashEntry = ({ banks, summary, onOpenSection }: BankCashEntryProps) => {
  const { user } = useAuth();
  const currentUserName = user?.fullName ?? "";
  const activeBanks = useMemo(() => banks.filter((bank) => bank.isActive), [banks]);

  const studentsQuery = useQuery({
    queryKey: ["students", "fee-picker", "login-active"],
    queryFn: () => unwrap<StudentRecord[]>(api.get("/students", { params: { loginActive: "1" } })),
  });
  const yearsQuery = useQuery({
    queryKey: ["years"],
    queryFn: () => unwrap<YearRecord[]>(api.get("/academics/years")),
  });
  const batchesQuery = useQuery({
    queryKey: ["batches"],
    queryFn: () => unwrap<BatchRecord[]>(api.get("/academics/batches")),
  });

  const students = studentsQuery.data ?? [];
  const yearById = useMemo(
    () => new Map((yearsQuery.data ?? []).map((year) => [year._id, year])),
    [yearsQuery.data],
  );
  const batchById = useMemo(
    () => new Map((batchesQuery.data ?? []).map((batch) => [batch._id, batch.name])),
    [batchesQuery.data],
  );
  const studentOptions = useMemo<SearchSelectOption[]>(
    () =>
      students.map((student) => ({
        value: student._id,
        label: student.user?.fullName ?? "Student",
        hint: [
          `Roll ${student.rollNumber}`,
          student.admissionNumber,
          student.batchId ? batchById.get(student.batchId) : "",
          student.yearId ? yearById.get(student.yearId)?.name : "",
        ]
          .filter(Boolean)
          .join(" · "),
        keywords: `${student.rollNumber} ${student.admissionNumber ?? ""}`,
      })),
    [students, batchById, yearById],
  );

  const cashBankOptions = useMemo(
    () => [
      { value: CASH, label: "Cash in Hand" },
      ...activeBanks.map((bank) => ({ value: bank._id, label: bankLabel(bank) })),
    ],
    [activeBanks],
  );
  const cashBankName = (value: string) =>
    cashBankOptions.find((option) => option.value === value)?.label ?? "Bank";

  const [rows, setRows] = useState<EntryRow[]>(() => [newRow()]);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string[]>([]);

  const updateRow = (key: number, patch: Partial<EntryRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch, error: undefined } : row)));

  const addRow = () =>
    setRows((current) => {
      const last = current[current.length - 1];
      return [...current, newRow({ dateBs: last?.dateBs, cashBank: last?.cashBank })];
    });

  const chooseAccount = (row: EntryRow, value: string) => {
    const link = SECTION_LINKS.find((item) => item.value === value);
    if (link) {
      onOpenSection(link.tab);
      return;
    }
    const account = value as EntryAccount;
    const side = ENTRY_ACCOUNTS[account].side;
    const typed = row.debit ?? row.credit;
    updateRow(row.key, {
      account,
      category: "",
      debit: side === "credit" ? undefined : side === "debit" ? typed : row.debit,
      credit: side === "debit" ? undefined : side === "credit" ? typed : row.credit,
      voucher: isExpense(account)
        ? { preparedByName: currentUserName, ...row.voucher }
        : row.voucher,
    });
  };

  /** Voucher details as they will be saved: the bill no. and payee fill in from the row. */
  const voucherDetailsFor = (row: EntryRow): JournalVoucherDetails => {
    const v = row.voucher ?? {};
    const trimmed = Object.fromEntries(
      Object.entries(v).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]),
    ) as JournalVoucherDetails;
    return {
      ...trimmed,
      receiptNo: trimmed.receiptNo || (row.account === "DIRECT_EXPENSE" ? row.billNumber.trim() : ""),
      receivedByName: trimmed.receivedByName || row.vendor.trim(),
      narration: trimmed.narration || row.description.trim(),
    };
  };

  const voucherError = (row: EntryRow): string | null => {
    const details = voucherDetailsFor(row);
    const missing = VOUCHER_FIELDS.filter((field) => field.required && !String(details[field.key] ?? "").trim());
    if (missing.length) {
      return `Journal Voucher: enter ${missing.map((field) => field.label).join(", ")}`;
    }
    if (details.chequeNo && !details.chequeDateBs) return "Journal Voucher: enter the cheque date";
    return null;
  };

  // ---------------------------------------------------------------- validation
  const rowError = (row: EntryRow, all: EntryRow[]): string | null => {
    if (!row.account) return "Choose an account";
    if (!row.dateBs) return "Enter the date";
    const debit = row.debit ?? 0;
    const credit = row.credit ?? 0;
    if (debit > 0 && credit > 0) return "Enter the amount in Debit or Credit, not both";
    if (debit <= 0 && credit <= 0) return "Enter the amount in Debit (received) or Credit (paid)";
    const needsReceipt = row.account === "STUDENT_FEE" || row.account === "SECURITY_DEPOSIT" || row.account === "OTHER_RECEIPT";
    if (needsReceipt && row.receiptNumber.trim()) {
      const clash = all.find(
        (other) =>
          other.key !== row.key &&
          other.receiptNumber.trim().toLowerCase() === row.receiptNumber.trim().toLowerCase(),
      );
      if (clash) return `Receipt No. ${row.receiptNumber} is used on another row`;
    }
    switch (row.account) {
      case "STUDENT_FEE":
      case "SECURITY_DEPOSIT":
        if (!row.studentId) return "Choose the student";
        if (!row.receiptNumber.trim()) return "Enter the receipt number";
        return null;
      case "OTHER_RECEIPT":
        if (!row.category) return "Choose the receipt category";
        if (!row.description.trim()) return "Write who it was received from in Description";
        if (!row.receiptNumber.trim()) return "Enter the receipt number";
        return null;
      case "DIRECT_EXPENSE":
        if (!row.category) return "Choose the category";
        if (!row.vendor.trim()) return "Enter the vendor / supplier";
        if (!row.billNumber.trim()) return "Enter the bill / invoice number";
        return voucherError(row);
      case "INDIRECT_EXPENSE":
        if (!row.category) return "Choose the category";
        if (!row.description.trim()) return "Enter a description";
        return voucherError(row);
      case "TRANSFER":
        if (!row.otherSide) return "Choose the other Cash / Bank account";
        if (row.otherSide === row.cashBank) return "Choose two different Cash / Bank accounts";
        return null;
    }
  };

  // ---------------------------------------------------------------- double entry
  /** The voucher this row will post: Dr lines = Cr lines. */
  const voucherFor = (row: EntryRow): { dr: string; cr: string; value: number } | null => {
    if (!row.account) return null;
    const value = (row.debit ?? 0) || (row.credit ?? 0);
    if (!value) return null;
    const here = cashBankName(row.cashBank);
    const category = row.category ? ` — ${row.category}` : "";
    if (row.account === "TRANSFER") {
      if (!row.otherSide) return null;
      const other = cashBankName(row.otherSide);
      return (row.debit ?? 0) > 0 ? { dr: here, cr: other, value } : { dr: other, cr: here, value };
    }
    const contra = `${ENTRY_ACCOUNTS[row.account].contra}${category}`;
    return ENTRY_ACCOUNTS[row.account].side === "debit" ? { dr: here, cr: contra, value } : { dr: contra, cr: here, value };
  };

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    const effect = new Map<string, number>();
    const move = (key: string, delta: number) => effect.set(key, (effect.get(key) ?? 0) + delta);
    for (const row of rows) {
      const d = row.debit ?? 0;
      const c = row.credit ?? 0;
      debit += d;
      credit += c;
      if (!row.account) continue;
      move(row.cashBank, d - c);
      if (row.account === "TRANSFER" && row.otherSide) move(row.otherSide, c - d);
    }
    return { debit, credit, effect };
  }, [rows]);

  const currentBalance = (key: string) =>
    key === CASH
      ? summary?.cashInHandNpr ?? 0
      : summary?.banks.find((bank) => bank.bankAccountId === key)?.balanceNpr ?? 0;

  const projections = [...totals.effect.entries()]
    .filter(([, delta]) => Math.abs(delta) >= 0.01)
    .map(([key, delta]) => ({
      key,
      name: cashBankName(key),
      now: currentBalance(key),
      after: currentBalance(key) + delta,
      delta,
    }));

  // ---------------------------------------------------------------- posting
  const paymentFields = (cashBank: string) =>
    cashBank === CASH ? { paymentMethod: "CASH" } : { paymentMethod: "BANK_TRANSFER", bankAccountId: cashBank };
  const joinText = (...parts: string[]) => parts.map((part) => part.trim()).filter(Boolean).join(" — ");

  /** Post one row through its section's API; returns the receipt / voucher number. */
  const postRow = async (row: EntryRow): Promise<string> => {
    const value = (row.debit ?? 0) || (row.credit ?? 0);
    const payment = paymentFields(row.cashBank);
    switch (row.account) {
      case "STUDENT_FEE": {
        const saved = await unwrap<{ receiptNumber?: string }>(
          api.post("/accounting/collections", {
            studentId: row.studentId,
            receiptNumber: row.receiptNumber.trim(),
            paidDateBs: row.dateBs,
            programYear: Number(row.programYear) || 1,
            // Payment against the student's existing fee plan: settle the oldest due year first
            // (tuition only — other fee heads are not part of the year plan)
            applyToOldestDue: (row.feeType || "TUITION") === "TUITION",
            currentChargesNpr: 0,
            amountPaidNpr: value,
            advanceAllocations: [],
            securityDepositPaidNpr: 0,
            discountNpr: 0,
            scholarshipNpr: 0,
            lateFeeNpr: 0,
            ...payment,
            receivedByName: currentUserName || undefined,
            notes: joinText(row.description, row.remarks) || undefined,
            feeBreakdown: [
              {
                feeType: row.feeType || "TUITION",
                title: FEE_TYPE_OPTIONS.find((option) => option.value === (row.feeType || "TUITION"))?.label ?? "Tuition fee",
                amountNpr: value,
              },
            ],
          }),
        );
        return saved?.receiptNumber ?? row.receiptNumber;
      }
      case "SECURITY_DEPOSIT": {
        const saved = await unwrap<{ receiptNumber?: string }>(
          api.post("/accounting/collections", {
            studentId: row.studentId,
            receiptNumber: row.receiptNumber.trim(),
            paidDateBs: row.dateBs,
            programYear: 1,
            currentChargesNpr: 0,
            amountPaidNpr: 0,
            securityDepositPaidNpr: value,
            discountNpr: 0,
            scholarshipNpr: 0,
            lateFeeNpr: 0,
            ...payment,
            receivedByName: currentUserName || undefined,
            notes: joinText(row.description, row.remarks) || undefined,
            feeBreakdown: [{ feeType: "SECURITY_DEPOSIT", title: "Security / caution deposit", amountNpr: value }],
          }),
        );
        return saved?.receiptNumber ?? row.receiptNumber;
      }
      case "OTHER_RECEIPT": {
        const saved = await unwrap<{ receiptNumber?: string }>(
          api.post("/accounting/income", {
            category: row.category,
            source: row.description.trim(),
            dateBs: row.dateBs,
            amountNpr: value,
            ...payment,
            description: row.remarks.trim(),
            receiptNumber: row.receiptNumber.trim(),
          }),
        );
        return saved?.receiptNumber ?? row.receiptNumber;
      }
      case "DIRECT_EXPENSE": {
        const saved = await unwrap<{ voucherNumber?: string }>(
          api.post("/accounting/purchases", {
            category: row.category,
            vendor: row.vendor.trim(),
            purchaseDateBs: row.dateBs,
            invoiceNumber: row.billNumber.trim(),
            item: row.description.trim(),
            quantity: 1,
            unitPriceNpr: value,
            paymentStatus: "PAID",
            ...payment,
            description: row.remarks.trim(),
            voucherDetails: voucherDetailsFor(row),
          }),
        );
        return saved?.voucherNumber ?? "";
      }
      case "INDIRECT_EXPENSE": {
        const saved = await unwrap<{ voucherNumber?: string }>(
          api.post("/accounting/expenses", {
            category: row.category,
            vendor: row.vendor.trim(),
            dateBs: row.dateBs,
            amountNpr: value,
            ...payment,
            description: joinText(row.description, row.remarks),
            approvedBy: voucherDetailsFor(row).approvedByName,
            voucherDetails: voucherDetailsFor(row),
          }),
        );
        return saved?.voucherNumber ?? "";
      }
      case "TRANSFER": {
        // Debit: money comes into this row's Cash / Bank; Credit: it goes out
        const incoming = (row.debit ?? 0) > 0;
        const from = incoming ? row.otherSide : row.cashBank;
        const to = incoming ? row.cashBank : row.otherSide;
        const transferType: BankCashTransferType =
          from === CASH ? "CASH_TO_BANK" : to === CASH ? "BANK_TO_CASH" : "BANK_TO_BANK";
        const saved = await unwrap<{ voucherNumber?: string }>(
          api.post("/accounting/bank-cash/transfers", {
            transferType,
            dateBs: row.dateBs,
            amountNpr: value,
            fromBankAccountId: from === CASH ? undefined : from,
            toBankAccountId: to === CASH ? undefined : to,
            narration: row.description.trim(),
            referenceNumber: row.remarks.trim(),
          }),
        );
        return saved?.voucherNumber ?? "";
      }
      default:
        throw new Error("Choose an account");
    }
  };

  const saveAll = async () => {
    if (saving) return;
    const filled = rows.filter((row) => !isBlank(row));
    if (filled.length === 0) {
      toast.error("Enter at least one row");
      return;
    }
    const errors = new Map(filled.map((row) => [row.key, rowError(row, filled)] as const));
    if ([...errors.values()].some(Boolean)) {
      setRows((current) => current.map((row) => (errors.get(row.key) ? { ...row, error: errors.get(row.key)! } : row)));
      toast.error("Check the rows marked in red");
      return;
    }

    setSaving(true);
    const saved: string[] = [];
    const savedKeys = new Set<number>();
    const failed = new Map<number, string>();
    // One at a time, in order, so receipt / voucher numbers stay sequential
    for (const row of filled) {
      try {
        const number = await postRow(row);
        savedKeys.add(row.key);
        saved.push(`${ENTRY_ACCOUNTS[row.account as EntryAccount].label}${number ? ` · ${number}` : ""} · ${npr((row.debit ?? 0) || (row.credit ?? 0))}`);
      } catch (error) {
        failed.set(row.key, parseErrorMessage(error));
      }
    }
    setSaving(false);

    setRows((current) => {
      const remaining = current
        .filter((row) => !savedKeys.has(row.key) && !isBlank(row))
        .map((row) => (failed.has(row.key) ? { ...row, error: failed.get(row.key) } : row));
      const last = filled[filled.length - 1];
      return remaining.length ? remaining : [newRow({ dateBs: last?.dateBs, cashBank: last?.cashBank })];
    });
    if (saved.length) {
      setLastSaved(saved);
      toast.success(`${saved.length} entr${saved.length === 1 ? "y" : "ies"} saved and posted to the ledger`);
      await invalidateAccountingQueries();
    }
    if (failed.size) toast.error(`${failed.size} row(s) not saved — the reason is shown under each row`);
  };

  // Ctrl+S / Ctrl+Enter saves, Alt+N adds a row
  const gridRef = useRef<HTMLDivElement>(null);
  const saveRef = useRef(saveAll);
  saveRef.current = saveAll;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!gridRef.current?.contains(document.activeElement)) return;
      if ((event.ctrlKey || event.metaKey) && (event.key === "s" || event.key === "Enter")) {
        event.preventDefault();
        void saveRef.current();
      } else if (event.altKey && (event.key === "n" || event.key === "N")) {
        event.preventDefault();
        addRow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---------------------------------------------------------------- render
  const renderDetails = (row: EntryRow) => {
    switch (row.account) {
      case "STUDENT_FEE":
      case "SECURITY_DEPOSIT":
        return (
          <>
            <SearchSelect
              className="w-full sm:w-80"
              options={studentOptions}
              value={row.studentId}
              placeholder={studentsQuery.isLoading ? "Loading students…" : "Search student — name, roll, adm. no."}
              emptyText="No student found"
              aria-label="Student"
              onChange={(studentId) => {
                const student = students.find((item) => item._id === studentId);
                const level = student?.yearId ? yearById.get(student.yearId)?.level : undefined;
                updateRow(row.key, {
                  studentId,
                  programYear: level ? String(level) : row.programYear,
                  description: row.description || student?.user?.fullName || "",
                });
              }}
            />
            {row.account === "STUDENT_FEE" ? (
              <Select
                className="w-28"
                value={row.programYear}
                onChange={(e) => updateRow(row.key, { programYear: e.target.value })}
                aria-label="Fee year"
              >
                <option value="1">1st Year</option>
                <option value="2">2nd Year</option>
                <option value="3">3rd Year</option>
              </Select>
            ) : null}
            {row.account === "STUDENT_FEE" ? (
              <Select
                className="w-40"
                value={row.feeType || "TUITION"}
                onChange={(e) => updateRow(row.key, { feeType: e.target.value })}
                aria-label="Fee type"
              >
                {FEE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            ) : null}
            <Input
              className="w-36"
              placeholder="Receipt No."
              value={row.receiptNumber}
              onChange={(e) => updateRow(row.key, { receiptNumber: e.target.value })}
              aria-label="Receipt number"
            />
          </>
        );
      case "OTHER_RECEIPT":
        return (
          <>
            <Select
              className="w-52"
              value={row.category}
              onChange={(e) => updateRow(row.key, { category: e.target.value })}
              aria-label="Receipt category"
            >
              <option value="">Receipt category</option>
              {INCOME_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </Select>
            <Input
              className="w-36"
              placeholder="Receipt No."
              value={row.receiptNumber}
              onChange={(e) => updateRow(row.key, { receiptNumber: e.target.value })}
              aria-label="Receipt number"
            />
          </>
        );
      case "DIRECT_EXPENSE":
        return (
          <>
            <Select
              className="w-52"
              value={row.category}
              onChange={(e) => updateRow(row.key, { category: e.target.value })}
              aria-label="Direct expense category"
            >
              <option value="">Category</option>
              {PURCHASE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </Select>
            <Input
              className="w-52"
              placeholder="Vendor / supplier"
              value={row.vendor}
              onChange={(e) => updateRow(row.key, { vendor: e.target.value })}
              aria-label="Vendor"
            />
            <Input
              className="w-40"
              placeholder="Bill / Invoice No."
              value={row.billNumber}
              onChange={(e) => updateRow(row.key, { billNumber: e.target.value })}
              aria-label="Bill number"
            />
          </>
        );
      case "INDIRECT_EXPENSE":
        return (
          <>
            <Select
              className="w-52"
              value={row.category}
              onChange={(e) => updateRow(row.key, { category: e.target.value })}
              aria-label="Indirect expense category"
            >
              <option value="">Category</option>
              {EXPENSE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </Select>
            <Input
              className="w-52"
              placeholder="Paid to (optional)"
              value={row.vendor}
              onChange={(e) => updateRow(row.key, { vendor: e.target.value })}
              aria-label="Paid to"
            />
          </>
        );
      case "TRANSFER":
        return (
          <>
            <span className="text-xs font-medium text-slate-600">
              {(row.credit ?? 0) > 0 ? "Paid into" : "Received from"}
            </span>
            <Select
              className="w-60"
              value={row.otherSide}
              onChange={(e) => updateRow(row.key, { otherSide: e.target.value })}
              aria-label="Other Cash / Bank account"
            >
              <option value="">Select Cash / Bank</option>
              {cashBankOptions
                .filter((option) => option.value !== row.cashBank)
                .map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
            </Select>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <BankCashSectionTitle icon={NotebookPen} title="Bank / Cash Entry" tone="emerald" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={addRow} title="Alt + N">
              <Plus className="mr-1 h-4 w-4" />
              Add row
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void saveAll()} title="Ctrl + S">
              {saving ? "Saving…" : `Save ${rows.filter((row) => !isBlank(row)).length || ""} entr${rows.filter((row) => !isBlank(row)).length === 1 ? "y" : "ies"}`}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-0 pb-4">
        <div ref={gridRef} className="overflow-x-auto border-y border-slate-200">
          <table className="w-full min-w-[1120px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="w-10 px-3 py-2 text-center">#</th>
                <th className="w-40 px-2 py-2">Date</th>
                <th className="w-60 px-2 py-2">Accounts</th>
                <th className="px-2 py-2">Description</th>
                <th className="w-52 px-2 py-2">Cash / Bank</th>
                <th className="w-36 px-2 py-2 text-right text-emerald-700">Debit</th>
                <th className="w-36 px-2 py-2 text-right text-rose-700">Credit</th>
                <th className="w-44 px-2 py-2">Remarks</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const side = row.account ? ENTRY_ACCOUNTS[row.account].side : "both";
                const details = renderDetails(row);
                const voucher = voucherFor(row);
                return (
                  <Fragment key={row.key}>
                  <tr className={cn("border-t border-slate-100 align-top", row.error && "bg-red-50/70")}>
                    <td className="px-3 pt-3 text-center text-xs tabular-nums text-slate-400">{index + 1}</td>
                    <td className="px-2 py-2">
                      <NepaliDateField value={row.dateBs} onChange={(v) => updateRow(row.key, { dateBs: v })} />
                    </td>
                    <td className="px-2 py-2">
                      <SearchSelect
                        options={ACCOUNT_OPTIONS}
                        value={row.account}
                        placeholder="Select account"
                        aria-label="Account"
                        onChange={(value) => chooseAccount(row, value)}
                      />
                    </td>
                    <td className="px-2 py-2" colSpan={1}>
                      <Input
                        value={row.description}
                        onChange={(e) => updateRow(row.key, { description: e.target.value })}
                        placeholder={
                          row.account === "OTHER_RECEIPT"
                            ? "Received from"
                            : row.account === "DIRECT_EXPENSE"
                              ? "Item / particulars"
                              : "Description"
                        }
                        aria-label="Description"
                      />
                      {details ? <div className="mt-2 flex flex-wrap items-center gap-2">{details}</div> : null}
                      {voucher ? (
                        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          <span>
                            <span className="font-semibold text-slate-700">Dr</span> {voucher.dr} {amount(voucher.value)}
                          </span>
                          <span className="text-slate-300">|</span>
                          <span>
                            <span className="font-semibold text-slate-700">Cr</span> {voucher.cr} {amount(voucher.value)}
                          </span>
                        </p>
                      ) : null}
                      {row.error ? <p className="mt-1 text-xs font-medium text-red-700">{row.error}</p> : null}
                    </td>
                    <td className="px-2 py-2">
                      <Select
                        value={row.cashBank}
                        onChange={(e) => updateRow(row.key, { cashBank: e.target.value })}
                        aria-label="Cash or bank"
                      >
                        {cashBankOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-2 py-2">
                      <NumberInput
                        className="text-right tabular-nums"
                        value={row.debit}
                        disabled={side === "credit"}
                        placeholder={side === "credit" ? "" : "0.00"}
                        onValueChange={(value) => updateRow(row.key, { debit: value })}
                        aria-label="Debit"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <NumberInput
                        className="text-right tabular-nums"
                        value={row.credit}
                        disabled={side === "debit"}
                        placeholder={side === "debit" ? "" : "0.00"}
                        onValueChange={(value) => updateRow(row.key, { credit: value })}
                        aria-label="Credit"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        value={row.remarks}
                        onChange={(e) => updateRow(row.key, { remarks: e.target.value })}
                        placeholder={row.account === "TRANSFER" ? "Slip / cheque no." : "Remarks"}
                        aria-label="Remarks"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Remove row"
                        aria-label="Remove row"
                        onClick={() =>
                          setRows((current) =>
                            current.length > 1 ? current.filter((item) => item.key !== row.key) : [newRow({ dateBs: row.dateBs })],
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4 text-slate-400" />
                      </Button>
                    </td>
                  </tr>
                  {isExpense(row.account) ? (
                    <tr className={cn("align-top", row.error ? "bg-red-50/70" : "bg-brand-50/30")}>
                      <td />
                      <td colSpan={8} className="px-2 pb-3">
                        <div className="rounded-xl border border-brand-100 bg-white p-3">
                          <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-700">
                            <FileText className="h-3.5 w-3.5 text-brand-600" />
                            Journal Voucher details (AGF No. 10)
                            <span className="font-normal text-slate-500">· fields marked * are required</span>
                          </p>
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                            {VOUCHER_FIELDS.map((field) => (
                              <label
                                key={field.key}
                                className={cn("block text-xs text-slate-600", field.wide && "sm:col-span-2 lg:col-span-5")}
                              >
                                <span className="mb-0.5 block font-medium">
                                  {field.label}
                                  {field.required ? <span className="text-red-600"> *</span> : null}
                                </span>
                                <Input
                                  value={row.voucher?.[field.key] ?? ""}
                                  placeholder={
                                    field.key === "receiptNo" && row.account === "DIRECT_EXPENSE"
                                      ? row.billNumber || field.placeholder
                                      : field.key === "receivedByName"
                                        ? row.vendor || field.placeholder
                                        : field.key === "narration"
                                          ? row.description || field.placeholder
                                          : field.placeholder
                                  }
                                  onChange={(e) =>
                                    updateRow(row.key, { voucher: { ...row.voucher, [field.key]: e.target.value } })
                                  }
                                  aria-label={field.label}
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td colSpan={5} className="px-3 py-2 text-right text-xs uppercase tracking-wide text-slate-500">
                  Total of this entry
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{npr(totals.debit)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-rose-700">{npr(totals.credit)}</td>
                <td colSpan={2} className="px-3 py-2 text-xs font-normal text-slate-500">
                  Net {totals.debit - totals.credit >= 0 ? "in" : "out"} {npr(Math.abs(totals.debit - totals.credit))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="grid gap-4 px-4 lg:grid-cols-2">
          {/* Effect on each Cash / Bank */}
          <div className="rounded-2xl border border-slate-200 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Balance after saving</p>
            {projections.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Enter amounts to see how Cash and Bank balances change.</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-sm">
                {projections.map((item) => (
                  <li key={item.key} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-slate-800">{item.name}</span>
                    <span className="tabular-nums text-slate-600">
                      {npr(item.now)} → <span className={cn("font-semibold", item.after < 0 ? "text-red-700" : "text-slate-900")}>{npr(item.after)}</span>
                    </span>
                    {item.after < 0 ? (
                      <span className="flex w-full items-center gap-1 text-xs text-red-700">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        This would make {item.name} negative — check the amount or record the deposit first.
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Last saved */}
          <div className="rounded-2xl border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last saved</p>
              <span className="text-xs text-slate-400">Ctrl+S save · Alt+N new row</span>
            </div>
            {lastSaved.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Saved entries appear here and in the Day Book.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {lastSaved.map((line, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <Badge className="bg-emerald-50 text-emerald-700">Posted</Badge>
                    <span className="text-slate-700">{line}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
