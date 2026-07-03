import type { Request } from "express";
import { Student } from "../models/Student.js";
import { Subject } from "../models/Subject.js";
import { ApiError } from "./apiError.js";
import { getInstitutionType, isCollege } from "./institution.js";
import { tenantObjectId } from "./tenant.js";

export interface StudentProfile {
  studentId: string;
  classId?: string;
  sectionId?: string;
  batchId?: string;
  yearId?: string;
}

export const getStudentProfile = async (req: Request): Promise<StudentProfile | null> => {
  if (!req.user || req.user.role !== "STUDENT") {
    return null;
  }

  const student = await Student.findOne({
    schoolId: tenantObjectId(req),
    user: req.user.userId
  }).lean();

  if (!student) {
    return null;
  }

  return {
    studentId: student._id.toString(),
    classId: student.classId?.toString(),
    sectionId: student.sectionId?.toString(),
    batchId: student.batchId?.toString(),
    yearId: student.yearId?.toString()
  };
};

export const requireStudentProfile = async (req: Request): Promise<StudentProfile> => {
  const profile = await getStudentProfile(req);
  if (!profile) {
    throw new ApiError(403, "Student profile not found for this account");
  }
  return profile;
};

export const getEnrolledSubjects = async (req: Request) => {
  const profile = await requireStudentProfile(req);
  const institutionType = await getInstitutionType(req);

  const filter: Record<string, unknown> = {
    schoolId: tenantObjectId(req)
  };

  if (isCollege(institutionType)) {
    if (!profile.yearId) {
      throw new ApiError(400, "Student year is not configured");
    }
    filter.yearIds = profile.yearId;
  } else {
    if (!profile.classId) {
      throw new ApiError(400, "Student class is not configured");
    }
    filter.classIds = profile.classId;
  }

  return Subject.find(filter).populate("teacherIds").sort({ name: 1 }).lean();
};

export const assertStudentSubjectAccess = async (req: Request, subjectId: string) => {
  const profile = await requireStudentProfile(req);
  const institutionType = await getInstitutionType(req);

  const filter: Record<string, unknown> = {
    _id: subjectId,
    schoolId: tenantObjectId(req)
  };

  if (isCollege(institutionType)) {
    if (!profile.yearId) {
      throw new ApiError(400, "Student year is not configured");
    }
    filter.yearIds = profile.yearId;
  } else {
    if (!profile.classId) {
      throw new ApiError(400, "Student class is not configured");
    }
    filter.classIds = profile.classId;
  }

  const subject = await Subject.findOne(filter).lean();

  if (!subject) {
    throw new ApiError(403, "You are not enrolled in this subject");
  }

  return { profile, subject };
};

export const assertStudentOwnRecord = async (req: Request, studentId: string): Promise<void> => {
  if (req.user?.role !== "STUDENT") {
    return;
  }

  const profile = await requireStudentProfile(req);
  if (profile.studentId !== studentId) {
    throw new ApiError(403, "You can only access your own records");
  }
};