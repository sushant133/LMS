import type { Types } from "mongoose";
import {
  CHARACTER_CERTIFICATE_NUMBER_PREFIX,
  DEFAULT_CHARACTER_CERTIFICATE_BODY,
  DEFAULT_CHARACTER_CERTIFICATE_HEADING,
  DEFAULT_CHARACTER_CERTIFICATE_SIGNATORY,
  DEFAULT_CHARACTER_CERTIFICATE_TEMPLATE_NAME,
  type CharacterCertificateTokenMap
} from "@phit-erp/shared";
import { AcademicPromotion } from "../models/AcademicPromotion.js";
import { CharacterCertificate } from "../models/CharacterCertificate.js";
import { CharacterCertificateTemplate } from "../models/CharacterCertificateTemplate.js";
import { Setting } from "../models/Setting.js";
import { adToBsDate, getTodayBs } from "./nepaliDate.js";

/**
 * Resolve {{token}} placeholders in a template body.
 *
 * Unknown tokens are left as-is on purpose: a typo like {{studentNmae}} then
 * shows up verbatim in the preview instead of silently rendering as blank,
 * which would put an empty gap on a legal document.
 */
export const resolveCertificateTokens = (
  template: string,
  tokens: CharacterCertificateTokenMap
): string =>
  template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, rawKey: string) => {
    const value = tokens[rawKey as keyof CharacterCertificateTokenMap];
    return value === undefined || value === null || value === "" ? match : String(value);
  });

/** Pronouns so a template can read naturally without per-gender templates. */
export const genderPronouns = (
  gender: string | undefined | null
): { pronoun: string; possessive: string } => {
  const normalized = String(gender ?? "").trim().toUpperCase();
  if (normalized.startsWith("M")) return { pronoun: "He", possessive: "his" };
  if (normalized.startsWith("F")) return { pronoun: "She", possessive: "her" };
  return { pronoun: "They", possessive: "their" };
};

/**
 * Next certificate number for a school, e.g. CC-2082-00042.
 *
 * The counter is per-school and derived from the current document count, then
 * verified against existing numbers — two admins issuing at the same instant
 * would otherwise race to the same value and trip the unique index.
 */
export const generateCertificateNumber = async (
  schoolId: Types.ObjectId
): Promise<string> => {
  const yearBs = (getTodayBs().split("-")[0] ?? "").trim() || String(new Date().getFullYear());
  const prefix = `${CHARACTER_CERTIFICATE_NUMBER_PREFIX}-${yearBs}-`;

  const latest = await CharacterCertificate.find({
    schoolId,
    certificateNumber: { $regex: `^${prefix}` }
  })
    .sort({ certificateNumber: -1 })
    .limit(1)
    .lean();

  const lastSequence = latest[0]
    ? Number.parseInt(latest[0].certificateNumber.slice(prefix.length), 10) || 0
    : 0;

  // Walk forward until the number is free so a concurrent issue cannot collide.
  for (let sequence = lastSequence + 1; sequence < lastSequence + 1000; sequence += 1) {
    const candidate = `${prefix}${String(sequence).padStart(5, "0")}`;
    const exists = await CharacterCertificate.exists({ schoolId, certificateNumber: candidate });
    if (!exists) return candidate;
  }

  throw new Error("Unable to allocate a character certificate number");
};

/** Institution-wide programme name shown as Program/Course. */
export const resolveProgramName = async (schoolId: Types.ObjectId): Promise<string> => {
  const settings = await Setting.findOne({ schoolId }).select("programName").lean();
  return settings?.programName?.trim() ?? "";
};

/**
 * Graduation dates for students who passed out before `passedOutAtBs` was
 * stamped on the Student document. Reads the promotion history and maps each
 * student to the BS date of the run that marked them PASSED_OUT.
 *
 * Only called for the students actually missing a stamp, so a fully-stamped
 * roster costs nothing.
 */
export const derivePassedOutDates = async (
  schoolId: Types.ObjectId,
  studentIds: string[]
): Promise<Map<string, string>> => {
  const dates = new Map<string, string>();
  if (studentIds.length === 0) return dates;

  const wanted = new Set(studentIds);
  const promotions = await AcademicPromotion.find({ schoolId, status: "COMPLETED" })
    .sort({ promotionDate: 1 })
    .select("promotionDate groups.students.studentId groups.students.outcome")
    .lean();

  for (const promotion of promotions) {
    const promotedOn = promotion.promotionDate ?? promotion.createdAt;
    if (!promotedOn) continue;

    let dateBs = "";
    try {
      dateBs = adToBsDate(new Date(promotedOn).toISOString().slice(0, 10)).dateBs;
    } catch {
      continue;
    }

    for (const group of promotion.groups ?? []) {
      for (const student of group.students ?? []) {
        if (student.outcome !== "PASSED_OUT") continue;
        const id = String(student.studentId);
        // Later runs win: a rolled-back-and-redone promotion should report the
        // date the student actually ended up graduating on.
        if (wanted.has(id)) dates.set(id, dateBs);
      }
    }
  }

  return dates;
};

/**
 * The school's templates, seeding a default on first use so the issue form is
 * never empty for an institution that has not configured anything yet.
 */
export const ensureDefaultCertificateTemplate = async (
  schoolId: Types.ObjectId
): Promise<void> => {
  const count = await CharacterCertificateTemplate.countDocuments({ schoolId });
  if (count > 0) return;

  await CharacterCertificateTemplate.create({
    schoolId,
    name: DEFAULT_CHARACTER_CERTIFICATE_TEMPLATE_NAME,
    headingText: DEFAULT_CHARACTER_CERTIFICATE_HEADING,
    bodyTemplate: DEFAULT_CHARACTER_CERTIFICATE_BODY,
    signatoryLabel: DEFAULT_CHARACTER_CERTIFICATE_SIGNATORY,
    isDefault: true,
    isActive: true
  });
};
