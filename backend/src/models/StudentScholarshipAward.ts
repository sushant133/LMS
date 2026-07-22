import mongoose, { Schema, type InferSchemaType } from "mongoose";

/**
 * HA (and multi-year) scholarship awards.
 * Typical rule: student tops Year N finals → full fee waiver for Year N+1.
 * If they do not top Year N+1 finals, Year N+2 is payable again.
 */
const studentScholarshipAwardSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    /** Year of the final exam they topped (1, 2, or 3). */
    toppedProgramYear: { type: Number, enum: [1, 2, 3], required: true },
    /** Program year whose fees are waived (usually topped + 1). */
    coversProgramYear: { type: Number, enum: [1, 2, 3], required: true },
    academicYearBs: { type: String, default: "" },
    examName: { type: String, default: "" },
    rank: { type: Number },
    waiverType: { type: String, enum: ["FULL", "PARTIAL"], default: "FULL" },
    /** Amount waived when PARTIAL; 0 means use full year fee when applied. */
    amountNpr: { type: Number, default: 0 },
    reason: {
      type: String,
      default: "Topper of previous year final examination — one year scholarship"
    },
    status: { type: String, enum: ["ACTIVE", "APPLIED", "REVOKED"], default: "ACTIVE", index: true },
    /** Linked fee collection that applied this scholarship (when fee was recorded). */
    feeCollectionId: { type: Schema.Types.ObjectId, ref: "FeeCollection" },
    notes: { type: String, default: "" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isDeleted: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);

studentScholarshipAwardSchema.index({ schoolId: 1, studentId: 1, coversProgramYear: 1 });

export type StudentScholarshipAwardDocument = InferSchemaType<
  typeof studentScholarshipAwardSchema
>;
export const StudentScholarshipAward = mongoose.model(
  "StudentScholarshipAward",
  studentScholarshipAwardSchema
);
