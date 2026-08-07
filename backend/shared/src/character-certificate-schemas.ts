import { z } from "zod";
import {
  DEFAULT_CHARACTER_CERTIFICATE_HEADING,
  DEFAULT_CHARACTER_CERTIFICATE_SIGNATORY
} from "./character-certificate-constants.js";
import { bsDateSchema, objectIdSchema } from "./schemas.js";

export const characterCertificateTemplateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  headingText: z
    .string()
    .trim()
    .max(160)
    .default(DEFAULT_CHARACTER_CERTIFICATE_HEADING),
  bodyTemplate: z.string().trim().min(20).max(6000),
  signatoryLabel: z
    .string()
    .trim()
    .max(120)
    .default(DEFAULT_CHARACTER_CERTIFICATE_SIGNATORY),
  /** Small print above the heading, e.g. "(Affiliated To CTEVT)". */
  affiliationText: z.string().trim().max(160).optional().or(z.literal("")),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true)
});

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

/**
 * Values the printed form leaves blank for the office to fill in. They have no
 * source elsewhere in the system, so the admin sets them per student on the
 * issue form; anything left empty prints as a dotted blank.
 */
export const characterCertificateDetailsSchema = z.object({
  /** Institution's own register number, e.g. "GM - 076/77 - 001". */
  issueNo: optionalText(60),
  /** e.g. "three years". */
  courseDuration: optionalText(60),
  /** Overrides the institution-wide programme name for this certificate. */
  programName: optionalText(160),
  studyFromBs: optionalText(20),
  studyFromAd: optionalText(20),
  examYearBs: optionalText(20),
  examYearAd: optionalText(20),
  /** e.g. "First", "Distinction". */
  division: optionalText(60)
});

/**
 * Issue form. `resolvedBody` is what the admin actually saw in the preview — it
 * wins over re-rendering the template server-side, so what was approved is what
 * gets printed and stored.
 */
export const characterCertificateIssueSchema = characterCertificateDetailsSchema.extend({
  studentId: objectIdSchema,
  templateId: objectIdSchema.optional().or(z.literal("")),
  headingText: z.string().trim().max(160).optional().or(z.literal("")),
  resolvedBody: z.string().trim().min(20).max(8000),
  signatoryLabel: z.string().trim().max(120).optional().or(z.literal("")),
  affiliationText: z.string().trim().max(160).optional().or(z.literal("")),
  conduct: z.string().trim().max(120).optional().or(z.literal("")),
  purpose: z.string().trim().max(500).optional().or(z.literal("")),
  remarks: z.string().trim().max(1000).optional().or(z.literal("")),
  /** Optional — backend fills today's BS date when empty. */
  issueDateBs: bsDateSchema.optional().or(z.literal(""))
});

/**
 * Duplicate issuance. Body is optional: when omitted the most recent issuance's
 * body is reused verbatim, which is the usual "reissue what we issued before" case.
 */
export const characterCertificateDuplicateSchema = characterCertificateDetailsSchema.extend({
  purpose: z.string().trim().max(500).optional().or(z.literal("")),
  remarks: z.string().trim().max(1000).optional().or(z.literal("")),
  resolvedBody: z.string().trim().min(20).max(8000).optional().or(z.literal("")),
  headingText: z.string().trim().max(160).optional().or(z.literal("")),
  signatoryLabel: z.string().trim().max(120).optional().or(z.literal("")),
  affiliationText: z.string().trim().max(160).optional().or(z.literal("")),
  issueDateBs: bsDateSchema.optional().or(z.literal(""))
});

/** Preview resolves tokens without writing anything. */
export const characterCertificatePreviewSchema = characterCertificateDetailsSchema.extend({
  studentId: objectIdSchema,
  templateId: objectIdSchema.optional().or(z.literal("")),
  bodyTemplate: z.string().trim().max(8000).optional().or(z.literal("")),
  conduct: z.string().trim().max(120).optional().or(z.literal("")),
  purpose: z.string().trim().max(500).optional().or(z.literal("")),
  remarks: z.string().trim().max(1000).optional().or(z.literal("")),
  issueDateBs: bsDateSchema.optional().or(z.literal(""))
});

/**
 * Draft print. Renders the certificate PDF exactly as it would be issued, from
 * values that have not been saved, so the admin can check the sheet before
 * committing a certificate number to the register.
 */
export const characterCertificatePreviewPdfSchema = characterCertificateDetailsSchema.extend({
  studentId: objectIdSchema,
  certificateId: objectIdSchema.optional().or(z.literal("")),
  resolvedBody: z.string().trim().min(20).max(8000),
  headingText: z.string().trim().max(160).optional().or(z.literal("")),
  signatoryLabel: z.string().trim().max(120).optional().or(z.literal("")),
  affiliationText: z.string().trim().max(160).optional().or(z.literal("")),
  conduct: z.string().trim().max(120).optional().or(z.literal("")),
  issueDateBs: bsDateSchema.optional().or(z.literal("")),
  isDuplicate: z.boolean().optional()
});

export type CharacterCertificateTemplateInput = z.infer<typeof characterCertificateTemplateSchema>;
export type CharacterCertificateDetailsInput = z.infer<typeof characterCertificateDetailsSchema>;
export type CharacterCertificateIssueInput = z.infer<typeof characterCertificateIssueSchema>;
export type CharacterCertificateDuplicateInput = z.infer<typeof characterCertificateDuplicateSchema>;
export type CharacterCertificatePreviewInput = z.infer<typeof characterCertificatePreviewSchema>;
export type CharacterCertificatePreviewPdfInput = z.infer<
  typeof characterCertificatePreviewPdfSchema
>;
