import type { InstitutionType } from "@phit-erp/shared";
import type mongoose from "mongoose";
import { Batch } from "../models/Batch.js";
import { SchoolClass } from "../models/SchoolClass.js";
import { Section } from "../models/Section.js";
import { Year } from "../models/Year.js";
import { ApiError } from "./apiError.js";
import { isCollege } from "./institution.js";

export const validateSchoolStudentScope = async (
  schoolId: mongoose.Types.ObjectId,
  classId: string,
  sectionId: string
): Promise<void> => {
  const [schoolClass, section] = await Promise.all([
    SchoolClass.findOne({ _id: classId, schoolId }),
    Section.findOne({ _id: sectionId, classId, schoolId })
  ]);

  if (!schoolClass) {
    throw new ApiError(404, "Selected class was not found in this college");
  }

  if (!section) {
    throw new ApiError(404, "Selected section was not found in this college");
  }
};

export const validateCollegeStudentScope = async (
  schoolId: mongoose.Types.ObjectId,
  batchId: string,
  yearId: string
): Promise<void> => {
  const [batch, year] = await Promise.all([
    Batch.findOne({ _id: batchId, schoolId }),
    Year.findOne({ _id: yearId, batchId, schoolId })
  ]);

  if (!batch) {
    throw new ApiError(404, "Selected batch was not found in this institution");
  }

  if (!year) {
    throw new ApiError(404, "Selected year was not found in this batch");
  }
};

export const validateStudentAdmissionScope = async (
  institutionType: InstitutionType,
  schoolId: mongoose.Types.ObjectId,
  payload: {
    classId?: string;
    sectionId?: string;
    batchId?: string;
    yearId?: string;
  }
): Promise<void> => {
  if (isCollege(institutionType)) {
    if (!payload.batchId || !payload.yearId) {
      throw new ApiError(400, "Batch and year are required for college institutions");
    }
    if (payload.classId || payload.sectionId) {
      throw new ApiError(400, "Class and section are not used for college institutions");
    }
    await validateCollegeStudentScope(schoolId, payload.batchId, payload.yearId);
    return;
  }

  if (!payload.classId || !payload.sectionId) {
    throw new ApiError(400, "Class and section are required for class & section programs");
  }
  if (payload.batchId || payload.yearId) {
    throw new ApiError(400, "Batch and year are not used for class & section programs");
  }
  await validateSchoolStudentScope(schoolId, payload.classId, payload.sectionId);
};

export const validateAttendanceScope = (
  institutionType: InstitutionType,
  payload: {
    classId?: string;
    sectionId?: string;
    batchId?: string;
    yearId?: string;
  }
): void => {
  if (isCollege(institutionType)) {
    if (!payload.batchId || !payload.yearId) {
      throw new ApiError(400, "Batch and year are required for college attendance");
    }
    return;
  }

  if (!payload.classId || !payload.sectionId) {
    throw new ApiError(400, "Class and section are required for class & section attendance");
  }
};

export const validateTimetableScope = (
  institutionType: InstitutionType,
  payload: {
    classId?: string;
    sectionId?: string;
    batchId?: string;
    yearId?: string;
  }
): void => {
  if (isCollege(institutionType)) {
    if (!payload.batchId || !payload.yearId) {
      throw new ApiError(400, "Batch and year are required for college timetables");
    }
    return;
  }

  if (!payload.classId || !payload.sectionId) {
    throw new ApiError(400, "Class and section are required for class & section timetables");
  }
};

export const validateCollegeTeacherScope = async (
  schoolId: mongoose.Types.ObjectId,
  batchIds: string[],
  yearIds: string[]
): Promise<void> => {
  if (batchIds.length > 0) {
    const batchesCount = await Batch.countDocuments({ _id: { $in: batchIds }, schoolId });
    if (batchesCount !== batchIds.length) {
      throw new ApiError(400, "One or more selected batches are invalid for this institution");
    }
  }

  if (yearIds.length > 0) {
    const years = await Year.find({ _id: { $in: yearIds }, schoolId }).lean();
    if (years.length !== yearIds.length) {
      throw new ApiError(400, "One or more selected years are invalid for this institution");
    }

    if (batchIds.length > 0) {
      const batchIdSet = new Set(batchIds);
      const invalidYear = years.find((year) => !batchIdSet.has(year.batchId.toString()));
      if (invalidYear) {
        throw new ApiError(400, "One or more selected years do not belong to the assigned batches");
      }
    }
  }
};

export const validateAssignmentScope = (
  institutionType: InstitutionType,
  payload: {
    classId?: string;
    sectionId?: string;
    batchId?: string;
    yearId?: string;
  }
): void => {
  validateTimetableScope(institutionType, payload);
};