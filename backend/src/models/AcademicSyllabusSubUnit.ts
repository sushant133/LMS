import mongoose, { Schema, type InferSchemaType } from "mongoose";

const attachmentSchema = new Schema(
  {
    url: { type: String, required: true },
    name: { type: String, default: "" },
    mimeType: { type: String },
    kind: {
      type: String,
      enum: ["FILE", "IMAGE", "PDF", "VIDEO", "LINK", "WORD", "EXCEL", "POWERPOINT"]
    }
  },
  { _id: false }
);

const referencesSchema = new Schema(
  {
    textbooks: { type: String, default: "" },
    journal: { type: String, default: "" },
    whoGuidelines: { type: String, default: "" },
    internetResources: { type: String, default: "" },
    freeText: { type: String, default: "" }
  },
  { _id: false }
);

/**
 * Sub Unit (sub-topic) — supports unlimited nesting via parentSubUnitId.
 * Top-level rows have parentSubUnitId = null; children point at their parent.
 * Auto display numbers: 1.1, 1.1.1, 1.1.1.1, …
 */
const subUnitSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    syllabusId: { type: Schema.Types.ObjectId, ref: "AcademicSyllabus", required: true, index: true },
    chapterId: { type: Schema.Types.ObjectId, ref: "AcademicSyllabusChapter", required: true, index: true },
    unitId: { type: Schema.Types.ObjectId, ref: "AcademicSyllabusTopic", required: true, index: true },
    /** null = direct child of unit; otherwise nested under another sub-unit. */
    parentSubUnitId: {
      type: Schema.Types.ObjectId,
      ref: "AcademicSyllabusSubUnit",
      default: null,
      index: true
    },
    subUnitNo: { type: Number, required: true, min: 1 },
    /** Optional — blank heading is allowed for partial drafts. */
    heading: { type: String, default: "", trim: true },
    description: { type: String, default: "" },
    learningOutcomes: { type: String, default: "" },
    internalAssessment: { type: String, default: "" },
    practicalRequired: { type: Boolean, default: false },
    labName: { type: String, default: "" },
    requiredEquipment: { type: String, default: "" },
    hospitalPosting: { type: String, default: "" },
    clinicalHours: { type: Number, default: 0, min: 0 },
    references: { type: referencesSchema, default: () => ({}) },
    teachingHours: { type: Number, default: 0, min: 0 },
    attachments: { type: [attachmentSchema], default: [] },
    remarks: { type: String, default: "" },
    status: {
      type: String,
      enum: ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "SKIPPED", "REVISION_REQUIRED"],
      default: "NOT_STARTED",
      index: true
    },
    teachingNotes: { type: String, default: "" },
    teacherAttachments: { type: [attachmentSchema], default: [] },
    todaysCoverage: { type: String, default: "" },
    sortOrder: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true }
);

// Sibling uniqueness under the same parent (null parent = top-level under unit)
subUnitSchema.index(
  { unitId: 1, parentSubUnitId: 1, subUnitNo: 1 },
  { unique: true }
);
subUnitSchema.index({ syllabusId: 1, status: 1 });
subUnitSchema.index({ chapterId: 1, sortOrder: 1 });
subUnitSchema.index({ unitId: 1, sortOrder: 1 });
subUnitSchema.index({ parentSubUnitId: 1, sortOrder: 1 });
subUnitSchema.index({ heading: "text", description: "text", learningOutcomes: "text" });

export type AcademicSyllabusSubUnitDocument = InferSchemaType<typeof subUnitSchema>;
export const AcademicSyllabusSubUnit = mongoose.model("AcademicSyllabusSubUnit", subUnitSchema);
