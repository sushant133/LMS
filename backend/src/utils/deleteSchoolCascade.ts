import type { ClientSession } from "mongoose";
import mongoose from "mongoose";
import path from "path";
import fs from "fs-extra";
import { Assignment, AssignmentSubmission } from "../models/Assignment.js";
import { Batch } from "../models/Batch.js";
import { AssignmentComment } from "../models/AssignmentComment.js";
import { Attendance } from "../models/Attendance.js";
import { AuditLog } from "../models/AuditLog.js";
import { Exam } from "../models/Exam.js";
import { ExamRoutine } from "../models/ExamRoutine.js";
import { Accountant } from "../models/Accountant.js";
import { AccountingExpense } from "../models/AccountingExpense.js";
import { AccountingIncome } from "../models/AccountingIncome.js";
import { AccountingPurchase } from "../models/AccountingPurchase.js";
import { AccountingSettings } from "../models/AccountingSettings.js";
import { BankAccount } from "../models/BankAccount.js";
import { CashBookEntry } from "../models/CashBookEntry.js";
import { FeeCollection } from "../models/FeeCollection.js";
import { FeeStructure } from "../models/FeeStructure.js";
import { SalaryPayment } from "../models/SalaryPayment.js";
import { LibraryBook, LibraryIssue } from "../models/LibraryBook.js";
import { Laboratory, LaboratoryCategory, LaboratoryEquipment, LaboratoryIssue } from "../models/Laboratory.js";
import { LeaveRequest, Payroll } from "../models/LeaveRequest.js";
import { Notice } from "../models/Notice.js";
import { Notification } from "../models/Notification.js";
import { ParentChildLink } from "../models/ParentChildLink.js";
import { Result } from "../models/Result.js";
import { School } from "../models/School.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { Setting } from "../models/Setting.js";
import { Student } from "../models/Student.js";
import { Subject } from "../models/Subject.js";
import { Teacher } from "../models/Teacher.js";
import { TimetableSlot } from "../models/TimetableSlot.js";
import { TransportAssignment, TransportRoute } from "../models/TransportRoute.js";
import { User } from "../models/User.js";
import { Year } from "../models/Year.js";
import { env } from "../config/env.js";
import { getSessionOption } from "./transaction.js";

const UPLOAD_ROOT = env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");

export const deleteSchoolCascade = async (
  schoolId: mongoose.Types.ObjectId | string,
  session: ClientSession | null = null
): Promise<void> => {
  const schoolObjectId = typeof schoolId === "string" ? new mongoose.Types.ObjectId(schoolId) : schoolId;
  const options = getSessionOption(session);
  const filter = { schoolId: schoolObjectId };

  await Promise.all([
    AssignmentComment.deleteMany(filter, options),
    AssignmentSubmission.deleteMany(filter, options),
    Assignment.deleteMany(filter, options),
    Attendance.deleteMany(filter, options),
    Result.deleteMany(filter, options),
    ExamRoutine.deleteMany(filter, options),
    Exam.deleteMany(filter, options),
    Notice.deleteMany(filter, options),
    TimetableSlot.deleteMany(filter, options),
    LibraryIssue.deleteMany(filter, options),
    LibraryBook.deleteMany(filter, options),
    LaboratoryIssue.deleteMany(filter, options),
    LaboratoryEquipment.deleteMany(filter, options),
    LaboratoryCategory.deleteMany(filter, options),
    Laboratory.deleteMany(filter, options),
    TransportAssignment.deleteMany(filter, options),
    TransportRoute.deleteMany(filter, options),
    LeaveRequest.deleteMany(filter, options),
    Payroll.deleteMany(filter, options),
    FeeCollection.deleteMany(filter, options),
    FeeStructure.deleteMany(filter, options),
    AccountingExpense.deleteMany(filter, options),
    AccountingPurchase.deleteMany(filter, options),
    AccountingIncome.deleteMany(filter, options),
    SalaryPayment.deleteMany(filter, options),
    BankAccount.deleteMany(filter, options),
    CashBookEntry.deleteMany(filter, options),
    AccountingSettings.deleteMany(filter, options),
    Accountant.deleteMany(filter, options),
    ParentChildLink.deleteMany(filter, options),
    Notification.deleteMany(filter, options),
    AuditLog.deleteMany(filter, options)
  ]);

  await Student.deleteMany(filter, options);
  await Teacher.deleteMany(filter, options);
  await Subject.deleteMany(filter, options);
  await Year.deleteMany(filter, options);
  await Batch.deleteMany(filter, options);
  await Section.deleteMany(filter, options);
  await SchoolClass.deleteMany(filter, options);
  await Setting.deleteMany(filter, options);

  await User.deleteMany({ schoolId: schoolObjectId }, options);

  const school = await School.findByIdAndDelete(schoolObjectId, options);
  if (!school) {
    return;
  }

  const uploadDir = path.join(UPLOAD_ROOT, schoolObjectId.toString());
  await fs.remove(uploadDir).catch(() => undefined);
};