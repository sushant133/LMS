import type { Request, Response } from "express";
import { COLLEGE_YEAR_NAMES, academicSubjectSchema, batchSchema, classSchema, sectionSchema } from "@nepal-school-erp/shared";
import { Batch } from "../models/Batch.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { Subject } from "../models/Subject.js";
import { Teacher } from "../models/Teacher.js";
import { Year } from "../models/Year.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { getInstitutionType, isCollege, requireCollegeInstitution, requireSchoolInstitution } from "../utils/institution.js";
import { getStudentProfile } from "../utils/studentScope.js";
import { getTeacherScope } from "../utils/teacherScope.js";
import { sendSuccess } from "../utils/response.js";
import { tenantObjectId, withTenantScope } from "../utils/tenant.js";

export const listClasses = asyncHandler(async (req: Request, res: Response) => {
  const filter = withTenantScope(req);
  const teacherScope = await getTeacherScope(req);

  if (teacherScope) {
    Object.assign(filter, { _id: { $in: teacherScope.classIds } });
  }

  const studentProfile = await getStudentProfile(req);
  if (studentProfile) {
    Object.assign(filter, { _id: studentProfile.classId });
  }

  const classes = await SchoolClass.find(filter).sort({ level: 1, name: 1 });
  return sendSuccess(res, "Classes fetched", classes);
});

export const createClass = asyncHandler(async (req: Request, res: Response) => {
  await requireSchoolInstitution(req);
  const payload = classSchema.parse(req.body);
  const schoolClass = await SchoolClass.create({
    ...payload,
    schoolId: tenantObjectId(req),
    coordinatorId: payload.coordinatorId || undefined
  });
  return sendSuccess(res, "Class created successfully", schoolClass, 201);
});

export const updateClass = asyncHandler(async (req: Request, res: Response) => {
  const payload = classSchema.parse(req.body);
  const schoolClass = await SchoolClass.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id }),
    {
      ...payload,
      coordinatorId: payload.coordinatorId || undefined
    },
    { new: true }
  );

  if (!schoolClass) {
    throw new ApiError(404, "Class not found");
  }

  return sendSuccess(res, "Class updated successfully", schoolClass);
});

export const deleteClass = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const schoolClass = await SchoolClass.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));

  if (!schoolClass) {
    throw new ApiError(404, "Class not found");
  }

  await Section.deleteMany({ classId: schoolClass._id, schoolId });

  return sendSuccess(res, "Class deleted successfully");
});

export const listSections = asyncHandler(async (req: Request, res: Response) => {
  const query: Record<string, unknown> = withTenantScope(req);

  if (typeof req.query.classId === "string") {
    query.classId = req.query.classId;
  }

  const teacherScope = await getTeacherScope(req);
  if (teacherScope) {
    query._id = { $in: teacherScope.sectionIds };
    if (typeof req.query.classId === "string") {
      query.classId = req.query.classId;
    }
  }

  const studentProfile = await getStudentProfile(req);
  if (studentProfile) {
    query._id = studentProfile.sectionId;
    query.classId = studentProfile.classId;
  }

  const sections = await Section.find(query).sort({ name: 1 });
  return sendSuccess(res, "Sections fetched", sections);
});

export const createSection = asyncHandler(async (req: Request, res: Response) => {
  await requireSchoolInstitution(req);
  const payload = sectionSchema.parse(req.body);
  const schoolId = tenantObjectId(req);
  const schoolClass = await SchoolClass.findOne({ _id: payload.classId, schoolId });

  if (!schoolClass) {
    throw new ApiError(404, "Selected class was not found in this college");
  }

  const section = await Section.create({
    ...payload,
    schoolId,
    classTeacherId: payload.classTeacherId || undefined
  });
  return sendSuccess(res, "Section created successfully", section, 201);
});

export const updateSection = asyncHandler(async (req: Request, res: Response) => {
  const payload = sectionSchema.parse(req.body);
  const schoolId = tenantObjectId(req);
  const schoolClass = await SchoolClass.findOne({ _id: payload.classId, schoolId });

  if (!schoolClass) {
    throw new ApiError(404, "Selected class was not found in this college");
  }

  const section = await Section.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id }),
    {
      ...payload,
      classTeacherId: payload.classTeacherId || undefined
    },
    { new: true }
  );

  if (!section) {
    throw new ApiError(404, "Section not found");
  }

  return sendSuccess(res, "Section updated successfully", section);
});

export const deleteSection = asyncHandler(async (req: Request, res: Response) => {
  const section = await Section.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));

  if (!section) {
    throw new ApiError(404, "Section not found");
  }

  return sendSuccess(res, "Section deleted successfully");
});

export const listSubjects = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = withTenantScope(req);
  const teacherScope = await getTeacherScope(req);

  if (teacherScope) {
    filter._id = { $in: teacherScope.subjectIds };
    filter.teacherIds = teacherScope.teacherId;
  }

  const studentProfile = await getStudentProfile(req);
  if (studentProfile) {
    const institutionType = await getInstitutionType(req);
    if (isCollege(institutionType) && studentProfile.yearId) {
      filter.yearIds = studentProfile.yearId;
    } else if (studentProfile.classId) {
      filter.classIds = studentProfile.classId;
    }
  }

  if (typeof req.query.yearId === "string") {
    filter.yearIds = req.query.yearId;
  }

  const subjects = await Subject.find(filter).sort({ name: 1 });
  return sendSuccess(res, "Subjects fetched", subjects);
});

