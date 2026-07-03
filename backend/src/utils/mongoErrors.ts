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

  if (keyValue.email !== undefined) {
    return "A user with this login ID already exists";
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