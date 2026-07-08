import type { Request, Response } from "express";
import { hasInstitutionAccess, type DashboardFeeDueStudent, type DashboardHighlight } from "@phit-erp/shared";
import { AccountingSettings } from "../models/AccountingSettings.js";
import { Attendance } from "../models/Attendance.js";
import { Batch } from "../models/Batch.js";
import { FeeCollection } from "../models/FeeCollection.js";
import { Notice } from "../models/Notice.js";
import { Notification } from "../models/Notification.js";
import { getActiveBannersForUser } from "./bannerController.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { Student } from "../models/Student.js";
import { Subject } from "../models/Subject.js";
import { Teacher } from "../models/Teacher.js";
import { Year } from "../models/Year.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { assertInstitutionRead, assertInstitutionWrite } from "../utils/institutionAccess.js";
import { getInstitutionType, isCollege } from "../utils/institution.js";
import { getLinkedStudentIds } from "../utils/parentScope.js";
import { getStudentProfile } from "../utils/studentScope.js";
import { getTeacherScope } from "../utils/teacherScope.js";
import { sendNotification, notifyParentsOfStudent } from "../utils/notificationService.js";
import { ApiError } from "../utils/apiError.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId } from "../utils/tenant.js";

const resolvePaymentStatus = (
  outstandingAmountNpr: number,
  amountPaidNpr: number,
  dueDateBs?: string,
  graceDays = 0
): DashboardFeeDueStudent["paymentStatus"] => {
  if (outstandingAmountNpr <= 0) {
    return "PARTIAL";
  }
  if (amountPaidNpr <= 0) {
    return "PENDING";
  }
  if (!dueDateBs) {
    return "PARTIAL";
  }

  const dueParts = dueDateBs.split("-").map(Number);
  const [year, month, day] = dueParts;
  if (dueParts.length !== 3 || year === undefined || month === undefined || day === undefined || dueParts.some((part) => Number.isNaN(part))) {
    return "PARTIAL";
  }

  const dueTimestamp = Date.UTC(year, month - 1, day + graceDays);
  return Date.now() > dueTimestamp ? "OVERDUE" : "PARTIAL";
};

const buildFeeDueStudents = async (req: Request, schoolId: ReturnType<typeof tenantObjectId>): Promise<DashboardFeeDueStudent[]> => {
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);

  const [students, primaryGroups, secondaryGroups, collections, settings] = await Promise.all([
    Student.find({ schoolId, feesDueNpr: { $gt: 0 } })
      .populate("user", "-password")
      .sort({ feesDueNpr: -1 })
      .lean(),
    college ? Batch.find({ schoolId }).lean() : SchoolClass.find({ schoolId }).lean(),
    college ? Year.find({ schoolId }).lean() : Section.find({ schoolId }).lean(),
    FeeCollection.find({ schoolId, isDeleted: false }).lean(),
    AccountingSettings.findOne({ schoolId }).lean()
  ]);

  const primaryMap = new Map(primaryGroups.map((item) => [item._id.toString(), item.name]));
  const secondaryMap = new Map(secondaryGroups.map((item) => [item._id.toString(), item.name]));
  const graceDays = settings?.lateFineGraceDays ?? 0;

  return students.map((student) => {
    const studentCollections = collections
      .filter((item) => item.studentId.toString() === student._id.toString())
      .sort((a, b) => b.paidDateBs.localeCompare(a.paidDateBs));
    const totalPaid = studentCollections.reduce((sum, item) => sum + item.amountPaidNpr, 0);
    const totalDiscount = studentCollections.reduce((sum, item) => sum + (item.discountNpr ?? 0), 0);
    const totalScholarship = studentCollections.reduce((sum, item) => sum + (item.scholarshipNpr ?? 0), 0);
    const outstandingAmountNpr = student.feesDueNpr ?? 0;
    const totalFeeNpr = totalPaid + outstandingAmountNpr + totalDiscount + totalScholarship;
    const latestCollection = studentCollections[0];
    const installmentCollections = studentCollections.filter((item) => item.isInstallment && item.totalInstallments);
    const maxInstallments = installmentCollections.reduce(
      (max, item) => Math.max(max, item.totalInstallments ?? 0),
      0
    );
    const paidInstallments = new Set(
      installmentCollections.map((item) => item.installmentNumber).filter((value): value is number => typeof value === "number")
    ).size;
    const pendingInstallments = maxInstallments > 0 ? Math.max(maxInstallments - paidInstallments, 1) : outstandingAmountNpr > 0 ? 1 : 0;

    const primaryId = college ? student.batchId?.toString() : student.classId?.toString();
    const secondaryId = college ? student.yearId?.toString() : student.sectionId?.toString();
    const user = student.user as { _id?: { toString(): string }; fullName?: string; email?: string } | null;

    return {
      studentId: student._id.toString(),
      recipientUserId: user?._id?.toString() ?? "",
      photoUrl: student.photoUrl ?? undefined,
      fullName: user?.fullName ?? "Student",
      admissionNumber: student.admissionNumber,
      rollNumber: student.rollNumber,
      courseName: primaryId ? (primaryMap.get(primaryId) ?? "") : "",
      yearName: college && secondaryId ? (secondaryMap.get(secondaryId) ?? "") : undefined,
      sectionName: !college && secondaryId ? (secondaryMap.get(secondaryId) ?? "") : undefined,
      parentName: student.guardianName || student.fatherName,
      contactNumber: student.guardianPhone || student.fatherPhone || "",
      email: user?.email ?? "",
      totalFeeNpr,
      amountPaidNpr: totalPaid,
      outstandingAmountNpr,
      dueDateBs: latestCollection?.paidDateBs,
      pendingInstallments,
      paymentStatus: resolvePaymentStatus(outstandingAmountNpr, totalPaid, latestCollection?.paidDateBs, graceDays),
      lastReceiptId: latestCollection?._id.toString()
    };
  });
};

