import type { Request, Response } from "express";
import { Types } from "mongoose";
import {
  SYSTEM_ACCOUNT_CODES,
  bankCashTransferSchema,
  type BankCashAccountBalance,
  type BankCashBookResponse,
  type BankCashBookRow,
  type BankCashSummary,
  type BankCashTransferRecord,
  type UnlinkedBankLine,
  type UnlinkedBankResponse
} from "@phit-erp/shared";
import { BankAccount } from "../models/BankAccount.js";
import { BankReconciliation } from "../models/BankReconciliation.js";
import { JournalEntry } from "../models/JournalEntry.js";
import { Student } from "../models/Student.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { recordAudit } from "../utils/audit.js";
import { assertFiscalPeriodOpen } from "../utils/fiscalYear.js";
import { postJournalEntry, reverseJournalEntryById } from "../utils/journalPosting.js";
import { ensureValidBsDate, getTodayBs } from "../utils/nepaliDate.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId } from "../utils/tenant.js";

/**
 * Bank / Cash: balances of Cash in Hand and each bank account, contra transfers
 * between them, and Cash Book / Bank Book statements. Everything is read from
 * the general ledger so it always agrees with the Ledger and Trial Balance.
 *
 * A bank line belongs to the bank account on the line itself (bank-to-bank
 * transfers) or, failing that, to the journal entry's bankAccountId.
 */

const CASH = SYSTEM_ACCOUNT_CODES.CASH;
const BANK = SYSTEM_ACCOUNT_CODES.BANK;

const round2 = (value: number): number => Math.round(value * 100) / 100;

const postedMatch = (schoolId: Types.ObjectId) => ({ schoolId, isDeleted: false, isPosted: true });

const isBsDay = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

const bankLabel = (bank: { bankName: string; accountNumber: string }) =>
  `${bank.bankName} (${bank.accountNumber})`;

/** The bank account a journal line moves, if any. */
const lineBankId = (
  line: { bankAccountId?: Types.ObjectId | null },
  entry: { bankAccountId?: Types.ObjectId | null }
): string | null => (line.bankAccountId ?? entry.bankAccountId)?.toString() ?? null;

