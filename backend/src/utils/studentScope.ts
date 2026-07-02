import type { Request } from "express";
import { Student } from "../models/Student";
import { Subject } from "../models/Subject";
import { ApiError } from "./apiError";
import { tenantObjectId } from "./tenant";

export interface StudentProfile {
  studentId: string;
  classId: string;
  sectionId: string;
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
    classId: student.classId.toString(),
    sectionId: student.sectionId.toString()
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
  return Subject.find({
    schoolId: tenantObjectId(req),
    classIds: profile.classId
  })
    .populate("teacherIds")
    .sort({ name: 1 })
    .lean();
};

export const assertStudentSubjectAccess = async (req: Request, subjectId: string) => {
  const profile = await requireStudentProfile(req);
  const subject = await Subject.findOne({
    _id: subjectId,
    schoolId: tenantObjectId(req),
    classIds: profile.classId
  }).lean();

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