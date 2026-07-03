import type { Request, Response } from "express";
import { Attendance } from "../models/Attendance.js";
import { Batch } from "../models/Batch.js";
import { FeeCollection } from "../models/FeeCollection.js";
import { Notice } from "../models/Notice.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Student } from "../models/Student.js";
import { Subject } from "../models/Subject.js";
import { Teacher } from "../models/Teacher.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getInstitutionType, isCollege } from "../utils/institution.js";
import { getStudentProfile } from "../utils/studentScope.js";
import { getTeacherScope } from "../utils/teacherScope.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId } from "../utils/tenant.js";

export const getDashboard = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);

  const noticeFilter =
    req.user?.role === "COLLEGE_ADMIN" || req.user?.role === "SUPER_ADMIN"
      ? { schoolId }
      : { schoolId, visibleTo: req.user?.role };

  const studentProfile = await getStudentProfile(req);
  const teacherScope = req.user?.role === "TEACHER" ? await getTeacherScope(req) : null;
  const attendanceFilter: Record<string, unknown> = { schoolId };
  const feeFilter: Record<string, unknown> = { schoolId };

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

  const includeFees = req.user?.role === "COLLEGE_ADMIN" || req.user?.role === "SUPER_ADMIN";
  const groupLabel = college ? "Batches" : "Classes";

  const [studentCount, teacherCount, groupCount, noticeCount, recentAttendance, recentCollections, notices, enrolledSubjects] =
    await Promise.all([
      Student.countDocuments({ schoolId }),
      Teacher.countDocuments({ schoolId }),
      college ? Batch.countDocuments({ schoolId }) : SchoolClass.countDocuments({ schoolId }),
      Notice.countDocuments(noticeFilter),
      Attendance.find(attendanceFilter).sort({ dateBs: -1 }).limit(7),
      includeFees ? FeeCollection.find(feeFilter).sort({ paidDateBs: -1 }).limit(12) : Promise.resolve([]),
      Notice.find(noticeFilter).sort({ publishDateBs: -1 }).limit(5),
      studentProfile
        ? college && studentProfile.yearId
          ? Subject.countDocuments({ schoolId, yearIds: studentProfile.yearId })
          : studentProfile.classId
            ? Subject.countDocuments({ schoolId, classIds: studentProfile.classId })
            : Promise.resolve(0)
        : Promise.resolve(0)
    ]);

  const attendanceChart = recentAttendance
    .slice()
    .reverse()
    .map((item) => {
      const entries = studentProfile
        ? item.entries.filter((entry) => entry.studentId.toString() === studentProfile.studentId)
        : item.entries;
      const present = entries.filter((entry) => entry.status === "PRESENT").length;
      const absent = entries.filter((entry) => entry.status !== "PRESENT").length;

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

  const adminLike = req.user?.role === "COLLEGE_ADMIN" || req.user?.role === "SUPER_ADMIN";
  const stats = adminLike
    ? [
        { label: "Students", value: studentCount },
        { label: "Teachers", value: teacherCount },
        { label: groupLabel, value: groupCount },
        { label: "Notices", value: noticeCount }
      ]
    : studentProfile
      ? [
          { label: "Enrolled Subjects", value: enrolledSubjects },
          { label: "Visible Notices", value: noticeCount },
          { label: "Attendance Days", value: attendanceChart.length },
          { label: "Fee Entries", value: recentCollections.length }
        ]
      : teacherScope
        ? [
            {
              label: college ? "Assigned Batches" : "Assigned Classes",
              value: college ? teacherScope.batchIds.length : teacherScope.classIds.length
            },
            { label: "Assigned Subjects", value: teacherScope.subjectIds.length },
            { label: "Visible Notices", value: noticeCount },
            { label: "Attendance Days", value: attendanceChart.length }
          ]
        : [
            { label: "Visible Notices", value: noticeCount },
            { label: "Attendance Days", value: attendanceChart.length },
            { label: groupLabel, value: groupCount }
          ];

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
    notices
  });
});