export const getBankCashSummary = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);

  const todayBs = getTodayBs();
  const [ledgerTotals, bankMovements, banks, today, reconciliations] = await Promise.all([
    JournalEntry.aggregate<{ _id: string; net: number }>([
      { $match: { ...postedMatch(schoolId), "lines.accountCode": { $in: [CASH, BANK] } } },
      { $unwind: "$lines" },
      { $match: { "lines.accountCode": { $in: [CASH, BANK] } } },
      {
        $group: {
          _id: "$lines.accountCode",
          net: { $sum: { $subtract: ["$lines.debitNpr", "$lines.creditNpr"] } }
        }
      }
    ]),
    JournalEntry.aggregate<{ _id: Types.ObjectId | null; debit: number; credit: number }>([
      { $match: { ...postedMatch(schoolId), "lines.accountCode": BANK } },
      { $unwind: "$lines" },
      { $match: { "lines.accountCode": BANK } },
      {
        $group: {
          _id: { $ifNull: ["$lines.bankAccountId", "$bankAccountId"] },
          debit: { $sum: "$lines.debitNpr" },
          credit: { $sum: "$lines.creditNpr" }
        }
      }
    ]),
    BankAccount.find({ schoolId }).sort({ isActive: -1, createdAt: 1 }).lean(),
    JournalEntry.aggregate<{ debit: number; credit: number }>([
      { $match: { ...postedMatch(schoolId), dateBs: todayBs, "lines.accountCode": { $in: [CASH, BANK] } } },
      { $unwind: "$lines" },
      { $match: { "lines.accountCode": { $in: [CASH, BANK] } } },
      { $group: { _id: null, debit: { $sum: "$lines.debitNpr" }, credit: { $sum: "$lines.creditNpr" } } }
    ]),
    BankReconciliation.aggregate<{ _id: Types.ObjectId; statementDateBs: string; status: string; differenceNpr: number }>([
      { $match: { schoolId, isDeleted: false, bankAccountId: { $ne: null } } },
      { $sort: { statementDateBs: -1, updatedAt: -1 } },
      {
        $group: {
          _id: "$bankAccountId",
          statementDateBs: { $first: "$statementDateBs" },
          status: { $first: "$status" },
          differenceNpr: { $first: "$differenceNpr" }
        }
      }
    ])
  ]);
  const reconciliationByBank = new Map(reconciliations.map((row) => [row._id.toString(), row]));

  const netByCode = new Map(ledgerTotals.map((row) => [row._id, row.net]));
  const movementByBank = new Map(
    bankMovements.filter((row) => row._id).map((row) => [row._id!.toString(), row])
  );

  let taggedNet = 0;
  const bankRows: BankCashAccountBalance[] = banks.map((bank) => {
    const movement = movementByBank.get(bank._id.toString());
    const receiptsNpr = round2(movement?.debit ?? 0);
    const paymentsNpr = round2(movement?.credit ?? 0);
    taggedNet += receiptsNpr - paymentsNpr;
    const openingBalanceNpr = round2(bank.openingBalanceNpr ?? 0);
    const reconciliation = reconciliationByBank.get(bank._id.toString());
    return {
      lastReconciledBs: reconciliation?.statementDateBs,
      lastReconciliationStatus: reconciliation?.status as "DRAFT" | "COMPLETED" | undefined,
      bankAccountId: bank._id.toString(),
      bankName: bank.bankName,
      accountName: bank.accountName,
      accountNumber: bank.accountNumber,
      branch: bank.branch ?? undefined,
      isActive: bank.isActive !== false,
      openingBalanceNpr,
      receiptsNpr,
      paymentsNpr,
      balanceNpr: round2(openingBalanceNpr + receiptsNpr - paymentsNpr)
    };
  });

  const bankLedgerNpr = round2(netByCode.get(BANK) ?? 0);
  const summary: BankCashSummary = {
    cashInHandNpr: round2(netByCode.get(CASH) ?? 0),
    bankLedgerNpr,
    bankBalanceNpr: round2(bankLedgerNpr + bankRows.reduce((s, b) => s + b.openingBalanceNpr, 0)),
    banks: bankRows,
    unlinkedBankNpr: round2(bankLedgerNpr - taggedNet),
    todayBs,
    // Gross movement today (cash ↔ bank transfers count on both sides)
    todayReceiptsNpr: round2(today[0]?.debit ?? 0),
    todayPaymentsNpr: round2(today[0]?.credit ?? 0)
  };
  return sendSuccess(res, "Bank and cash balances fetched", summary);
});

