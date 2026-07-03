import type { Request, Response } from "express";
import { parentChildLinkSchema } from "@nepal-school-erp/shared";
import { Assignment } from "../models/Assignment.js";
import { AssignmentSubmission } from "../models/Assignment.js";
import { Notification } from "../models/Notification.js";
import { ParentChildLink } from "../models/ParentChildLink.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { Student } from "../models/Student.js";
import { Attendance } from "../models/Attendance.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { getLinkedStudentIds } from "../utils/parentScope.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

export const listParentUsers = asyncHandler(async (req: Request, res: Response) => {
  const parents = await User.find({ schoolId: tenantObjectId(req), role: "PARENT", isActive: true })
    .select("-password")
    .sort({ fullName: 1 });
  return sendSuccess(res, "Parent users fetched", parents);
});

export const listParentLinks = asyncHandler(async (req: Request, res: Response) => {
  const filter = withTenantScope(req);
  if (typeof req.query.parentUserId === "string") {
    Object.assign(filter, { parentUserId: req.query.parentUserId });
  }
  const links = await ParentChildLink.find(filter).populate({
    path: "studentId",
    populate: { path: "user", select: "-password" }
  });
  return sendSuccess(res, "Parent links fetched", links);
});

export const createParentLink = asyncHandler(async (req: Request, res: Response) => {
  const payload = parentChildLinkSchema.parse(req.body);
  const [parent, student] = await Promise.all([
    User.findOne({ _id: payload.parentUserId, role: "PARENT" }),
    Student.findOne(withTenantScope(req, { _id: payload.studentId }))
  ]);

  if (!parent) throw new ApiError(404, "Parent user not found");
  if (!student) throw new ApiError(404, "Student not found");

  const link = await ParentChildLink.create({ ...payload, schoolId: req.tenantSchoolId });
  return sendSuccess(res, "Parent linked to student", link, 201);
});

export const deleteParentLink = asyncHandler(async (req: Request, res: Response) => {
  const link = await ParentChildLink.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));
  if (!link) throw new ApiError(404, "Parent link not found");
  return sendSuccess(res, "Parent link removed");
});

export const getParentPortal = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role !== "PARENT") {
    throw new ApiError(403, "Parent portal is only available to parent accounts");
  }

  const schoolId = tenantObjectId(req);
  const studentIds = await getLinkedStudentIds(req);
  const students = await Student.find({ schoolId, _id: { $in: studentIds } }).populate("user", "-password").lean();

  const children = await Promise.all(
    students.map(async (student) => {
      const [schoolClass, section, attendanceRecords, submissions] = await Promise.all([
        SchoolClass.findById(student.classId).lean(),
        Section.findById(student.sectionId).lean(),
        Attendance.find({ schoolId, "entries.studentId": student._id }).lean(),
        AssignmentSubmission.find({ schoolId, studentId: student._id, status: "PENDING" }).lean()
      ]);

      let present = 0;
      let total = 0;
      attendanceRecords.forEach((record) => {
        const entry = record.entries.find((e) => e.studentId.toString() === student._id.toString());
        if (entry) {
          total += 1;
          if (entry.status === "PRESENT" || entry.status === "LATE") present += 1;
        }
      });

      const link = await ParentChildLink.findOne({ schoolId, parentUserId: req.user!.userId, studentId: student._id }).lean();

      return {
        studentId: student._id.toString(),
        fullName: (student.user as unknown as { fullName: string }).fullName,
        className: schoolClass?.name ?? "—",
        sectionName: section?.name ?? "—",
        rollNumber: student.rollNumber,
        feesDueNpr: student.feesDueNpr,
        attendanceRate: total > 0 ? Math.round((present / total) * 100) : 0,
        pendingHomework: submissions.length,
        relationship: link?.relationship ?? "GUARDIAN"
      };
    })
  );

  const [recentNotifications, upcomingHomework] = await Promise.all([
    Notification.find({ schoolId, recipientUserId: req.user.userId }).sort({ createdAt: -1 }).limit(10).lean(),
    Assignment.find({
      schoolId,
      visibleTo: "PARENT",
      dueDateBs: { $exists: true, $ne: "" }
    })
      .sort({ dueDateBs: 1 })
      .limit(5)
      .lean()
  ]);

  return sendSuccess(res, "Parent portal data fetched", {
    children,
    recentNotifications,
    upcomingHomework
  });
});