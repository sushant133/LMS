import type { ParentFromStudentRelationship } from "@phit-erp/shared";
import { User } from "../models/User.js";

interface StudentParentFields {
  admissionNumber: string;
  fatherName: string;
  fatherPhone?: string | null;
  motherName: string;
  motherPhone?: string | null;
  guardianName: string;
  guardianPhone: string;
}

export const getParentContactFromStudent = (
  student: StudentParentFields,
  relationship: ParentFromStudentRelationship
): { fullName: string; phone: string } => {
  if (relationship === "FATHER") {
    return { fullName: student.fatherName, phone: student.fatherPhone?.trim() ?? "" };
  }

  if (relationship === "MOTHER") {
    return { fullName: student.motherName, phone: student.motherPhone?.trim() ?? "" };
  }

  return { fullName: student.guardianName, phone: student.guardianPhone.trim() };
};

const sanitizeLoginIdPart = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

export const buildSuggestedParentLoginId = (
  admissionNumber: string,
  relationship: ParentFromStudentRelationship
): string => `${sanitizeLoginIdPart(admissionNumber)}-${relationship.toLowerCase()}`;

export const resolveUniqueParentLoginId = async (baseLoginId: string): Promise<string> => {
  const normalizedBase = baseLoginId.toLowerCase().trim();
  const existing = await User.findOne({ email: normalizedBase }).select("_id").lean();
  if (!existing) {
    return normalizedBase;
  }

  for (let suffix = 2; suffix <= 99; suffix += 1) {
    const candidate = `${normalizedBase}-${suffix}`;
    const duplicate = await User.findOne({ email: candidate }).select("_id").lean();
    if (!duplicate) {
      return candidate;
    }
  }

  return `${normalizedBase}-${Date.now().toString(36)}`;
};