/** Cash Book (book=cash), Bank Book for all banks (book=bank) or one bank account. */
export const getBankCashBook = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const book = req.query.book === "bank" ? "bank" : "cash";
  const bankAccountId =
    typeof req.query.bankAccountId === "string" && Types.ObjectId.isValid(req.query.bankAccountId)
      ? req.query.bankAccountId
      : undefined;
  const fromDateBs = isBsDay(req.query.fromDateBs) ? req.query.fromDateBs : undefined;
  const toDateBs = isBsDay(req.query.toDateBs) ? req.query.toDateBs : undefined;

  const accountCode = book === "bank" ? BANK : CASH;
  let title = book === "bank" ? "Bank Book — all bank accounts" : "Cash Book";
  let openingNpr = 0;

  const bank =
    book === "bank" && bankAccountId
      ? await BankAccount.findOne({ _id: bankAccountId, schoolId }).lean()
      : null;
  if (book === "bank" && bankAccountId && !bank) {
    throw new ApiError(404, "Bank account not found");
  }
  if (bank) {
    title = `Bank Book — ${bankLabel(bank)}`;
    openingNpr = bank.openingBalanceNpr ?? 0;
  } else if (book === "bank") {
    // All banks: start from the total of every bank account's opening balance
    const [row] = await BankAccount.aggregate<{ total: number }>([
      { $match: { schoolId } },
      { $group: { _id: null, total: { $sum: { $ifNull: ["$openingBalanceNpr", 0] } } } }
    ]);
    openingNpr = row?.total ?? 0;
  }

  const query: Record<string, unknown> = { ...postedMatch(schoolId), "lines.accountCode": accountCode };
  if (bank) {
    query.$or = [{ bankAccountId: bank._id }, { "lines.bankAccountId": bank._id }];
  }
  if (toDateBs) query.dateBs = { $lte: toDateBs };

  const entries = await JournalEntry.find(query).sort({ dateBs: 1, createdAt: 1 }).lean();

  const movementRows: BankCashBookRow[] = [];
  let totalReceiptsNpr = 0;
  let totalPaymentsNpr = 0;

  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.accountCode !== accountCode) continue;
      if (bank && lineBankId(line, entry) !== bank._id.toString()) continue;
      const receipt = line.debitNpr ?? 0;
      const payment = line.creditNpr ?? 0;
      // Movement before the range only builds the opening balance
      if (fromDateBs && entry.dateBs < fromDateBs) {
        openingNpr += receipt - payment;
        continue;
      }
      totalReceiptsNpr += receipt;
      totalPaymentsNpr += payment;
      movementRows.push({
        dateBs: entry.dateBs,
        voucherNumber: entry.voucherNumber,
        narration: line.description?.trim() || entry.narration,
        receiptNpr: round2(receipt),
        paymentNpr: round2(payment),
        balanceNpr: 0
      });
    }
  }

  openingNpr = round2(openingNpr);
  let running = openingNpr;
  for (const row of movementRows) {
    running = round2(running + row.receiptNpr - row.paymentNpr);
    row.balanceNpr = running;
  }

  const response: BankCashBookResponse = {
    title,
    openingNpr,
    closingNpr: running,
    totalReceiptsNpr: round2(totalReceiptsNpr),
    totalPaymentsNpr: round2(totalPaymentsNpr),
    rows: [
      {
        dateBs: fromDateBs ?? "",
        voucherNumber: "",
        narration: "Opening Balance",
        receiptNpr: 0,
        paymentNpr: 0,
        balanceNpr: openingNpr,
        isOpening: true
      },
      ...movementRows
    ]
  };
  return sendSuccess(res, "Book fetched", response);
});

/**
 * Bank (1101) lines with no bank account (neither on the line nor on the voucher). They sit
 * in the Bank control account but in no bank's balance, book or reconciliation. Lists the
 * active ones (not reversed / not a reversal) so they can be reversed and posted again
 * with the right bank account.
 */
export const listUnlinkedBankLines = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const entries = await JournalEntry.find({ ...postedMatch(schoolId), "lines.accountCode": BANK })
    .select("voucherNumber dateBs narration referenceType bankAccountId lines isReversal isReversed")
    .sort({ dateBs: -1, createdAt: -1 })
    .lean();
  let totalNpr = 0;
  const lines: UnlinkedBankLine[] = [];
  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.accountCode !== BANK || lineBankId(line, entry)) continue;
      const amountNpr = round2((line.debitNpr ?? 0) - (line.creditNpr ?? 0));
      totalNpr += amountNpr;
      if (entry.isReversal || entry.isReversed || Math.abs(amountNpr) < 0.01) continue;
      lines.push({
        journalEntryId: entry._id.toString(),
        voucherNumber: entry.voucherNumber,
        dateBs: entry.dateBs,
        narration: line.description?.trim() || entry.narration,
        referenceType: entry.referenceType ?? undefined,
        amountNpr
      });
    }
  }
  const response: UnlinkedBankResponse = { totalNpr: round2(totalNpr), lines };
  return sendSuccess(res, "Unlinked bank lines fetched", response);
});

