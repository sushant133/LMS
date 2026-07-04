import mongoose, { Schema, type InferSchemaType } from "mongoose";

const subjectSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    masterSubjectId: { type: Schema.Types.ObjectId, ref: "MasterSubject" },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true },
    classIds: [{ type: Schema.Types.ObjectId, ref: "SchoolClass" }],
    yearIds: [{ type: Schema.Types.ObjectId, ref: "Year" }],
    teacherIds: [{ type: Schema.Types.ObjectId, ref: "Teacher" }],
    creditHours: { type: Number, min: 0 },
    theoryMarks: { type: Number, min: 0 },
    practicalMarks: { type: Number, min: 0 },
    internalMarks: { type: Number, min: 0 },
    fullMarks: { type: Number, required: true },
    passMarks: { type: Number, required: true },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

// School-mode subjects: unique code per school (identified by assigned classes).
// MongoDB partial indexes do not support { $exists: false }.
subjectSchema.index(
  { schoolId: 1, code: 1 },
  { unique: true, partialFilterExpression: { "classIds.0": { $exists: true } } }
);
// College master-curriculum instances: one provisioned subject per master + batch year.
subjectSchema.index(
  { schoolId: 1, masterSubjectId: 1, yearIds: 1 },
  { unique: true, partialFilterExpression: { masterSubjectId: { $type: "objectId" } } }
);

export type SubjectDocument = InferSchemaType<typeof subjectSchema>;
export const Subject = mongoose.model("Subject", subjectSchema);
