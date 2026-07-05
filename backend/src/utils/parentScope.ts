import type { Request } from "express";
import { ParentChildLink } from "../models/ParentChildLink.js";
import { Student } from "../models/Student.js";
import { ApiError } from "./apiError.js";
import { tenantObjectId, withTenantScope } from "./tenant.js";

export const getLinkedStudentIds = async (req: Request): Promise<string[]> => {
  if (!req.user?.userId) {
    throw new ApiError(401, "Authentication required");
  }

  const schoolId = tenantObjectId(req);
  const links = await ParentChildLink.find({
    schoolId,
    parentUserId: req.user.userId,
    status: "APPROVED"
  }).lean();
  return links.map((link) => link.studentId.toString());
};

export const assertParentAccessToStudent = async (req: Request, studentId: string): Promise<void> => {
  if (req.user?.role !== "PARENT") {
    return;
  }

  const linkedIds = await getLinkedStudentIds(req);
  if (!linkedIds.includes(studentId)) {
    throw new ApiError(403, "You do not have access to this student record");
  }
};

export const getStudentScopeFilter = async (req: Request): Promise<Record<string, unknown>> => {
  const base = withTenantScope(req);

  if (req.user?.role === "PARENT") {
    const studentIds = await getLinkedStudentIds(req);
    return { ...base, _id: { $in: studentIds } };
  }

  if (req.user?.role === "STUDENT") {
    const student = await Student.findOne({ schoolId: tenantObjectId(req), user: req.user.userId }).lean();
    if (!student) {
      return { ...base, _id: { $in: [] } };
    }
    return { ...base, _id: student._id.toString() };
  }

  return base;
};