import mongoose, { Schema, type InferSchemaType } from "mongoose";

const resultSubmissionSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    subjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true },
    classId: { type: Schema.Types.ObjectId, ref: "SchoolClass" },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section" },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch" },
    yearId: { type: Schema.Types.ObjectId, ref: "Year" },
    status: {
      type: String,
      enum: [
        "DRAFT",
        "SUBMITTED_FOR_REVIEW",
        "PENDING_ADMIN_REVIEW",
        "RETURNED_FOR_CORRECTION",
        "APPROVED",
        "PUBLISHED"
      ],
      default: "DRAFT"
    },
    enteredByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    submittedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    submittedAt: { type: Date },
    reviewedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    reviewComments: { type: String, trim: true },
    approvedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },
    publishedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    publishedAt: { type: Date }
  },
  { timestamps: true }
);

resultSubmissionSchema.index(
  { schoolId: 1, examId: 1, subjectId: 1, batchId: 1, yearId: 1 },
  { unique: true, partialFilterExpression: { batchId: { $exists: true }, yearId: { $exists: true } } }
);

resultSubmissionSchema.index(
  { schoolId: 1, examId: 1, subjectId: 1, classId: 1, sectionId: 1 },
  { unique: true, partialFilterExpression: { classId: { $exists: true }, sectionId: { $exists: true } } }
);

resultSubmissionSchema.index({ schoolId: 1, status: 1, examId: 1 });

export type ResultSubmissionDocument = InferSchemaType<typeof resultSubmissionSchema>;
export const ResultSubmission = mongoose.model("ResultSubmission", resultSubmissionSchema);