export const getDashboard = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);
  const role = req.user?.role;
  const isParent = role === "PARENT";

  const institutionAccess = hasInstitutionAccess(role ?? "");

  const noticeFilter = institutionAccess ? { schoolId } : { schoolId, visibleTo: role };

  const notificationFilter: Record<string, unknown> = { schoolId };
  if (!institutionAccess && req.user?.userId) {
    notificationFilter.recipientUserId = req.user.userId;
  }

  const studentProfile = await getStudentProfile(req);
  const teacherScope = role === "TEACHER" ? await getTeacherScope(req) : null;
  const linkedStudentIds = isParent ? await getLinkedStudentIds(req) : [];
  const attendanceFilter: Record<string, unknown> = { schoolId };
  const feeFilter: Record<string, unknown> = { schoolId };
  const includeAttendanceChart = Boolean(studentProfile || teacherScope);

  if (teacherScope) {
    if (college) {
      attendanceFilter.batchId = { $in: teacherScope.batchIds };
      attendanceFilter.yearId = { $in: teacherScope.yearIds };
    } else {
      attendanceFilter.classId = { $in: teacherScope.classIds };
      attendanceFilter.sectionId = { $in: teacherScope.sectionIds };
    }
    attendanceFilter.subjectId = { $in: teacherScope.subjectIds };
  }

  if (studentProfile) {
    if (college) {
      if (studentProfile.yearId) {
        const enrolledSubjectIds = await Subject.find({
          schoolId,
          yearIds: studentProfile.yearId
        }).distinct("_id");
        attendanceFilter.batchId = studentProfile.batchId;
        attendanceFilter.yearId = studentProfile.yearId;
        attendanceFilter.subjectId = { $in: enrolledSubjectIds };
      }
    } else {
      const enrolledSubjectIds = await Subject.find({ schoolId, classIds: studentProfile.classId }).distinct("_id");
      attendanceFilter.classId = studentProfile.classId;
      attendanceFilter.sectionId = studentProfile.sectionId;
      attendanceFilter.subjectId = { $in: enrolledSubjectIds };
    }
    attendanceFilter["entries.studentId"] = studentProfile.studentId;
    feeFilter.studentId = studentProfile.studentId;
  }

  const includeFees = institutionAccess;
  const groupLabel = college ? "Batches" : "Classes";

  const [
    studentCount,
    teacherCount,
    groupCount,
    noticeCount,
    recentAttendance,
    recentCollections,
    notices,
    enrolledSubjects,
    banners,
    notifications,
    unreadNotificationCount,
    pendingFeesStudents,
    linkedStudents
  ] = await Promise.all([
    Student.countDocuments({ schoolId }),
    Teacher.countDocuments({ schoolId }),
    college ? Batch.countDocuments({ schoolId }) : SchoolClass.countDocuments({ schoolId }),
    Notice.countDocuments(noticeFilter),
    includeAttendanceChart ? Attendance.find(attendanceFilter).sort({ dateBs: -1 }).limit(7) : Promise.resolve([]),
    includeFees ? FeeCollection.find(feeFilter).sort({ paidDateBs: -1 }).limit(12) : Promise.resolve([]),
    Notice.find(noticeFilter).sort({ publishDateBs: -1 }).limit(5),
    studentProfile
      ? college && studentProfile.yearId
        ? Subject.countDocuments({ schoolId, yearIds: studentProfile.yearId })
        : studentProfile.classId
          ? Subject.countDocuments({ schoolId, classIds: studentProfile.classId })
          : Promise.resolve(0)
      : Promise.resolve(0),
    getActiveBannersForUser(req),
    Notification.find({ ...notificationFilter, read: false }).sort({ createdAt: -1 }).limit(5).lean(),
    Notification.countDocuments({ ...notificationFilter, read: false }),
    includeFees
      ? Student.find({ schoolId, feesDueNpr: { $gt: 0 } }).select("feesDueNpr").lean()
      : Promise.resolve([]),
    isParent && linkedStudentIds.length
      ? Student.find({ schoolId, _id: { $in: linkedStudentIds } })
          .populate("user", "fullName")
          .select("feesDueNpr user")
          .lean()
      : Promise.resolve([])
  ]);

  const attendanceChart = recentAttendance
    .slice()
    .reverse()
    .map((item) => {
      const entries = studentProfile
        ? item.entries.filter((entry) => entry.studentId.toString() === studentProfile.studentId)
        : item.entries;
      const present = entries.filter((entry) => entry.status === "PRESENT" || entry.status === "LATE").length;
      const absent = entries.filter((entry) => entry.status !== "PRESENT" && entry.status !== "LATE").length;

      return {
        label: item.dateBs,
        present,
        absent
      };
    });

  const feeChart = Object.values(
    recentCollections.reduce<Record<string, { label: string; amount: number }>>((acc, item) => {
      const key = item.paidDateBs.slice(0, 7);
      acc[key] ??= { label: key, amount: 0 };
      acc[key].amount += item.amountPaidNpr;
      return acc;
    }, {})
  );

  const pendingFeesTotalNpr = pendingFeesStudents.reduce((sum, student) => sum + (student.feesDueNpr ?? 0), 0);
  const studentsWithDueFees = pendingFeesStudents.length;
  const children = linkedStudents.map((student) => ({
    studentId: student._id.toString(),
    fullName: (student.user as { fullName?: string } | null)?.fullName ?? "Student",
    feesDueNpr: student.feesDueNpr ?? 0
  }));
  const parentFeesDueNpr = children.reduce((sum, child) => sum + child.feesDueNpr, 0);

  const adminLike = institutionAccess;

  let collegeYearStats: Array<{ label: string; value: number }> = [];
  if (adminLike && college) {
    const [years, activeStudents, passedOutCount, alumniCount] = await Promise.all([
      Year.find({ schoolId }).select("_id name level").lean(),
      Student.find({
        schoolId,
        $or: [{ academicStatus: "ACTIVE" }, { academicStatus: { $exists: false } }, { academicStatus: null }]
      })
        .select("yearId")
        .lean(),
      Student.countDocuments({ schoolId, academicStatus: "PASSED_OUT" }),
      Student.countDocuments({ schoolId, academicStatus: "ALUMNI" })
    ]);

    const yearNameById = new Map(years.map((year) => [year._id.toString(), year.name]));
    const countsByYearName = new Map<string, number>();
    for (const year of years) {
      countsByYearName.set(year.name, 0);
    }
    for (const student of activeStudents) {
      const yearName = student.yearId ? yearNameById.get(student.yearId.toString()) : undefined;
      if (!yearName) continue;
      countsByYearName.set(yearName, (countsByYearName.get(yearName) ?? 0) + 1);
    }

    collegeYearStats = [
      ...[...countsByYearName.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([label, value]) => ({ label, value })),
      { label: "Passed Out", value: passedOutCount },
      { label: "Alumni", value: alumniCount }
    ];
  }

  const stats = adminLike
    ? [
        { label: "Students", value: studentCount },
        { label: "Teachers", value: teacherCount },
        { label: groupLabel, value: groupCount },
        { label: "Unread Alerts", value: unreadNotificationCount },
        ...collegeYearStats
      ]
    : studentProfile
      ? [
          { label: "Enrolled Subjects", value: enrolledSubjects },
          { label: "Unread Alerts", value: unreadNotificationCount },
          { label: "Attendance Days", value: attendanceChart.length },
          { label: "Visible Notices", value: noticeCount }
        ]
      : isParent
        ? [
            { label: "Linked Children", value: children.length },
            { label: "Unread Alerts", value: unreadNotificationCount },
            { label: "Visible Notices", value: noticeCount },
            { label: "Children with Fees Due", value: children.filter((child) => child.feesDueNpr > 0).length }
          ]
        : teacherScope
          ? [
              {
                label: college ? "Assigned Batches" : "Assigned Classes",
                value: college ? teacherScope.batchIds.length : teacherScope.classIds.length
              },
              { label: "Assigned Subjects", value: teacherScope.subjectIds.length },
              { label: "Unread Alerts", value: unreadNotificationCount },
              { label: "Attendance Days", value: attendanceChart.length }
            ]
          : [
              { label: "Visible Notices", value: noticeCount },
              { label: "Unread Alerts", value: unreadNotificationCount },
              { label: groupLabel, value: groupCount }
            ];

  const highlights: DashboardHighlight[] = [];

  if (adminLike) {
    highlights.push(
      {
        label: "Outstanding student fees",
        value: `NPR ${pendingFeesTotalNpr.toLocaleString("en-NP")}`,
        href: "/accounting",
        tone: pendingFeesTotalNpr > 0 ? "warning" : "success"
      },
      {
        label: "Students with fee dues",
        value: `${studentsWithDueFees} student${studentsWithDueFees === 1 ? "" : "s"}`,
        action: "fee-dues",
        tone: studentsWithDueFees > 0 ? "warning" : "default"
      },
      {
        label: "Latest notices published",
        value: `${noticeCount} active`,
        href: "/notices",
        tone: "info"
      },
      {
        label: "Academic calendar",
        value: "View BS holidays & events",
        href: "/academic-calendar",
        tone: "info"
      }
    );
  } else if (studentProfile) {
    const studentRecord = await Student.findById(studentProfile.studentId).select("feesDueNpr").lean();
    const feesDue = studentRecord?.feesDueNpr ?? 0;
    highlights.push(
      {
        label: "Your fees due",
        value: `NPR ${feesDue.toLocaleString("en-NP")}`,
        href: "/my-fees",
        tone: feesDue > 0 ? "warning" : "success"
      },
      {
        label: "Assignments & CAS",
        value: "Open classroom stream",
        href: "/homework-view",
        tone: "info"
      },
      {
        label: "Academic calendar",
        value: "View holidays and exam dates",
        href: "/academic-calendar",
        tone: "info"
      }
    );
  } else if (isParent) {
    highlights.push(
      {
        label: "Combined fees due",
        value: `NPR ${parentFeesDueNpr.toLocaleString("en-NP")}`,
        href: "/parent-portal",
        tone: parentFeesDueNpr > 0 ? "warning" : "success"
      },
      {
        label: "Parent portal",
        value: children.length ? `${children.length} linked child profile${children.length === 1 ? "" : "s"}` : "No children linked yet",
        href: "/parent-portal",
        tone: children.length ? "info" : "warning"
      },
      {
        label: "Academic calendar",
        value: "College holidays and events",
        href: "/academic-calendar",
        tone: "info"
      }
    );
  } else if (teacherScope) {
    highlights.push(
      {
        label: "Mark attendance",
        value: "Record today's class attendance",
        href: "/attendance",
        tone: "info"
      },
      {
        label: "Assignments",
        value: "Publish homework and CAS updates",
        href: "/homework",
        tone: "info"
      },
      {
        label: "Academic calendar",
        value: "BS holidays and exam schedule",
        href: "/academic-calendar",
        tone: "info"
      }
    );
  }

  if (unreadNotificationCount > 0) {
    highlights.unshift({
      label: "Unread notifications",
      value: `${unreadNotificationCount} new alert${unreadNotificationCount === 1 ? "" : "s"}`,
      href: "/notifications",
      tone: "warning"
    });
  }

  return sendSuccess(res, "Dashboard data fetched", {
    stats,
    attendanceChart,
    feeChart: includeFees ? feeChart : [],
    counts: adminLike
      ? [
          { name: "Students", value: studentCount },
          { name: "Teachers", value: teacherCount },
          { name: groupLabel, value: groupCount }
        ]
      : teacherScope
        ? college
          ? [
              { name: "Batches", value: teacherScope.batchIds.length },
              { name: "Subjects", value: teacherScope.subjectIds.length },
              { name: "Years", value: teacherScope.yearIds.length }
            ]
          : [
              { name: "Classes", value: teacherScope.classIds.length },
              { name: "Subjects", value: teacherScope.subjectIds.length },
              { name: "Sections", value: teacherScope.sectionIds.length }
            ]
        : [],
    notices,
    banners,
    notifications: notifications.map((notification) => ({
      _id: notification._id.toString(),
      title: notification.title,
      message: notification.message,
      type: notification.type,
      read: notification.read,
      createdAt: notification.createdAt?.toISOString()
    })),
    unreadNotificationCount,
    highlights,
    pendingFeesTotalNpr: adminLike ? pendingFeesTotalNpr : undefined,
    studentsWithDueFees: adminLike ? studentsWithDueFees : undefined,
    children: isParent ? children : undefined
  });
});

