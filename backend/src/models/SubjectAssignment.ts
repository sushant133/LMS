import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { SUBJECT_ASSIGNMENT_STATUSES, SUBJECT_ASSIGNMENT_TYPES } from "@phit-erp/shared";

const subjectAssignmentSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    academicYearBs: { type: String, required: true, trim: true },

    faculty: { type: String, default: null },
    semesterBs: { type: String, default: null },

    // SCHOOL keys
    classId: { type: Schema.Types.ObjectId, ref: "SchoolClass", default: null },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", default: null },

    // COLLEGE keys
    batchId: { type: Schema.Types.ObjectId, ref: "Batch", default: null },
    yearId: { type: Schema.Types.ObjectId, ref: "Year", default: null },

    subjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "Teacher", required: true },

    assignmentType: {
      type: String,
      enum: SUBJECT_ASSIGNMENT_TYPES,
      required: true
    },

    unitFrom: { type: Number, default: null, min: 1 },
    unitTo: { type: Number, default: null, min: 1 },
    assignedPercentage: { type: Number, default: null, min: 1, max: 99 },

    effectiveFromBs: { type: String, required: true },
    effectiveToBs: { type: String, default: null },

    status: {
      type: String,
      enum: SUBJECT_ASSIGNMENT_STATUSES,
      default: "ACTIVE",
      required: true,
      index: true
    },
    remarks: { type: String, default: "" },

    supersedesAssignmentId: { type: Schema.Types.ObjectId, ref: "SubjectAssignment", default: null },
    supersededByAssignmentId: { type: Schema.Types.ObjectId, ref: "SubjectAssignment", default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    endedBy: { type: Schema.Types.ObjectId, ref: "User" },
    endReason: { type: String }
  },
  { timestamps: true }
);

// Prevent same teacher from two ACTIVE rows for same subject+group+AY
subjectAssignmentSchema.index(
  {
    schoolId: 1,
    academicYearBs: 1,
    subjectId: 1,
    teacherId: 1,
    classId: 1,
    sectionId: 1,
    batchId: 1,
    yearId: 1,
    status: 1
  },
  {
    unique: true,
    partialFilterExpression: { status: "ACTIVE" },
    name: "uniq_active_teacher_subject_group_year"
  }
);

// Validation / set load paths
subjectAssignmentSchema.index({
  schoolId: 1,
  academicYearBs: 1,
  subjectId: 1,
  classId: 1,
  sectionId: 1,
  status: 1
});
subjectAssignmentSchema.index({
  schoolId: 1,
  academicYearBs: 1,
  subjectId: 1,
  batchId: 1,
  yearId: 1,
  status: 1
});

// Teacher LMS / getTeacherScope
subjectAssignmentSchema.index({ schoolId: 1, teacherId: 1, status: 1, academicYearBs: 1 });

// Reports
subjectAssignmentSchema.index({ schoolId: 1, academicYearBs: 1, status: 1 });

/**
 * Normalize unused mode/type fields to explicit null so compound unique indexes
 * treat school/college rows consistently.
 */
subjectAssignmentSchema.pre("validate", function normalizeGroupAndTypeKeys() {
  const hasSchoolKeys = Boolean(this.get("classId") || this.get("sectionId"));
  const hasCollegeKeys = Boolean(this.get("batchId") || this.get("yearId"));

  if (hasSchoolKeys && !hasCollegeKeys) {
    this.set("batchId", null);
    this.set("yearId", null);
  } else if (hasCollegeKeys && !hasSchoolKeys) {
    this.set("classId", null);
    this.set("sectionId", null);
  }

  if (this.get("assignmentType") !== "UNIT") {
    this.set("unitFrom", null);
    this.set("unitTo", null);
  }
  if (this.get("assignmentType") !== "PERCENTAGE") {
    this.set("assignedPercentage", null);
  }

  const faculty = this.get("faculty");
  if (faculty === undefined || faculty === "") {
    this.set("faculty", null);
  }
  const semesterBs = this.get("semesterBs");
  if (semesterBs === undefined || semesterBs === "") {
    this.set("semesterBs", null);
  }
});

export type SubjectAssignmentDocument = InferSchemaType<typeof subjectAssignmentSchema>;
export const SubjectAssignment = mongoose.model("SubjectAssignment", subjectAssignmentSchema);