/** Contra vouchers: transfers between Cash in Hand and bank accounts. */
export const listBankCashTransfers = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const [entries, banks] = await Promise.all([
    JournalEntry.find({ ...postedMatch(schoolId), voucherType: "CONTRA", isReversal: false })
      .sort({ dateBs: -1, createdAt: -1 })
      .limit(500)
      .lean(),
    BankAccount.find({ schoolId }).select("bankName accountNumber").lean()
  ]);
  const bankById = new Map(banks.map((bank) => [bank._id.toString(), bankLabel(bank)]));

  const labelFor = (line: (typeof entries)[number]["lines"][number], entry: (typeof entries)[number]) => {
    if (line.accountCode === CASH) return "Cash in Hand";
    if (line.accountCode === BANK) {
      const id = lineBankId(line, entry);
      return (id && bankById.get(id)) || "Bank";
    }
    return line.accountName;
  };

  const transfers: BankCashTransferRecord[] = entries.map((entry) => {
    const debitLine = entry.lines.find((line) => (line.debitNpr ?? 0) > 0);
    const creditLine = entry.lines.find((line) => (line.creditNpr ?? 0) > 0);
    const codes = `${creditLine?.accountCode ?? ""}>${debitLine?.accountCode ?? ""}`;
    const transferType: BankCashTransferRecord["transferType"] =
      codes === `${CASH}>${BANK}`
        ? "CASH_TO_BANK"
        : codes === `${BANK}>${CASH}`
          ? "BANK_TO_CASH"
          : codes === `${BANK}>${BANK}`
            ? "BANK_TO_BANK"
            : "OTHER";
    return {
      _id: entry._id.toString(),
      voucherNumber: entry.voucherNumber,
      dateBs: entry.dateBs,
      transferType,
      fromLabel: creditLine ? labelFor(creditLine, entry) : "",
      toLabel: debitLine ? labelFor(debitLine, entry) : "",
      amountNpr: round2(entry.totalDebitNpr),
      narration: entry.narration,
      isReversed: Boolean(entry.isReversed),
      createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : undefined
    };
  });

  return sendSuccess(res, "Transfers fetched", transfers);
});

export const createBankCashTransfer = asyncHandler(async (req: Request, res: Response) => {
  const payload = bankCashTransferSchema.parse(req.body);
  ensureValidBsDate(payload.dateBs);
  const schoolId = tenantObjectId(req);
  await assertFiscalPeriodOpen(schoolId, payload.dateBs);

  const loadBank = async (id?: string) => {
    if (!id) return null;
    const bank = await BankAccount.findOne({ _id: id, schoolId }).lean();
    if (!bank) throw new ApiError(404, "Bank account not found");
    if (bank.isActive === false) throw new ApiError(400, `${bankLabel(bank)} is deactivated`);
    return bank;
  };
  const fromBank = payload.transferType === "CASH_TO_BANK" ? null : await loadBank(payload.fromBankAccountId);
  const toBank = payload.transferType === "BANK_TO_CASH" ? null : await loadBank(payload.toBankAccountId);

  const amount = round2(payload.amountNpr);
  const ref = payload.referenceNumber?.trim();
  const fromLabel = fromBank ? bankLabel(fromBank) : "Cash in Hand";
  const toLabel = toBank ? bankLabel(toBank) : "Cash in Hand";
  const defaultNarration =
    payload.transferType === "CASH_TO_BANK"
      ? `Cash deposited into ${toLabel}`
      : payload.transferType === "BANK_TO_CASH"
        ? `Cash withdrawn from ${fromLabel}`
        : `Transfer from ${fromLabel} to ${toLabel}`;
  const narration = [payload.narration?.trim() || defaultNarration, ref ? `Ref: ${ref}` : ""]
    .filter(Boolean)
    .join(" · ");

  const entry = await postJournalEntry({
    schoolId,
    userId: req.user!.userId as unknown as Types.ObjectId,
    dateBs: payload.dateBs,
    narration,
    voucherType: "CONTRA",
    referenceType: "Manual",
    // Deposit / withdrawal: the one bank involved; bank-to-bank is tagged per line
    bankAccountId: payload.transferType === "BANK_TO_BANK" ? undefined : (toBank ?? fromBank)?._id,
    lines: [
      {
        accountCode: toBank ? BANK : CASH,
        accountName: "",
        debitNpr: amount,
        creditNpr: 0,
        description: `Received from ${fromLabel}`,
        bankAccountId: toBank?._id
      },
      {
        accountCode: fromBank ? BANK : CASH,
        accountName: "",
        debitNpr: 0,
        creditNpr: amount,
        description: `Paid to ${toLabel}`,
        bankAccountId: fromBank?._id
      }
    ]
  });

  await recordAudit(req, {
    action: "accounting.bankcash.transfer",
    entity: "JournalEntry",
    entityId: entry._id.toString(),
    after: entry
  });
  return sendSuccess(res, "Transfer recorded", entry, 201);
});

