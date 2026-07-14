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
import { LibraryBookCopy, LibraryIssue } from "../models/LibraryBook.js";
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
import { syncBookCopyCounts } from "./libraryCopies.js";

type ObjectIdLike = Types.ObjectId | string;

const opts = (session?: ClientSession | null) => (session ? { session } : {});

const ACTIVE_ISSUE_STATUSES = ["ISSUED", "OVERDUE"] as const;

/**
 * Free physical library copies for open issues, then remove issue rows.
 * Prevents copies stuck as ISSUED after borrower hard-delete.
 */
async function releaseLibraryIssuesForBorrower(params: {
  schoolId: ObjectIdLike;
  filter: Record<string, unknown>;
  session?: ClientSession | null;
}): Promise<void> {
  const { schoolId, filter, session } = params;
  const sessionOpt = opts(session);

  const activeIssues = await LibraryIssue.find({
    schoolId,
    ...filter,
    status: { $in: [...ACTIVE_ISSUE_STATUSES] }
  })
    .select("_id copyId bookId")
    .session(session ?? null)
    .lean();

  const copyIds = activeIssues
    .map((issue) => issue.copyId)
    .filter((id): id is NonNullable<typeof id> => Boolean(id));

  const bookIds = [
    ...new Set(
      activeIssues
        .map((issue) => issue.bookId?.toString())
        .filter((id): id is string => Boolean(id))
    )
  ];

  if (copyIds.length > 0) {
    await LibraryBookCopy.updateMany(
      { schoolId, _id: { $in: copyIds }, status: "ISSUED" },
      { $set: { status: "AVAILABLE" } },
      sessionOpt
    );
  }

  await LibraryIssue.deleteMany({ schoolId, ...filter }, sessionOpt);

  for (const bookId of bookIds) {
    await syncBookCopyCounts(bookId, schoolId, session);
  }
}

/**
 * Permanently removes a student account and linked operational data.
 * Posted fee collections / refunds are NEVER hard-deleted (financial integrity).
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

  // Block delete when financial history exists — preserves GL / cash book audit trail
  const [openFeeCount, openRefundCount] = await Promise.all([
    FeeCollection.countDocuments({ schoolId, studentId: student._id, isDeleted: false }).session(
      session ?? null
    ),
    FeeRefund.countDocuments({ schoolId, studentId: student._id, isDeleted: false }).session(
      session ?? null
    )
  ]);

  if (openFeeCount > 0 || openRefundCount > 0) {
    throw new Error("STUDENT_HAS_FEE_HISTORY");
  }

  const userId = student.user;
  const user = await User.findOne({ _id: userId, schoolId }).session(session ?? null);
  const email = user?.email ?? "";
  const fullName = user?.fullName ?? "";
  const admissionNumber = student.admissionNumber;

  // Collect media URLs before hard-delete (Cloudinary cleanup after commit is fine)
  const mediaUrls: string[] = [];
  if (student.photoUrl) mediaUrls.push(student.photoUrl);
  for (const doc of student.documents ?? []) {
    const url = (doc as { url?: string }).url;
    if (url) mediaUrls.push(url);
  }
  if (user?.profilePhotoUrl) mediaUrls.push(user.profilePhotoUrl);

  // Pull student from attendance entry arrays (do not drop whole class sheets)
  await DailyAttendance.updateMany(
    { schoolId, "entries.studentId": student._id },
    { $pull: { entries: { studentId: student._id } } },
    sessionOpt
  );
  await Attendance.updateMany(
    { schoolId, "entries.studentId": student._id },
    { $pull: { entries: { studentId: student._id } } },
    sessionOpt
  );

  await releaseLibraryIssuesForBorrower({
    schoolId,
    filter: { studentId: student._id },
    session
  });

  await Promise.all([
    AssignmentSubmission.deleteMany({ schoolId, studentId: student._id }, sessionOpt),
    AcademicPromotion.deleteMany({ schoolId, studentId: student._id }, sessionOpt),
    Result.deleteMany({ schoolId, studentId: student._id }, sessionOpt),
    ParentChildLink.deleteMany({ schoolId, studentId: student._id }, sessionOpt),
    TransportAssignment.deleteMany({ schoolId, studentId: student._id }, sessionOpt),
    // Detach optional accounting links rather than deleting whole GL history
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

  // Best-effort CDN/local cleanup (outside critical path failures)
  if (mediaUrls.length > 0) {
    void import("./mediaCleanup.js")
      .then(({ deleteStoredMediaUrls }) => deleteStoredMediaUrls(mediaUrls))
      .catch(() => undefined);
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
 * Permanently removes a teacher account and linked operational data.
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

  // Collect Cloudinary / local media before hard-delete
  const mediaUrls: string[] = [];
  if (user?.profilePhotoUrl) mediaUrls.push(user.profilePhotoUrl);

  await SubjectAssignment.deleteMany({ schoolId, teacherId: teacher._id }, sessionOpt);

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
    { _id: 1, attachments: 1 },
    sessionOpt
  ).lean();
  const assignmentIds = assignments.map((row) => row._id);
  for (const row of assignments) {
    for (const att of (row as { attachments?: Array<{ url?: string }> }).attachments ?? []) {
      if (att?.url) mediaUrls.push(att.url);
    }
  }
  if (assignmentIds.length > 0) {
    const submissions = await AssignmentSubmission.find(
      { schoolId, assignmentId: { $in: assignmentIds } },
      { attachmentUrl: 1, attachments: 1 },
      sessionOpt
    ).lean();
    for (const sub of submissions) {
      const s = sub as { attachmentUrl?: string; attachments?: Array<{ url?: string }> };
      if (s.attachmentUrl) mediaUrls.push(s.attachmentUrl);
      for (const att of s.attachments ?? []) {
        if (att?.url) mediaUrls.push(att.url);
      }
    }
  }

  const dailyAttendanceRows = await DailyAttendance.find(
    { schoolId, teacherId: teacher._id },
    { _id: 1 },
    sessionOpt
  ).lean();
  const dailyAttendanceIds = dailyAttendanceRows.map((row) => row._id);

  await releaseLibraryIssuesForBorrower({
    schoolId,
    filter: { teacherId: teacher._id },
    session
  });

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

  if (mediaUrls.length > 0) {
    void import("./mediaCleanup.js")
      .then(({ deleteStoredMediaUrls }) => deleteStoredMediaUrls(mediaUrls))
      .catch(() => undefined);
  }

  return {
    teacherId: teacher._id.toString(),
    userId: userId?.toString() ?? "",
    email,
    fullName,
    teacherCode
  };
};
