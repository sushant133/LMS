import type { Request, Response } from "express";
import { Batch } from "../models/Batch.js";
import { Subject } from "../models/Subject.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { Student } from "../models/Student.js";
import { Year } from "../models/Year.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { getInstitutionType, isCollege } from "../utils/institution.js";
import { sendSuccess } from "../utils/response.js";
import { requireTeacherScope } from "../utils/teacherScope.js";
import { tenantObjectId } from "../utils/tenant.js";

export const getTeacherAssignments = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role !== "TEACHER") {
    throw new ApiError(403, "Only teachers can access assignment scope");
  }

  const scope = await requireTeacherScope(req);
  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);
  const college = isCollege(institutionType);

  if (scope.subjectIds.length > 0) {
    await Subject.updateMany({ _id: { $in: scope.subjectIds }, schoolId }, { $addToSet: { teacherIds: scope.teacherId } });
  }

  if (college) {
    const [subjects, batches, years, students] = await Promise.all([
      Subject.find({
        _id: { $in: scope.subjectIds },
        schoolId,
        teacherIds: scope.teacherId,
        yearIds: { $in: scope.yearIds }
      }).sort({ name: 1 }),
      Batch.find({ _id: { $in: scope.batchIds }, schoolId }).sort({ name: 1 }),
      Year.find({
        _id: { $in: scope.yearIds },
        schoolId,
        batchId: { $in: scope.batchIds }
      }).sort({ level: 1 }),
      Student.find({
        schoolId,
        batchId: { $in: scope.batchIds },
        yearId: { $in: scope.yearIds }
      })
        .populate("user", "-password")
        .sort({ rollNumber: 1 })
    ]);

    return sendSuccess(res, "Teacher scope fetched", {
      scope,
      subjects,
      batches,
      years,
      students,
      classes: [],
      sections: []
    });
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
    batches: [],
    years: [],
    students
  });
});