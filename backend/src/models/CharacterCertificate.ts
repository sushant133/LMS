import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { CHARACTER_CERTIFICATE_ISSUE_TYPES } from "@phit-erp/shared";

/**
 * One issuance event, append-only. The first row is always ORIGINAL; every
 * reissue appends a DUPLICATE row. Reprinting an existing row never writes.
 * `resolvedBody` is stored per issuance so a reprint reproduces exactly what
 * was handed over, even after the source template is edited or deleted.
 */
const certificateIssuanceSchema = new Schema(
  {
    issueType: { type: String, enum: CHARACTER_CERTIFICATE_ISSUE_TYPES, required: true },
    issueNumber: { type: Number, required: true, min: 1 },
    issueDateBs: { type: String, required: true },
    issuedAt: { type: Date, required: true, default: () => new Date() },
    issuedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    issuedByName: { type: String, required: true },
    purpose: { type: String, default: "" },
    remarks: { type: String, default: "" },
    resolvedBody: { type: String, required: true },
    headingText: { type: String, default: "" },
    signatoryLabel: { type: String, default: "" },
    affiliationText: { type: String, default: "" },
    /**
     * The blanks the printed form leaves for the office — register number,
     * course duration, study period, exam year, division. Stored per issuance
     * so a reprint reproduces the sheet exactly as handed over.
     */
    details: {
      type: new Schema(
        {
          issueNo: { type: String, default: "" },
          courseDuration: { type: String, default: "" },
          programName: { type: String, default: "" },
          studyFromBs: { type: String, default: "" },
          studyFromAd: { type: String, default: "" },
          examYearBs: { type: String, default: "" },
          examYearAd: { type: String, default: "" },
          division: { type: String, default: "" }
        },
        { _id: false }
      ),
      default: () => ({})
    },
    /** Reference only — the template may later be renamed or deactivated. */
    templateId: { type: Schema.Types.ObjectId, ref: "CharacterCertificateTemplate" },
    templateName: { type: String, default: "" }
  },
  { _id: false }
);

/**
 * Student details frozen at first issue. The certificate is a permanent legal
 * record, so it must not silently change when the student profile is edited.
 */
const certificateStudentSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    studentName: { type: String, required: true },
    fatherName: { type: String, default: "" },
    motherName: { type: String, default: "" },
    registrationNumber: { type: String, default: "" },
    admissionNumber: { type: String, required: true },
    rollNumber: { type: Number, default: 0 },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch" },
    batchName: { type: String, default: "" },
    yearId: { type: Schema.Types.ObjectId, ref: "Year" },
    yearName: { type: String, default: "" },
    programName: { type: String, default: "" },
    gender: { type: String, default: "" },
    dateOfBirthBs: { type: String, default: "" },
    address: { type: String, default: "" },
    passedOutDateBs: { type: String, default: "" }
  },
  { _id: false }
);

/**
 * A student's Character Certificate. One document per student per school —
 * the certificate number is issued once and reused by every duplicate, so the
 * issuance history below is the complete audit trail for that number.
 */
const characterCertificateSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    certificateNumber: { type: String, required: true, trim: true },
    student: { type: certificateStudentSchema, required: true },
    conduct: { type: String, default: "" },
    issuances: { type: [certificateIssuanceSchema], default: [] },
    /** Denormalised issuances.length — drives the Issue Count column. */
    issueCount: { type: Number, default: 0, min: 0 },
    originalIssueDateBs: { type: String, default: "" },
    lastIssueDateBs: { type: String, default: "" }
  },
  { timestamps: true }
);

characterCertificateSchema.index({ schoolId: 1, certificateNumber: 1 }, { unique: true });
// One certificate number per student; duplicates append to the same document.
characterCertificateSchema.index({ schoolId: 1, "student.studentId": 1 }, { unique: true });
characterCertificateSchema.index({ schoolId: 1, createdAt: -1 });
characterCertificateSchema.index({ schoolId: 1, "student.batchId": 1 });

export type CharacterCertificateDocument = InferSchemaType<typeof characterCertificateSchema>;
export const CharacterCertificate = mongoose.model(
  "CharacterCertificate",
  characterCertificateSchema
);
