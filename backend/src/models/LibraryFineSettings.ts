import mongoose, { Schema, type InferSchemaType } from "mongoose";

/**
 * Library overdue fine rules for one college (Administrator only).
 *
 * A student's overdue book is charged `finePerDayNpr` for each day after the
 * due date (after any grace days) until it is returned, capped per book when
 * `maxFinePerBookNpr` > 0. Rate used for a student, most specific first:
 * their own rate (`studentRates`, 0 = exempt) → their batch + year rate →
 * their batch's all-years rate (`groupRates`) → the college-wide rate.
 */
const studentFineRateSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    finePerDayNpr: { type: Number, required: true, min: 0 },
    note: { type: String, trim: true, maxlength: 300, default: "" },
    setByName: { type: String, default: "" },
    setAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

/** Daily fine for a batch (all its years) or one year of a batch. */
const groupFineRateSchema = new Schema(
  {
    batchId: { type: Schema.Types.ObjectId, ref: "Batch", required: true },
    /** Empty = every year of the batch. */
    yearId: { type: Schema.Types.ObjectId, ref: "Year", default: null },
    finePerDayNpr: { type: Number, required: true, min: 0 },
    note: { type: String, trim: true, maxlength: 300, default: "" },
    setByName: { type: String, default: "" },
    setAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const libraryFineSettingsSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, unique: true },
    /** Off → no fines accrue (existing recorded fines stay). */
    enabled: { type: Boolean, default: false },
    /** College-wide daily fine for every student (NPR). */
    finePerDayNpr: { type: Number, default: 0, min: 0 },
    /** Days after the due date that are free before charging starts. */
    graceDays: { type: Number, default: 0, min: 0, max: 60 },
    /** Most one book can be fined (NPR); 0 = no limit. */
    maxFinePerBookNpr: { type: Number, default: 0, min: 0 },
    /**
     * Optional BS date: charge no day before this one (so switching fines on
     * does not bill months of old overdue days). Empty = from the due date.
     */
    chargeFromBs: { type: String, default: "" },
    studentRates: { type: [studentFineRateSchema], default: [] },
    /** Batch / batch-year rates; a student's own rate still wins over these. */
    groupRates: { type: [groupFineRateSchema], default: [] },
    updatedByName: { type: String, default: "" }
  },
  { timestamps: true }
);

export type LibraryFineSettingsDocument = InferSchemaType<typeof libraryFineSettingsSchema>;
export const LibraryFineSettings = mongoose.model(
  "LibraryFineSettings",
  libraryFineSettingsSchema
);
