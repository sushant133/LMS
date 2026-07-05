import type { Request } from "express";
import type { Types } from "mongoose";
import { BankAccount } from "../models/BankAccount.js";
import { CashBookEntry } from "../models/CashBookEntry.js";
import { computeBalanceAfterEntry } from "./accountingCalculations.js";
import { tenantObjectId } from "./tenant.js";

export const getLatestCashBalance = async (schoolId: Types.ObjectId): Promise<number> => {
  const lastEntry = await CashBookEntry.findOne({ schoolId }).sort({ dateBs: -1, createdAt: -1 }).lean();
  return lastEntry?.balanceAfterNpr ?? 0;
};

export const adjustPrimaryBankBalance = async (
  schoolId: Types.ObjectId,
  amountNpr: number,
  direction: "credit" | "debit",
  paymentMethod: string,
  bankAccountId?: string
): Promise<void> => {
  const bankMethods = ["BANK_TRANSFER", "CHEQUE", "FONEPAY"];
  if (!bankMethods.includes(paymentMethod) || amountNpr <= 0) return;

  const account = bankAccountId
    ? await BankAccount.findOne({ _id: bankAccountId, schoolId, isActive: true })
    : await BankAccount.findOne({ schoolId, isActive: true }).sort({ createdAt: 1 });

  if (!account) return;

  account.currentBalanceNpr =
    direction === "credit"
      ? account.currentBalanceNpr + amountNpr
      : Math.max(0, account.currentBalanceNpr - amountNpr);
  await account.save();
};

export const recordCashEntry = async (
  req: Request,
  params: {
    dateBs: string;
    entryType: "DEBIT" | "CREDIT";
    category: string;
    description: string;
    amountNpr: number;
    paymentMethod: string;
    referenceType?: string;
    referenceId?: string;
    bankAccountId?: string;
  }
) => {
  const schoolId = tenantObjectId(req);
  const previousBalance = await getLatestCashBalance(schoolId);
  const balanceAfterNpr = computeBalanceAfterEntry(previousBalance, params.entryType, params.amountNpr);

  await CashBookEntry.create({
    schoolId,
    dateBs: params.dateBs,
    entryType: params.entryType,
    category: params.category,
    description: params.description,
    amountNpr: params.amountNpr,
    paymentMethod: params.paymentMethod,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    balanceAfterNpr,
    createdBy: req.user!.userId
  });

  await adjustPrimaryBankBalance(
    schoolId,
    params.amountNpr,
    params.entryType === "CREDIT" ? "credit" : "debit",
    params.paymentMethod,
    params.bankAccountId
  );
};

export const reverseCashEntry = async (
  req: Request,
  referenceType: string,
  referenceId: string,
  dateBs: string
): Promise<void> => {
  const schoolId = tenantObjectId(req);
  const original = await CashBookEntry.findOne({ schoolId, referenceType, referenceId }).sort({ createdAt: -1 });
  if (!original) return;

  const reversalType = original.entryType === "CREDIT" ? "DEBIT" : "CREDIT";
  await recordCashEntry(req, {
    dateBs,
    entryType: reversalType,
    category: original.category,
    description: `Reversal: ${original.description}`,
    amountNpr: original.amountNpr,
    paymentMethod: original.paymentMethod,
    referenceType,
    referenceId
  });
};