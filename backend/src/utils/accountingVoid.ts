import type { ClientSession, Types } from "mongoose";
import type { Request } from "express";
import { FeeCollection } from "../models/FeeCollection.js";
import { Student } from "../models/Student.js";
import { recalculateStudentFeesDue } from "./accountingCalculations.js";
import { reverseCashEntry } from "./accountingCashBook.js";
import { reverseJournalEntry } from "./journalPosting.js";
import { getTodayBs } from "./nepaliDate.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VoidableDocument = any;

export const softVoidFinancialRecord = async (
  record: VoidableDocument,
  userId: Types.ObjectId | string,
  reason: string,
  session?: ClientSession | null
): Promise<Record<string, unknown>> => {
  const before = record.toObject();
  record.isDeleted = true;
  record.deletedAt = new Date();
  record.deletedBy = userId as Types.ObjectId;
  record.voidReason = reason;
  await record.save(session ? { session } : undefined);
  return before;
};

export const voidFeeCollection = async (
  req: Request,
  collection: InstanceType<typeof FeeCollection>,
  schoolId: Types.ObjectId,
  userId: Types.ObjectId,
  reason: string,
  session?: ClientSession | null
): Promise<void> => {
  await softVoidFinancialRecord(collection, userId, reason, session);

  await reverseJournalEntry(schoolId, userId, "FeeCollection", collection._id);
  await reverseCashEntry(req, "FeeCollection", collection._id.toString(), getTodayBs());

  const studentQuery = Student.findById(collection.studentId);
  if (session) studentQuery.session(session);
  const student = await studentQuery;
  if (student) {
    await recalculateStudentFeesDue(student._id, schoolId, session);
  }
};

export const voidWithJournalReversal = async (
  req: Request,
  record: VoidableDocument,
  schoolId: Types.ObjectId,
  userId: Types.ObjectId,
  referenceType: "AccountingExpense" | "AccountingIncome" | "AccountingPurchase" | "SalaryPayment" | "FeeRefund",
  reason: string,
  dateBs: string,
  session?: ClientSession | null
): Promise<Record<string, unknown>> => {
  const before = await softVoidFinancialRecord(record, userId, reason, session);
  await reverseJournalEntry(schoolId, userId, referenceType, record._id);
  await reverseCashEntry(req, referenceType, record._id.toString(), dateBs);
  return before;
};