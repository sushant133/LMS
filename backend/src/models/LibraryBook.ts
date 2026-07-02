import mongoose, { Schema, type InferSchemaType } from "mongoose";

const libraryBookSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    title: { type: String, required: true, trim: true },
    author: { type: String, required: true, trim: true },
    isbn: { type: String, trim: true },
    category: { type: String, required: true, trim: true },
    totalCopies: { type: Number, required: true, min: 1 },
    availableCopies: { type: Number, required: true, min: 0 },
    shelfLocation: { type: String }
  },
  { timestamps: true }
);

export type LibraryBookDocument = InferSchemaType<typeof libraryBookSchema>;
export const LibraryBook = mongoose.model("LibraryBook", libraryBookSchema);

const libraryIssueSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    bookId: { type: Schema.Types.ObjectId, ref: "LibraryBook", required: true },
    borrowerType: { type: String, enum: ["STUDENT", "TEACHER"], default: "STUDENT" },
    studentId: { type: Schema.Types.ObjectId, ref: "Student" },
    teacherId: { type: Schema.Types.ObjectId, ref: "Teacher" },
    issuedDateBs: { type: String, required: true },
    dueDateBs: { type: String, required: true },
    returnedDateBs: { type: String },
    fineNpr: { type: Number, default: 0 },
    status: { type: String, enum: ["ISSUED", "RETURNED", "OVERDUE"], default: "ISSUED" }
  },
  { timestamps: true }
);

export type LibraryIssueDocument = InferSchemaType<typeof libraryIssueSchema>;
export const LibraryIssue = mongoose.model("LibraryIssue", libraryIssueSchema);