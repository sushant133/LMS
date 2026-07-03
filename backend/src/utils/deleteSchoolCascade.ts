import type { ClientSession } from "mongoose";
import mongoose from "mongoose";
import path from "path";
import fs from "fs-extra";
import { Assignment, AssignmentSubmission } from "../models/Assignment";
import { AssignmentComment } from "../models/AssignmentComment";
import { Attendance } from "../models/Attendance";
import { AuditLog } from "../models/AuditLog";
import { Exam } from "../models/Exam";
import { Accountant } from "../models/Accountant";
import { AccountingExpense } from "../models/AccountingExpense";
import { AccountingIncome } from "../models/AccountingIncome";
import { AccountingPurchase } from "../models/AccountingPurchase";
import { AccountingSettings } from "../models/AccountingSettings";
import { BankAccount } from "../models/BankAccount";
import { CashBookEntry } from "../models/CashBookEntry";
import { FeeCollection } from "../models/FeeCollection";
import { FeeStructure } from "../models/FeeStructure";
import { SalaryPayment } from "../models/SalaryPayment";
import { LibraryBook, LibraryIssue } from "../models/LibraryBook";
import { Laboratory, LaboratoryCategory, LaboratoryEquipment, LaboratoryIssue } from "../models/Laboratory";
import { LeaveRequest, Payroll } from "../models/LeaveRequest";
import { Notice } from "../models/Notice";
import { Notification } from "../models/Notification";
import { ParentChildLink } from "../models/ParentChildLink";
import { Result } from "../models/Result";
import { School } from "../models/School";
import { SchoolClass } from "../models/SchoolClass";
import { Section } from "../models/Section";
import { Setting } from "../models/Setting";
import { Student } from "../models/Student";
import { Subject } from "../models/Subject";
import { Teacher } from "../models/Teacher";
import { TimetableSlot } from "../models/TimetableSlot";
import { TransportAssignment, TransportRoute } from "../models/TransportRoute";
import { User } from "../models/User";
import { env } from "../config/env";
import { getSessionOption } from "./transaction";

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