export const getDashboardFeeDues = asyncHandler(async (req: Request, res: Response) => {
  assertInstitutionRead(req);
  const schoolId = tenantObjectId(req);
  const students = await buildFeeDueStudents(req, schoolId);
  return sendSuccess(res, "Students with fee dues fetched", students);
});

export const sendFeeDueReminder = asyncHandler(async (req: Request, res: Response) => {
  assertInstitutionWrite(req);
  const schoolId = tenantObjectId(req);
  const student = await Student.findOne({ _id: req.params.studentId, schoolId, feesDueNpr: { $gt: 0 } })
    .populate("user", "-password")
    .lean();

  if (!student) {
    throw new ApiError(404, "Student with fee dues not found");
  }

  const user = student.user as { _id?: { toString(): string }; fullName?: string } | null;
  const recipientUserId = user?._id?.toString();
  if (!recipientUserId) {
    throw new ApiError(400, "Student account is missing a linked user");
  }

  const outstandingAmountNpr = student.feesDueNpr ?? 0;
  const studentName = user?.fullName ?? "Student";
  const title = "Fee payment reminder";
  const message = `${studentName}, an outstanding fee balance of NPR ${outstandingAmountNpr.toLocaleString("en-NP")} is due. Please contact the accounts office to settle your dues.`;

  await sendNotification({
    schoolId: schoolId.toString(),
    recipientUserId,
    title,
    message,
    type: "FEE",
    channel: "BOTH",
    metadata: { studentId: student._id.toString() }
  });

  await notifyParentsOfStudent(schoolId.toString(), student._id.toString(), title, message, "FEE", "BOTH");

  return sendSuccess(res, "Fee reminder sent");
});