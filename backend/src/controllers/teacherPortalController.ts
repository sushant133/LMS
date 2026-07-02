import type { Request, Response } from "express";
import { Subject } from "../models/Subject";
import { SchoolClass } from "../models/SchoolClass";
import { Section } from "../models/Section";
import { Student } from "../models/Student";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/apiError";
import { sendSuccess } from "../utils/response";
import { requireTeacherScope } from "../utils/teacherScope";
import { tenantObjectId } from "../utils/tenant";

export const getTeacherAssignments = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role !== "TEACHER") {
    throw new ApiError(403, "Only teachers can access assignment scope");
  }

  const scope = await requireTeacherScope(req);
  const schoolId = tenantObjectId(req);

  if (scope.subjectIds.length > 0) {
    await Subject.updateMany(
      { _id: { $in: scope.subjectIds }, schoolId },
      { $addToSet: { teacherIds: scope.teacherId } }
    );
  }

  const [subjects, classes, sections, students] = await Promise.all([
    Subject.find({
      _id: { $in: scope.subjectIds },
      schoolId,
      teacherIds: scope.teacherId,
      classIds: { $in: scope.classIds }
    }).sort({ name: 1 }),
    SchoolClass.find({ _id: { $in: scope.classIds }, schoolId }).sort({ name: 1 }),
    Section.find({
      _id: { $in: scope.sectionIds },
      schoolId,
      classId: { $in: scope.classIds }
    }).sort({ name: 1 }),
    Student.find({
      schoolId,
      classId: { $in: scope.classIds },
      sectionId: { $in: scope.sectionIds }
    })
      .populate("user", "-password")
      .sort({ rollNumber: 1 })
  ]);

  return sendSuccess(res, "Teacher scope fetched", {
    scope,
    subjects,
    classes,
    sections,
    students
  });
});