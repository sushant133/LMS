import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { ASSIGNMENT_TYPES, USER_ROLES } from "@phit-erp/shared";

const attachmentSchema = new Schema(
  {
    url: { type: String, required: true },
    name: { type: String, required: true },
    mimeType: { type: String },
    kind: { type: String, enum: ["FILE", "IMAGE", "PDF", "VIDEO", "LINK"] }
  },
  { _id: false }
);

const linkSchema = new Schema(
  {
    title: { type: String, required: true },
    url: { type: String, required: true }
  },
  { _id: false }
);

const assignmentSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    type: { type: String, enum: ASSIGNMENT_TYPES, required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    classId: { type: Schema.Types.ObjectId, ref: "SchoolClass" },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section" },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch" },
    yearId: { type: Schema.Types.ObjectId, ref: "Year" },
    subjectId: { type: Schema.Types.ObjectId, ref: "Subject" },
    teacherId: { type: Schema.Types.ObjectId, ref: "Teacher", required: true },
    topic: { type: String, trim: true },
    dueDateBs: { type: String },
    maxMarks: { type: Number, min: 0 },
    rubric: { type: String },
    visibleTo: { type: [String], enum: USER_ROLES, default: ["STUDENT", "PARENT"] },
    allowSubmission: { type: Boolean, default: true },
    isPinned: { type: Boolean, default: false },
    attachments: { type: [attachmentSchema], default: [] },
    links: { type: [linkSchema], default: [] }
  },
  { timestamps: true }
);

assignmentSchema.index({ schoolId: 1, subjectId: 1, topic: 1 });
assignmentSchema.index({ schoolId: 1, isPinned: -1, createdAt: -1 });

export type AssignmentDocument = InferSchemaType<typeof assignmentSchema>;
export const Assignment = mongoose.model("Assignment", assignmentSchema);

const submissionSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    assignmentId: { type: Schema.Types.ObjectId, ref: "Assignment", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    content: { type: String },
    attachmentUrl: { type: String },
    marks: { type: Number, min: 0 },
    feedback: { type: String },
    status: { type: String, enum: ["PENDING", "SUBMITTED", "GRADED"], default: "PENDING" },
    submittedAt: { type: Date }
  },
  { timestamps: true }
);

submissionSchema.index({ schoolId: 1, assignmentId: 1, studentId: 1 }, { unique: true });

export type AssignmentSubmissionDocument = InferSchemaType<typeof submissionSchema>;
export const AssignmentSubmission = mongoose.model("AssignmentSubmission", submissionSchema);