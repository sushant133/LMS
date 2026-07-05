import type { Request, Response } from "express";
import type { DashboardHighlight } from "@phit-erp/shared";
import { Attendance } from "../models/Attendance.js";
import { Batch } from "../models/Batch.js";
import { FeeCollection } from "../models/FeeCollection.js";
import { Notice } from "../models/Notice.js";
import { Notification } from "../models/Notification.js";
import { getActiveBannersForUser } from "./bannerController.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Student } from "../models/Student.js";
import { Subject } from "../models/Subject.js";
import { Teacher } from "../models/Teacher.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getInstitutionType, isCollege } from "../utils/institution.js";
import { getLinkedStudentIds } from "../utils/parentScope.js";
import { getStudentProfile } from "../utils/studentScope.js";
import { getTeacherScope } from "../utils/teacherScope.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId } from "../utils/tenant.js";

export const getDashboard = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);
  const role = req.user?.role;
  const isParent = role === "PARENT";

  const noticeFilter =
    role === "COLLEGE_ADMIN" || role === "SUPER_ADMIN"
      ? { schoolId }
      : { schoolId, visibleTo: role };

  const notificationFilter: Record<string, unknown> = { schoolId };
  if (role !== "COLLEGE_ADMIN" && role !== "SUPER_ADMIN" && req.user?.userId) {
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

  const includeFees = role === "COLLEGE_ADMIN" || role === "SUPER_ADMIN";
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
    Notification.find(notificationFilter).sort({ createdAt: -1 }).limit(5).lean(),
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

  const adminLike = role === "COLLEGE_ADMIN" || role === "SUPER_ADMIN";
  const stats = adminLike
    ? [
        { label: "Students", value: studentCount },
        { label: "Teachers", value: teacherCount },
        { label: groupLabel, value: groupCount },
        { label: "Unread Alerts", value: unreadNotificationCount }
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
        href: "/students",
        tone: studentsWithDueFees > 0 ? "warning" : "default"
      },
      {
        label: "Latest notices published",
        value: `${noticeCount} active`,
        href: "/notices",
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