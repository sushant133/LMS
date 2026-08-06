import type { Types } from "mongoose";
import { Student } from "../models/Student.js";
import { User } from "../models/User.js";
import { ApiError } from "./apiError.js";

type ObjectIdLike = Types.ObjectId | string;

const asIdString = (id: ObjectIdLike): string => String(id);

/**
 * True when the student has a linked User and that account may log in (isActive !== false).
 */
export const isStudentLoginActive = async (
  studentId: ObjectIdLike,
  schoolId: ObjectIdLike
): Promise<boolean> => {
  const student = await Student.findOne({
    _id: studentId,
    schoolId
  })
    .select("user")
    .lean();

  if (!student?.user) return false;

  const user = await User.findById(student.user).select("isActive").lean();
  if (!user) return false;
  return user.isActive !== false;
};

/**
 * Block library issue / fee collection / refunds when the student's portal
 * login has been disabled (User.isActive === false).
 */
export const assertStudentLoginActive = async (
  studentId: ObjectIdLike,
  schoolId: ObjectIdLike,
  actionLabel = "this action"
): Promise<void> => {
  const student = await Student.findOne({
    _id: studentId,
    schoolId
  })
    .select("user admissionNumber")
    .lean();

  if (!student) {
    throw new ApiError(404, "Student not found");
  }
  if (!student.user) {
    throw new ApiError(
      400,
      "This student has no login account. Enable access from Students list first."
    );
  }

  const user = await User.findById(student.user).select("isActive fullName").lean();
  if (!user) {
    throw new ApiError(400, "Student login account is missing");
  }
  if (user.isActive === false) {
    const who =
      (user.fullName || "").trim() ||
      student.admissionNumber ||
      asIdString(studentId);
    throw new ApiError(
      403,
      `Student access is disabled for ${who}. Enable access from Students list before ${actionLabel}.`
    );
  }
};

/**
 * Filter an array of students that already have populated `user` (or user.isActive).
 * Keeps only login-active accounts.
 */
export const filterLoginActiveStudents = <
  T extends { user?: { isActive?: boolean } | null | string | Types.ObjectId }
>(
  students: T[]
): T[] =>
  students.filter((s) => {
    const u = s.user;
    if (!u || typeof u !== "object" || u === null || !("isActive" in u)) {
      // Unpopulated or missing user → treat as not selectable for ops
      return false;
    }
    return (u as { isActive?: boolean }).isActive !== false;
  });
