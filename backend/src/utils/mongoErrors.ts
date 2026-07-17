import { ApiError } from "./apiError.js";

const duplicateKeyMessage = (keyValue: Record<string, unknown> | undefined): string => {
  if (!keyValue) {
    return "A record with these details already exists";
  }

  if (keyValue.rollNumber !== undefined) {
    return "A student with this roll number already exists in the selected class or batch";
  }

  if (keyValue.admissionNumber !== undefined) {
    return "A student with this admission number already exists";
  }

  if (keyValue.teacherCode !== undefined) {
    return "A teacher with this code already exists";
  }

  if (keyValue.staffId !== undefined) {
    return "A staff member with this ID already exists";
  }

  if (keyValue.email !== undefined) {
    return "A user with this login ID already exists";
  }

  if (
    keyValue.subjectId !== undefined &&
    keyValue.teacherId !== undefined &&
    keyValue.academicYearBs !== undefined
  ) {
    return "A session plan already exists for this subject, teacher, and academic year. Open it from the list and edit instead.";
  }

  if (keyValue.subjectId !== undefined && (keyValue.yearId !== undefined || keyValue.classId !== undefined)) {
    return "A syllabus for this subject and year/class already exists. Open it from the list and edit instead of creating a new one.";
  }

  if (keyValue.subjectId !== undefined) {
    return "A syllabus for this subject already exists. Open it from the list and edit instead.";
  }

  return "A record with these details already exists";
};

export const throwIfDuplicateKey = (error: unknown): void => {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== 11000) {
    return;
  }

  const keyValue = (error as { keyValue?: Record<string, unknown> }).keyValue;
  throw new ApiError(409, duplicateKeyMessage(keyValue));
};