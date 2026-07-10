import type { ClientSession, Types } from "mongoose";
import { AcademicLessonPlan } from "../models/AcademicLessonPlan.js";
import { AcademicLessonPlanItem } from "../models/AcademicLessonPlanItem.js";
import { AcademicLogBook } from "../models/AcademicLogBook.js";
import { AcademicLogBookEntry } from "../models/AcademicLogBookEntry.js";
import { AcademicProgress } from "../models/AcademicProgress.js";
import { AcademicPromotion } from "../models/AcademicPromotion.js";
import { AcademicSessionPlan } from "../models/AcademicSessionPlan.js";
import { AcademicSessionPlanUnit } from "../models/AcademicSessionPlanUnit.js";
import { Assignment, AssignmentSubmission } from "../models/Assignment.js";
import { AssignmentComment } from "../models/AssignmentComment.js";
import { Attendance } from "../models/Attendance.js";
import { DailyAttendance } from "../models/DailyAttendance.js";
import { DailyAttendanceLog } from "../models/DailyAttendanceLog.js";
import { EmailDeliveryLog } from "../models/EmailDeliveryLog.js";
import { FeeCollection } from "../models/FeeCollection.js";
import { FeeRefund } from "../models/FeeRefund.js";
import { LaboratoryIssue } from "../models/Laboratory.js";
import { LeaveRequest, Payroll } from "../models/LeaveRequest.js";
import { LibraryIssue } from "../models/LibraryBook.js";
import { Notification } from "../models/Notification.js";
import { ParentChildLink } from "../models/ParentChildLink.js";
import { Result } from "../models/Result.js";
import { SalaryPayment } from "../models/SalaryPayment.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { Student } from "../models/Student.js";
import { Subject } from "../models/Subject.js";
import { Teacher } from "../models/Teacher.js";
import { TimetableSlot } from "../models/TimetableSlot.js";
import { TransportAssignment } from "../models/TransportRoute.js";
import { User } from "../models/User.js";
import { Notice } from "../models/Notice.js";
import { JournalEntry } from "../models/JournalEntry.js";
import { SubjectAssignment } from "../models/SubjectAssignment.js";

type ObjectIdLike = Types.ObjectId | string;

const opts = (session?: ClientSession | null) => (session ? { session } : {});

/**
 * Permanently removes a student account and all personal / linked operational data:
 * Student profile, User login (email, phone, password), attendance, results, fees, etc.
 */
export const hardDeleteStudentAccount = async (params: {
  schoolId: ObjectIdLike;
  studentId: ObjectIdLike;
  session?: ClientSession | null;
}): Promise<{
  studentId: string;
  userId: string;
  email: string;
  fullName: string;
  admissionNumber: string;
}> => {
  const { schoolId, studentId, session } = params;
  const sessionOpt = opts(session);

  const student = await Student.findOne({ _id: studentId, schoolId }).session(session ?? null);
  if (!student) {
    throw new Error("STUDENT_NOT_FOUND");
  }

  const userId = student.user;
  const user = await User.findOne({ _id: userId, schoolId }).session(session ?? null);
  const email = user?.email ?? "";
  const fullName = user?.fullName ?? "";
  const admissionNumber = student.admissionNumber;

  // Pull student from daily attendance entry arrays (do not drop whole class sheets)
  await DailyAttendance.updateMany(
    { schoolId, "entries.studentId": student._id },
    { $pull: { entries: { studentId: student._id } } },
    sessionOpt
  );

  await Promise.all([
    Attendance.deleteMany({ schoolId, studentId: student._id }, sessionOpt),
    AssignmentSubmission.deleteMany({ schoolId, studentId: student._id }, sessionOpt),
    AcademicPromotion.deleteMany({ schoolId, studentId: student._id }, sessionOpt),
    Result.deleteMany({ schoolId, studentId: student._id }, sessionOpt),
    FeeCollection.deleteMany({ schoolId, studentId: student._id }, sessionOpt),
    FeeRefund.deleteMany({ schoolId, studentId: student._id }, sessionOpt),
    ParentChildLink.deleteMany({ schoolId, studentId: student._id }, sessionOpt),
    LibraryIssue.deleteMany({ schoolId, studentId: student._id }, sessionOpt),
    TransportAssignment.deleteMany({ schoolId, studentId: student._id }, sessionOpt),
    // Detach optional accounting links rather than deleting whole GL history when possible
    JournalEntry.updateMany(
      { schoolId, studentId: student._id },
      { $unset: { studentId: 1 } },
      sessionOpt
    )
  ]);

  if (userId) {
    await Promise.all([
      Notification.deleteMany({ schoolId, recipientUserId: userId }, sessionOpt),
      EmailDeliveryLog.deleteMany({ userId }, sessionOpt)
    ]);
  }

  await Student.deleteOne({ _id: student._id, schoolId }, sessionOpt);

  if (userId) {
    await User.deleteOne({ _id: userId, schoolId, role: "STUDENT" }, sessionOpt);
  }

  return {
    studentId: student._id.toString(),
    userId: userId?.toString() ?? "",
    email,
    fullName,
    admissionNumber
  };
};

