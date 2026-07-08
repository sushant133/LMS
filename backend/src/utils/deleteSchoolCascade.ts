import type { ClientSession } from "mongoose";
import mongoose from "mongoose";
import path from "path";
import fs from "fs-extra";
import { AcademicApproval } from "../models/AcademicApproval.js";
import { AcademicCalendarEvent } from "../models/AcademicCalendarEvent.js";
import { AcademicComment } from "../models/AcademicComment.js";
import { AcademicLessonPlan } from "../models/AcademicLessonPlan.js";
import { AcademicLessonPlanItem } from "../models/AcademicLessonPlanItem.js";
import { AcademicLogBook } from "../models/AcademicLogBook.js";
import { AcademicLogBookEntry } from "../models/AcademicLogBookEntry.js";
import { AcademicProgress } from "../models/AcademicProgress.js";
import { AcademicSessionPlan } from "../models/AcademicSessionPlan.js";
import { AcademicSessionPlanUnit } from "../models/AcademicSessionPlanUnit.js";
import { Assignment, AssignmentSubmission } from "../models/Assignment.js";
import { Batch } from "../models/Batch.js";
import { AssignmentComment } from "../models/AssignmentComment.js";
import { Attendance } from "../models/Attendance.js";
import { DailyAttendance } from "../models/DailyAttendance.js";
import { DailyAttendanceLog } from "../models/DailyAttendanceLog.js";
import { AuditLog } from "../models/AuditLog.js";
import { Exam } from "../models/Exam.js";
import { ExamRoutine } from "../models/ExamRoutine.js";
import { Accountant } from "../models/Accountant.js";
import { CollegeStaff } from "../models/CollegeStaff.js";
import { AccountingExpense } from "../models/AccountingExpense.js";
import { AccountingIncome } from "../models/AccountingIncome.js";
import { AccountingPurchase } from "../models/AccountingPurchase.js";
import { AccountingSettings } from "../models/AccountingSettings.js";
import { BankAccount } from "../models/BankAccount.js";
import { CashBookEntry } from "../models/CashBookEntry.js";
import { ChartOfAccount } from "../models/ChartOfAccount.js";
import { FeeCollection } from "../models/FeeCollection.js";
import { FeeRefund } from "../models/FeeRefund.js";
import { FeeStructure } from "../models/FeeStructure.js";
import { FiscalYear } from "../models/FiscalYear.js";
import { JournalEntry } from "../models/JournalEntry.js";
import { Vendor } from "../models/Vendor.js";
import { SalaryPayment } from "../models/SalaryPayment.js";
import { LibraryBook, LibraryIssue } from "../models/LibraryBook.js";
import { Laboratory, LaboratoryCategory, LaboratoryEquipment, LaboratoryIssue } from "../models/Laboratory.js";
import { LeaveRequest, Payroll } from "../models/LeaveRequest.js";
import { Banner } from "../models/Banner.js";
import { BannerDismissal } from "../models/BannerDismissal.js";
import { Complaint } from "../models/Complaint.js";
import { Notice } from "../models/Notice.js";
import { Notification } from "../models/Notification.js";
import { ParentChildLink } from "../models/ParentChildLink.js";
import { Result } from "../models/Result.js";
import { ResultSubmission } from "../models/ResultSubmission.js";
import { School } from "../models/School.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { Setting } from "../models/Setting.js";
import { Student } from "../models/Student.js";
import { MasterSubject } from "../models/MasterSubject.js";
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
    AcademicApproval.deleteMany(filter, options),
    AcademicCalendarEvent.deleteMany(filter, options),
    AcademicComment.deleteMany(filter, options),
    AcademicLogBookEntry.deleteMany(filter, options),
    AcademicLogBook.deleteMany(filter, options),
    AcademicLessonPlanItem.deleteMany(filter, options),
    AcademicLessonPlan.deleteMany(filter, options),
    AcademicSessionPlanUnit.deleteMany(filter, options),
    AcademicProgress.deleteMany(filter, options),
    AcademicSessionPlan.deleteMany(filter, options),
    AssignmentComment.deleteMany(filter, options),
    AssignmentSubmission.deleteMany(filter, options),
    Assignment.deleteMany(filter, options),
    Attendance.deleteMany(filter, options),
    DailyAttendanceLog.deleteMany(filter, options),
    DailyAttendance.deleteMany(filter, options),
    Result.deleteMany(filter, options),
    ResultSubmission.deleteMany(filter, options),
    ExamRoutine.deleteMany(filter, options),
    Exam.deleteMany(filter, options),
    Notice.deleteMany(filter, options),
    Complaint.deleteMany(filter, options),
    BannerDismissal.deleteMany(filter, options),
    Banner.deleteMany(filter, options),
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
    ChartOfAccount.deleteMany(filter, options),
    JournalEntry.deleteMany(filter, options),
    Vendor.deleteMany(filter, options),
    FeeRefund.deleteMany(filter, options),
    FiscalYear.deleteMany(filter, options),
    Accountant.deleteMany(filter, options),
    CollegeStaff.deleteMany(filter, options),
    ParentChildLink.deleteMany(filter, options),
    Notification.deleteMany(filter, options),
    AuditLog.deleteMany(filter, options)
  ]);

  await Student.deleteMany(filter, options);
  await Teacher.deleteMany(filter, options);
  await Subject.deleteMany(filter, options);
  await MasterSubject.deleteMany(filter, options);
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