/** Void a transfer: posts the reversing voucher, both stay in the ledger. */
export const voidBankCashTransfer = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const entry = await JournalEntry.findOne({ _id: req.params.id, ...postedMatch(schoolId) });
  if (!entry || entry.voucherType !== "CONTRA") throw new ApiError(404, "Transfer not found");
  if (entry.isReversal) throw new ApiError(400, "This is already a reversing voucher");
  if (entry.isReversed) throw new ApiError(400, "This transfer is already voided");
  if (entry.referenceType && entry.referenceType !== "Manual") {
    throw new ApiError(400, `This voucher belongs to ${entry.referenceType}; void it from that section.`);
  }
  await assertFiscalPeriodOpen(schoolId, entry.dateBs);

  const before = entry.toObject();
  await reverseJournalEntryById(schoolId, req.user!.userId as unknown as Types.ObjectId, entry._id);
  await recordAudit(req, {
    action: "accounting.bankcash.transfer.void",
    entity: "JournalEntry",
    entityId: entry._id.toString(),
    before
  });
  return sendSuccess(res, "Transfer voided");
});


// ---------------------------------------------------------------------------
// Day Book / register
// ---------------------------------------------------------------------------

/**
 * Which section a voucher came from. Fee receipts that only credit the security
 * deposit liability are Security Deposits; contra vouchers entered here are
 * Cash ↔ Bank transfers; any other manual voucher is a Journal Entry.
 */
export const BANK_CASH_SECTION_KEYS = [
  "STUDENT_FEE",
  "SECURITY_DEPOSIT",
  "OTHER_RECEIPT",
  "DIRECT_EXPENSE",
  "INDIRECT_EXPENSE",
  "TRANSFER",
  "SALARY",
  "REFUND",
  "JOURNAL",
  "CASH_BOOK"
] as const;
type BankCashSectionKey = (typeof BANK_CASH_SECTION_KEYS)[number];

const SECTION_LABELS: Record<BankCashSectionKey, string> = {
  STUDENT_FEE: "Student Fee Records",
  SECURITY_DEPOSIT: "Security Deposits",
  OTHER_RECEIPT: "Other Receipts",
  DIRECT_EXPENSE: "Direct Expense",
  INDIRECT_EXPENSE: "Indirect Expenses",
  TRANSFER: "Cash ↔ Bank Transfer",
  SALARY: "Salary Sheet / Payroll",
  REFUND: "Refund Records",
  JOURNAL: "Journal Entries",
  CASH_BOOK: "Cash Book"
};