/**
 * Permanently removes a teacher account and linked operational data:
 * Teacher profile, User login (email, phone, password), assignments, timetable, academic plans, etc.
 */
export const hardDeleteTeacherAccount = async (params: {
  schoolId: ObjectIdLike;
  teacherId: ObjectIdLike;
  session?: ClientSession | null;
}): Promise<{
  teacherId: string;
  userId: string;
  email: string;
  fullName: string;
  teacherCode: string;
}> => {
  const { schoolId, teacherId, session } = params;
  const sessionOpt = opts(session);

  const teacher = await Teacher.findOne({ _id: teacherId, schoolId }).session(session ?? null);
  if (!teacher) {
    throw new Error("TEACHER_NOT_FOUND");
  }

  const userId = teacher.user;
  const user = await User.findOne({ _id: userId, schoolId }).session(session ?? null);
  const email = user?.email ?? "";
  const fullName = user?.fullName ?? "";
  const teacherCode = teacher.teacherCode;

  // Hard-delete all subject assignment history with the teacher account
  await SubjectAssignment.deleteMany({ schoolId, teacherId: teacher._id }, sessionOpt);

  // Detach from subjects / class coordinator roles
  await Subject.updateMany(
    { schoolId, teacherIds: teacher._id },
    { $pull: { teacherIds: teacher._id } },
    sessionOpt
  );
  await Section.updateMany(
    { schoolId, classTeacherId: teacher._id },
    { $unset: { classTeacherId: 1 } },
    sessionOpt
  );
  await SchoolClass.updateMany(
    { schoolId, coordinatorId: teacher._id },
    { $unset: { coordinatorId: 1 } },
    sessionOpt
  );
  await Notice.updateMany(
    { schoolId, teacherId: teacher._id },
    { $unset: { teacherId: 1 } },
    sessionOpt
  );

  // Academic management owned by this teacher
  const sessionPlans = await AcademicSessionPlan.find(
    { schoolId, teacherId: teacher._id },
    { _id: 1 },
    sessionOpt
  ).lean();
  const sessionPlanIds = sessionPlans.map((row) => row._id);

  const lessonPlans = await AcademicLessonPlan.find(
    { schoolId, teacherId: teacher._id },
    { _id: 1 },
    sessionOpt
  ).lean();
  const lessonPlanIds = lessonPlans.map((row) => row._id);

  const logBooks = await AcademicLogBook.find(
    { schoolId, teacherId: teacher._id },
    { _id: 1 },
    sessionOpt
  ).lean();
  const logBookIds = logBooks.map((row) => row._id);

  const assignments = await Assignment.find(
    { schoolId, teacherId: teacher._id },
    { _id: 1 },
    sessionOpt
  ).lean();
  const assignmentIds = assignments.map((row) => row._id);

  const dailyAttendanceRows = await DailyAttendance.find(
    { schoolId, teacherId: teacher._id },
    { _id: 1 },
    sessionOpt
  ).lean();
  const dailyAttendanceIds = dailyAttendanceRows.map((row) => row._id);

  await Promise.all([
    sessionPlanIds.length
      ? AcademicSessionPlanUnit.deleteMany({ schoolId, sessionPlanId: { $in: sessionPlanIds } }, sessionOpt)
      : Promise.resolve(),
    sessionPlanIds.length
      ? AcademicProgress.deleteMany({ schoolId, sessionPlanId: { $in: sessionPlanIds } }, sessionOpt)
      : Promise.resolve(),
    lessonPlanIds.length
      ? AcademicLessonPlanItem.deleteMany({ schoolId, lessonPlanId: { $in: lessonPlanIds } }, sessionOpt)
      : Promise.resolve(),
    logBookIds.length
      ? AcademicLogBookEntry.deleteMany({ schoolId, logBookId: { $in: logBookIds } }, sessionOpt)
      : Promise.resolve(),
    AcademicSessionPlan.deleteMany({ schoolId, teacherId: teacher._id }, sessionOpt),
    AcademicLessonPlan.deleteMany({ schoolId, teacherId: teacher._id }, sessionOpt),
    AcademicLogBook.deleteMany({ schoolId, teacherId: teacher._id }, sessionOpt),
    AcademicProgress.deleteMany({ schoolId, teacherId: teacher._id }, sessionOpt),
    AcademicLogBookEntry.deleteMany({ schoolId, teacherId: teacher._id }, sessionOpt),
    assignmentIds.length
      ? AssignmentSubmission.deleteMany({ schoolId, assignmentId: { $in: assignmentIds } }, sessionOpt)
      : Promise.resolve(),
    assignmentIds.length
      ? AssignmentComment.deleteMany({ schoolId, assignmentId: { $in: assignmentIds } }, sessionOpt)
      : Promise.resolve(),
    Assignment.deleteMany({ schoolId, teacherId: teacher._id }, sessionOpt),
    Attendance.deleteMany({ schoolId, teacherId: teacher._id }, sessionOpt),
    dailyAttendanceIds.length
      ? DailyAttendanceLog.deleteMany({ schoolId, dailyAttendanceId: { $in: dailyAttendanceIds } }, sessionOpt)
      : Promise.resolve(),
    DailyAttendance.deleteMany({ schoolId, teacherId: teacher._id }, sessionOpt),
    TimetableSlot.deleteMany({ schoolId, teacherId: teacher._id }, sessionOpt),
    LeaveRequest.deleteMany({ schoolId, teacherId: teacher._id }, sessionOpt),
    Payroll.deleteMany({ schoolId, teacherId: teacher._id }, sessionOpt),
    LibraryIssue.deleteMany({ schoolId, teacherId: teacher._id }, sessionOpt),
    LaboratoryIssue.deleteMany({ schoolId, teacherId: teacher._id }, sessionOpt),
    SalaryPayment.deleteMany({ schoolId, teacherId: teacher._id }, sessionOpt)
  ]);

  if (userId) {
    await Promise.all([
      Notification.deleteMany({ schoolId, recipientUserId: userId }, sessionOpt),
      EmailDeliveryLog.deleteMany({ userId }, sessionOpt)
    ]);
  }

  await Teacher.deleteOne({ _id: teacher._id, schoolId }, sessionOpt);

  if (userId) {
    await User.deleteOne({ _id: userId, schoolId, role: "TEACHER" }, sessionOpt);
  }

  return {
    teacherId: teacher._id.toString(),
    userId: userId?.toString() ?? "",
    email,
    fullName,
    teacherCode
  };
};
