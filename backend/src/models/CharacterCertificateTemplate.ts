import mongoose, { Schema, type InferSchemaType } from "mongoose";
import {
  DEFAULT_CHARACTER_CERTIFICATE_HEADING,
  DEFAULT_CHARACTER_CERTIFICATE_SIGNATORY
} from "@phit-erp/shared";

/**
 * Institution-defined Character Certificate template. `bodyTemplate` carries
 * {{token}} placeholders (see CHARACTER_CERTIFICATE_PLACEHOLDERS) that are
 * resolved from the student profile + issue form at preview/issue time.
 */
const characterCertificateTemplateSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    name: { type: String, required: true, trim: true },
    headingText: {
      type: String,
      trim: true,
      default: DEFAULT_CHARACTER_CERTIFICATE_HEADING
    },
    bodyTemplate: { type: String, required: true },
    signatoryLabel: {
      type: String,
      trim: true,
      default: DEFAULT_CHARACTER_CERTIFICATE_SIGNATORY
    },
    /** Small print above the heading, e.g. "(Affiliated To CTEVT)". */
    affiliationText: { type: String, trim: true, default: "" },
    /** Pre-selected on the issue form. Only one per school; enforced in the controller. */
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    createdByName: { type: String, default: "" }
  },
  { timestamps: true }
);

characterCertificateTemplateSchema.index({ schoolId: 1, name: 1 }, { unique: true });

export type CharacterCertificateTemplateDocument = InferSchemaType<
  typeof characterCertificateTemplateSchema
>;
export const CharacterCertificateTemplate = mongoose.model(
  "CharacterCertificateTemplate",
  characterCertificateTemplateSchema
);