/** Aggregation expression computing the section key of a journal entry. */
const sectionKeyExpression = {
  $switch: {
    branches: [
      {
        case: { $eq: ["$referenceType", "FeeCollection"] },
        then: {
          $cond: [
            {
              $let: {
                vars: {
                  credited: {
                    $map: {
                      input: { $filter: { input: "$lines", as: "l", cond: { $gt: ["$$l.creditNpr", 0] } } },
                      as: "l",
                      in: "$$l.accountCode"
                    }
                  }
                },
                in: {
                  $and: [
                    { $gt: [{ $size: "$$credited" }, 0] },
                    { $setIsSubset: ["$$credited", [SYSTEM_ACCOUNT_CODES.SECURITY_DEPOSIT_LIABILITY]] }
                  ]
                }
              }
            },
            "SECURITY_DEPOSIT",
            "STUDENT_FEE"
          ]
        }
      },
      { case: { $eq: ["$referenceType", "FeeRefund"] }, then: "REFUND" },
      { case: { $eq: ["$referenceType", "AccountingPurchase"] }, then: "DIRECT_EXPENSE" },
      { case: { $eq: ["$referenceType", "AccountingExpense"] }, then: "INDIRECT_EXPENSE" },
      { case: { $eq: ["$referenceType", "AccountingIncome"] }, then: "OTHER_RECEIPT" },
      { case: { $eq: ["$referenceType", "SalaryPayment"] }, then: "SALARY" },
      { case: { $eq: ["$referenceType", "CashBookEntry"] }, then: "CASH_BOOK" },
      { case: { $eq: ["$voucherType", "CONTRA"] }, then: "TRANSFER" }
    ],
    default: "JOURNAL"
  }
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Journal-entry filter for a free-text search (voucher, narration, lines, student, amount). */
const buildSearchFilter = async (
  schoolId: Types.ObjectId,
  q: string
): Promise<Record<string, unknown> | null> => {
  const text = q.trim().slice(0, 80);
  if (!text) return null;
  const regex = { $regex: escapeRegex(text), $options: "i" };
  const or: Record<string, unknown>[] = [
    { voucherNumber: regex },
    { narration: regex },
    { "lines.description": regex },
    { "lines.accountName": regex }
  ];

  // Amount search: "20000", "20,000" or "20000.50"
  const amount = Number(text.replace(/,/g, ""));
  if (Number.isFinite(amount) && amount > 0 && /^[\d,]+(\.\d+)?$/.test(text)) {
    or.push({ "lines.debitNpr": amount }, { "lines.creditNpr": amount });
  }

  // Student name / roll / admission number → that student's receipts
  const users = await User.find({ schoolId, role: "STUDENT", fullName: regex }).select("_id").limit(200).lean();
  const studentFilter: Record<string, unknown>[] = [{ admissionNumber: regex }];
  if (users.length) studentFilter.push({ user: { $in: users.map((user) => user._id) } });
  if (/^\d+$/.test(text)) studentFilter.push({ rollNumber: Number(text) });
  const students = await Student.find({ schoolId, $or: studentFilter }).select("_id").limit(500).lean();
  if (students.length) or.push({ studentId: { $in: students.map((student) => student._id) } });

  return { $or: or };
};

interface RegisterLine {
  accountCode: string;
  accountName: string;
  debitNpr: number;
  creditNpr: number;
  description?: string;
  bankAccountId?: Types.ObjectId | null;
}

interface RegisterAggregateRow {
  _id: Types.ObjectId;
  dateBs: string;
  voucherNumber: string;
  voucherType?: string;
  narration: string;
  referenceType?: string;
  bankAccountId?: Types.ObjectId | null;
  studentId?: Types.ObjectId | null;
  isReversal?: boolean;
  isReversed?: boolean;
  createdAt?: Date;
  sectionKey: BankCashSectionKey;
  allLines: RegisterLine[];
  line: RegisterLine;
  lineIndex: number;
}

/**
 * Day Book: every movement of Cash in Hand or a bank account, whichever section
 * it was entered from — searchable, filterable by section and by Cash / Bank,
 * newest first, with the full voucher for drill-down.
 */
export const getBankCashRegister = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const fromDateBs = isBsDay(req.query.fromDateBs) ? req.query.fromDateBs : undefined;
  const toDateBs = isBsDay(req.query.toDateBs) ? req.query.toDateBs : undefined;
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const section =
    typeof req.query.section === "string" && (BANK_CASH_SECTION_KEYS as readonly string[]).includes(req.query.section)
      ? (req.query.section as BankCashSectionKey)
      : undefined;
  const cashBank = typeof req.query.cashBank === "string" ? req.query.cashBank : "";
  const q = typeof req.query.q === "string" ? req.query.q : "";

  const entryMatch: Record<string, unknown> = {
    ...postedMatch(schoolId),
    "lines.accountCode": { $in: [CASH, BANK] }
  };
  if (fromDateBs || toDateBs) {
    entryMatch.dateBs = { ...(fromDateBs ? { $gte: fromDateBs } : {}), ...(toDateBs ? { $lte: toDateBs } : {}) };
  }
  const search = await buildSearchFilter(schoolId, q);
  if (search) Object.assign(entryMatch, search);

  // Which cash / bank lines to show
  const lineMatch: Record<string, unknown> =
    cashBank === "cash"
      ? { "line.accountCode": CASH }
      : cashBank === "bank"
        ? { "line.accountCode": BANK }
        : Types.ObjectId.isValid(cashBank)
          ? {
              "line.accountCode": BANK,
              $expr: {
                $eq: [{ $ifNull: ["$line.bankAccountId", "$bankAccountId"] }, new Types.ObjectId(cashBank)]
              }
            }
          : { "line.accountCode": { $in: [CASH, BANK] } };

  const [result] = await JournalEntry.aggregate<{
    rows: RegisterAggregateRow[];
    meta: Array<{ total: number; debit: number; credit: number }>;
  }>([
    { $match: entryMatch },
    { $addFields: { sectionKey: sectionKeyExpression, allLines: "$lines" } },
    ...(section ? [{ $match: { sectionKey: section } }] : []),
    { $unwind: { path: "$lines", includeArrayIndex: "lineIndex" } },
    { $addFields: { line: "$lines" } },
    { $match: lineMatch },
    { $sort: { dateBs: -1, createdAt: -1, lineIndex: 1 } },
    {
      $facet: {
        rows: [
          { $skip: (page - 1) * limit },
          { $limit: limit },
          {
            $project: {
              dateBs: 1,
              voucherNumber: 1,
              voucherType: 1,
              narration: 1,
              referenceType: 1,
              bankAccountId: 1,
              studentId: 1,
              isReversal: 1,
              isReversed: 1,
              createdAt: 1,
              sectionKey: 1,
              allLines: 1,
              line: 1,
              lineIndex: 1
            }
          }
        ],
        meta: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              debit: { $sum: "$line.debitNpr" },
              credit: { $sum: "$line.creditNpr" }
            }
          }
        ]
      }
    }
  ]);

  const banks = await BankAccount.find({ schoolId }).select("bankName accountNumber").lean();
  const bankById = new Map(banks.map((bank) => [bank._id.toString(), bankLabel(bank)]));
  const lineLabel = (line: RegisterLine, entry: RegisterAggregateRow) => {
    if (line.accountCode === CASH) return "Cash in Hand";
    if (line.accountCode === BANK) {
      const id = lineBankId(line, entry);
      return (id && bankById.get(id)) || "Bank";
    }
    return line.accountName || line.accountCode;
  };

  const rows = (result?.rows ?? []).map((entry) => {
    const isTransfer = entry.sectionKey === "TRANSFER" && (!entry.referenceType || entry.referenceType === "Manual");
    const voucherDebit = round2(entry.allLines.reduce((sum, line) => sum + (line.debitNpr ?? 0), 0));
    const voucherCredit = round2(entry.allLines.reduce((sum, line) => sum + (line.creditNpr ?? 0), 0));
    return {
      id: `${entry._id.toString()}-${entry.lineIndex}`,
      journalEntryId: entry._id.toString(),
      dateBs: entry.dateBs,
      voucherNumber: entry.voucherNumber,
      voucherType: entry.voucherType ?? "JOURNAL",
      sectionKey: entry.sectionKey,
      account: SECTION_LABELS[entry.sectionKey],
      description: entry.narration,
      cashBank: lineLabel(entry.line, entry),
      debitNpr: round2(entry.line.debitNpr ?? 0),
      creditNpr: round2(entry.line.creditNpr ?? 0),
      remarks: entry.line.description?.trim() ?? "",
      isReversal: Boolean(entry.isReversal),
      isReversed: Boolean(entry.isReversed),
      canVoid: isTransfer && !entry.isReversal && !entry.isReversed,
      voucherLines: entry.allLines.map((line) => ({
        account: lineLabel(line, entry),
        accountCode: line.accountCode,
        description: line.description ?? "",
        debitNpr: round2(line.debitNpr ?? 0),
        creditNpr: round2(line.creditNpr ?? 0)
      })),
      voucherDebitNpr: voucherDebit,
      voucherCreditNpr: voucherCredit,
      isBalanced: Math.abs(voucherDebit - voucherCredit) < 0.01
    };
  });

  const meta = result?.meta?.[0];
  return sendSuccess(res, "Day book fetched", {
    rows,
    total: meta?.total ?? 0,
    page,
    limit,
    hasMore: page * limit < (meta?.total ?? 0),
    totalDebitNpr: round2(meta?.debit ?? 0),
    totalCreditNpr: round2(meta?.credit ?? 0)
  });
});

