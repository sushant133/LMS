import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { LIBRARY_YEAR_LEVELS } from "@phit-erp/shared";

/** Book master (shared bibliographic data for a title). */
const libraryBookSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    title: { type: String, required: true, trim: true },
    author: { type: String, required: true, trim: true },
    isbn: { type: String, trim: true },
    category: { type: String, required: true, trim: true },
    /**
     * Academic year level for HA college catalog (1st / 2nd / 3rd Year, or All Years).
     * Helps librarians filter and manage books by year.
     */
    yearLevel: {
      type: String,
      enum: LIBRARY_YEAR_LEVELS,
      default: "All Years",
      index: true
    },
    /** Denormalized from physical copies — kept in sync for dashboards & legacy. */
    totalCopies: { type: Number, required: true, min: 1 },
    availableCopies: { type: Number, required: true, min: 0 },
    shelfLocation: { type: String }
  },
  { timestamps: true }
);

libraryBookSchema.index({ schoolId: 1, yearLevel: 1 });
libraryBookSchema.index({ schoolId: 1, category: 1 });

export type LibraryBookDocument = InferSchemaType<typeof libraryBookSchema>;
export const LibraryBook = mongoose.model("LibraryBook", libraryBookSchema);

/**
 * One physical volume = one record.
 * Librarian enters bookCode manually (e.g. ANA001). Unique per school.
 */
const libraryBookCopySchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    bookId: { type: Schema.Types.ObjectId, ref: "LibraryBook", required: true, index: true },
    bookCode: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["AVAILABLE", "ISSUED", "LOST", "DAMAGED", "MAINTENANCE"],
      default: "AVAILABLE",
      index: true
    },
    shelfLocation: { type: String, trim: true },
    condition: { type: String, trim: true }
  },
  { timestamps: true }
);

libraryBookCopySchema.index({ schoolId: 1, bookCode: 1 }, { unique: true });
libraryBookCopySchema.index({ schoolId: 1, bookId: 1, status: 1 });

export type LibraryBookCopyDocument = InferSchemaType<typeof libraryBookCopySchema>;
export const LibraryBookCopy = mongoose.model("LibraryBookCopy", libraryBookCopySchema);

const libraryIssueSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    bookId: { type: Schema.Types.ObjectId, ref: "LibraryBook", required: true },
    /** Physical copy issued (required for new issues when copies exist). */
    copyId: { type: Schema.Types.ObjectId, ref: "LibraryBookCopy" },
    /** Snapshot of code at issue time for history/display. */
    bookCode: { type: String, trim: true },
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

libraryIssueSchema.index({ schoolId: 1, status: 1 });
libraryIssueSchema.index({ schoolId: 1, copyId: 1, status: 1 });
libraryIssueSchema.index({ schoolId: 1, studentId: 1, status: 1 });

export type LibraryIssueDocument = InferSchemaType<typeof libraryIssueSchema>;
export const LibraryIssue = mongoose.model("LibraryIssue", libraryIssueSchema);