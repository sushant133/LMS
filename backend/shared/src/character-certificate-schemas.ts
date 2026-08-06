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
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true)
});

/**
 * Issue form. `resolvedBody` is what the admin actually saw in the preview — it
 * wins over re-rendering the template server-side, so what was approved is what
 * gets printed and stored.
 */
export const characterCertificateIssueSchema = z.object({
  studentId: objectIdSchema,
  templateId: objectIdSchema.optional().or(z.literal("")),
  headingText: z.string().trim().max(160).optional().or(z.literal("")),
  resolvedBody: z.string().trim().min(20).max(8000),
  signatoryLabel: z.string().trim().max(120).optional().or(z.literal("")),
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
export const characterCertificateDuplicateSchema = z.object({
  purpose: z.string().trim().max(500).optional().or(z.literal("")),
  remarks: z.string().trim().max(1000).optional().or(z.literal("")),
  resolvedBody: z.string().trim().min(20).max(8000).optional().or(z.literal("")),
  headingText: z.string().trim().max(160).optional().or(z.literal("")),
  signatoryLabel: z.string().trim().max(120).optional().or(z.literal("")),
  issueDateBs: bsDateSchema.optional().or(z.literal(""))
});

/** Preview resolves tokens without writing anything. */
export const characterCertificatePreviewSchema = z.object({
  studentId: objectIdSchema,
  templateId: objectIdSchema.optional().or(z.literal("")),
  bodyTemplate: z.string().trim().max(8000).optional().or(z.literal("")),
  conduct: z.string().trim().max(120).optional().or(z.literal("")),
  purpose: z.string().trim().max(500).optional().or(z.literal("")),
  remarks: z.string().trim().max(1000).optional().or(z.literal("")),
  issueDateBs: bsDateSchema.optional().or(z.literal(""))
});

export type CharacterCertificateTemplateInput = z.infer<typeof characterCertificateTemplateSchema>;
export type CharacterCertificateIssueInput = z.infer<typeof characterCertificateIssueSchema>;
export type CharacterCertificateDuplicateInput = z.infer<typeof characterCertificateDuplicateSchema>;
export type CharacterCertificatePreviewInput = z.infer<typeof characterCertificatePreviewSchema>;