/**
 * Double-entry check for a period: every posted voucher's debits must equal its
 * credits, and so must the totals of the whole period.
 */
export const getBankCashIntegrity = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const fromDateBs = isBsDay(req.query.fromDateBs) ? req.query.fromDateBs : undefined;
  const toDateBs = isBsDay(req.query.toDateBs) ? req.query.toDateBs : undefined;
  const match: Record<string, unknown> = { ...postedMatch(schoolId) };
  if (fromDateBs || toDateBs) {
    match.dateBs = { ...(fromDateBs ? { $gte: fromDateBs } : {}), ...(toDateBs ? { $lte: toDateBs } : {}) };
  }

  const vouchers = await JournalEntry.aggregate<{
    _id: Types.ObjectId;
    voucherNumber: string;
    dateBs: string;
    debit: number;
    credit: number;
  }>([
    { $match: match },
    {
      $project: {
        voucherNumber: 1,
        dateBs: 1,
        debit: { $sum: "$lines.debitNpr" },
        credit: { $sum: "$lines.creditNpr" }
      }
    }
  ]);

  let totalDebit = 0;
  let totalCredit = 0;
  const unbalanced: Array<{ journalEntryId: string; voucherNumber: string; dateBs: string; differenceNpr: number }> = [];
  for (const voucher of vouchers) {
    totalDebit += voucher.debit ?? 0;
    totalCredit += voucher.credit ?? 0;
    const difference = round2((voucher.debit ?? 0) - (voucher.credit ?? 0));
    if (Math.abs(difference) >= 0.01) {
      unbalanced.push({
        journalEntryId: voucher._id.toString(),
        voucherNumber: voucher.voucherNumber,
        dateBs: voucher.dateBs,
        differenceNpr: difference
      });
    }
  }

  totalDebit = round2(totalDebit);
  totalCredit = round2(totalCredit);
  return sendSuccess(res, "Books checked", {
    voucherCount: vouchers.length,
    totalDebitNpr: totalDebit,
    totalCreditNpr: totalCredit,
    differenceNpr: round2(totalDebit - totalCredit),
    isBalanced: unbalanced.length === 0 && Math.abs(totalDebit - totalCredit) < 0.01,
    unbalanced: unbalanced.slice(0, 50),
    unbalancedCount: unbalanced.length
  });
});