const removeSubjectFromTeachers = async (
  schoolId: ReturnType<typeof tenantObjectId>,
  subjectId: string
): Promise<void> => {
  await Teacher.updateMany({ schoolId, subjects: subjectId }, { $pull: { subjects: subjectId } });
  await Subject.updateOne({ _id: subjectId, schoolId }, { $set: { teacherIds: [] } });
};

export const createSubject = asyncHandler(async (req: Request, res: Response) => {
  const payload = academicSubjectSchema.parse(req.body);
  const schoolId = tenantObjectId(req);
  const institutionType = await getInstitutionType(req);

  if (isCollege(institutionType)) {
    if (!payload.yearIds?.length) {
      throw new ApiError(400, "At least one year must be selected for college subjects");
    }
    if (payload.classIds?.length) {
      throw new ApiError(400, "Class assignment is not used for college institutions");
    }
  } else if (!payload.classIds?.length) {
    throw new ApiError(400, "At least one class must be selected for class & section subjects");
  }

  const subject = await Subject.create({
    name: payload.name,
    code: payload.code,
    schoolId,
    classIds: isCollege(institutionType) ? [] : payload.classIds,
    yearIds: isCollege(institutionType) ? payload.yearIds : [],
    teacherIds: [],
    fullMarks: 100,
    passMarks: 35
  });

  return sendSuccess(res, "Subject created successfully", subject, 201);
});

export const updateSubject = asyncHandler(async (req: Request, res: Response) => {
  const payload = academicSubjectSchema.parse(req.body);
  const institutionType = await getInstitutionType(req);

  if (isCollege(institutionType)) {
    if (!payload.yearIds?.length) {
      throw new ApiError(400, "At least one year must be selected for college subjects");
    }
  } else if (!payload.classIds?.length) {
    throw new ApiError(400, "At least one class must be selected for class & section subjects");
  }

  const subject = await Subject.findOneAndUpdate(
    withTenantScope(req, { _id: req.params.id }),
    {
      name: payload.name,
      code: payload.code,
      classIds: isCollege(institutionType) ? [] : payload.classIds,
      yearIds: isCollege(institutionType) ? payload.yearIds : []
    },
    { new: true }
  );

  if (!subject) {
    throw new ApiError(404, "Subject not found");
  }

  return sendSuccess(res, "Subject updated successfully", subject);
});

export const deleteSubject = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = tenantObjectId(req);
  const subject = await Subject.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));

  if (!subject) {
    throw new ApiError(404, "Subject not found");
  }

  await removeSubjectFromTeachers(schoolId, subject._id.toString());

  return sendSuccess(res, "Subject deleted successfully");
});

export const listBatches = asyncHandler(async (req: Request, res: Response) => {
  const filter = withTenantScope(req);
  const teacherScope = await getTeacherScope(req);

  if (teacherScope) {
    Object.assign(filter, { _id: { $in: teacherScope.batchIds } });
  }

  const studentProfile = await getStudentProfile(req);
  if (studentProfile?.batchId) {
    Object.assign(filter, { _id: studentProfile.batchId });
  }

  const batches = await Batch.find(filter).sort({ name: 1 });
  return sendSuccess(res, "Batches fetched", batches);
});

export const createBatch = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const payload = batchSchema.parse(req.body);
  const schoolId = tenantObjectId(req);

  const batch = await Batch.create({
    ...payload,
    schoolId
  });

  await Year.insertMany(
    COLLEGE_YEAR_NAMES.map((name, index) => ({
      schoolId,
      batchId: batch._id,
      name,
      level: index + 1,
      isActive: true
    }))
  );

  return sendSuccess(res, "Batch created successfully", batch, 201);
});

export const updateBatch = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const payload = batchSchema.parse(req.body);
  const batch = await Batch.findOneAndUpdate(withTenantScope(req, { _id: req.params.id }), payload, { new: true });

  if (!batch) {
    throw new ApiError(404, "Batch not found");
  }

  return sendSuccess(res, "Batch updated successfully", batch);
});

export const deleteBatch = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const schoolId = tenantObjectId(req);
  const batch = await Batch.findOneAndDelete(withTenantScope(req, { _id: req.params.id }));

  if (!batch) {
    throw new ApiError(404, "Batch not found");
  }

  await Year.deleteMany({ batchId: batch._id, schoolId });

  return sendSuccess(res, "Batch deleted successfully");
});

export const listYears = asyncHandler(async (req: Request, res: Response) => {
  const query: Record<string, unknown> = withTenantScope(req);

  if (typeof req.query.batchId === "string") {
    query.batchId = req.query.batchId;
  }

  const teacherScope = await getTeacherScope(req);
  if (teacherScope) {
    query._id = { $in: teacherScope.yearIds };
    if (typeof req.query.batchId === "string") {
      query.batchId = req.query.batchId;
    }
  }

  const studentProfile = await getStudentProfile(req);
  if (studentProfile?.yearId) {
    query._id = studentProfile.yearId;
    if (studentProfile.batchId) {
      query.batchId = studentProfile.batchId;
    }
  }

  const years = await Year.find(query).sort({ level: 1 });
  return sendSuccess(res, "Years fetched", years);
});