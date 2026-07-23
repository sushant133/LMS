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
import { resolveLabAccess } from "../utils/laboratoryAccess.js";
import { getScopeMode } from "../utils/subjectAssignmentService.js";
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
  const scopeMode = await getScopeMode(schoolId);

  // Opportunistic teacherIds cache repair while any school is legacy/dual
  if (scope.subjectIds.length > 0 && scopeMode !== "assignment") {
    await Subject.updateMany(
      { _id: { $in: scope.subjectIds }, schoolId },
      { $addToSet: { teacherIds: scope.teacherId } }
    );
  }

  // Subjects from scope.subjectIds only — do not also require yearIds/classIds membership
  // on the subject document (over-filtering hid assigned subjects in Academic Management).
  if (college) {
    const subjectFilter: Record<string, unknown> = {
      schoolId,
      _id: { $in: scope.subjectIds.length ? scope.subjectIds : ["__none__"] }
    };
    const batchFilter: Record<string, unknown> = {
      schoolId,
      ...(scope.batchIds.length ? { _id: { $in: scope.batchIds } } : { _id: { $in: [] } })
    };
    const yearFilter: Record<string, unknown> = {
      schoolId,
      ...(scope.yearIds.length ? { _id: { $in: scope.yearIds } } : { _id: { $in: [] } })
    };
    if (scope.batchIds.length) {
      yearFilter.batchId = { $in: scope.batchIds };
    }

    const [subjects, batches, years, students] = await Promise.all([
      Subject.find(subjectFilter).sort({ name: 1 }),
      Batch.find(batchFilter).sort({ name: 1 }),
      Year.find(yearFilter).sort({ level: 1 }),
      Student.find({
        schoolId,
        ...(scope.batchIds.length ? { batchId: { $in: scope.batchIds } } : { batchId: { $in: [] } }),
        ...(scope.yearIds.length ? { yearId: { $in: scope.yearIds } } : { yearId: { $in: [] } })
      })
        .populate("user", "-password")
        .sort({ rollNumber: 1 })
    ]);

    // If years are empty but subjects have yearIds, still return those years so the UI tree builds
    let yearsOut = years;
    if (yearsOut.length === 0 && subjects.length > 0) {
      const yearIdSet = new Set<string>();
      for (const s of subjects) {
        for (const yid of s.yearIds ?? []) yearIdSet.add(yid.toString());
      }
      for (const a of scope.assignments) {
        if (a.yearId) yearIdSet.add(a.yearId);
      }
      if (yearIdSet.size > 0) {
        yearsOut = await Year.find({ schoolId, _id: { $in: [...yearIdSet] } }).sort({ level: 1 });
      }
    }

    let batchesOut = batches;
    if (batchesOut.length === 0 && yearsOut.length > 0) {
      const batchIds = [...new Set(yearsOut.map((y) => y.batchId?.toString()).filter(Boolean))];
      if (batchIds.length > 0) {
        batchesOut = await Batch.find({ schoolId, _id: { $in: batchIds } }).sort({ name: 1 });
      }
    }

    return sendSuccess(res, "Teacher scope fetched", {
      scope,
      subjects,
      batches: batchesOut,
      years: yearsOut,
      students: students.filter((student) => Boolean(student.user)),
      classes: [],
      sections: []
    });
  }

  const [subjects, classes, sections, students] = await Promise.all([
    Subject.find({
      schoolId,
      _id: { $in: scope.subjectIds.length ? scope.subjectIds : ["__none__"] }
    }).sort({ name: 1 }),
    SchoolClass.find({
      schoolId,
      ...(scope.classIds.length ? { _id: { $in: scope.classIds } } : { _id: { $in: [] } })
    }).sort({ name: 1 }),
    Section.find({
      schoolId,
      ...(scope.sectionIds.length ? { _id: { $in: scope.sectionIds } } : { _id: { $in: [] } })
    }).sort({ name: 1 }),
    Student.find({
      schoolId,
      ...(scope.classIds.length ? { classId: { $in: scope.classIds } } : { classId: { $in: [] } }),
      ...(scope.sectionIds.length ? { sectionId: { $in: scope.sectionIds } } : { sectionId: { $in: [] } })
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
    students: students.filter((student) => Boolean(student.user))
  });
});

/**
 * Lightweight flag for teacher sidebar / route guards.
 * hasLaboratoryAccess = true only when admin assigned ACTIVE lab row(s)
 * or legacy in-charge exists.
 */
export const getTeacherLabAccess = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role !== "TEACHER") {
    throw new ApiError(403, "Only teachers can access laboratory assignment status");
  }

  const access = await resolveLabAccess(req);
  const assignedLabIds = access.assignedLabIds;
  return sendSuccess(res, "Teacher laboratory access fetched", {
    hasLaboratoryAccess: assignedLabIds.length > 0,
    assignedLabIds,
    laboratoryCount: assignedLabIds.length
  });
});
