import type { Types } from "mongoose";
import {
  CHARACTER_CERTIFICATE_NUMBER_PREFIX,
  DEFAULT_CHARACTER_CERTIFICATE_AFFILIATION,
  DEFAULT_CHARACTER_CERTIFICATE_BODY,
  DEFAULT_CHARACTER_CERTIFICATE_COLLEGE_ADDRESS,
  DEFAULT_CHARACTER_CERTIFICATE_COLLEGE_NAME,
  DEFAULT_CHARACTER_CERTIFICATE_HEADING,
  DEFAULT_CHARACTER_CERTIFICATE_SIGNATORY,
  DEFAULT_CHARACTER_CERTIFICATE_TEMPLATE_NAME,
  type CharacterCertificateTokenMap
} from "@phit-erp/shared";
import { AcademicPromotion } from "../models/AcademicPromotion.js";
import { CharacterCertificate } from "../models/CharacterCertificate.js";
import { CharacterCertificateTemplate } from "../models/CharacterCertificateTemplate.js";
import { Setting } from "../models/Setting.js";
import { VoucherCounter } from "../models/VoucherCounter.js";
import { escapeRegex } from "./escapeRegex.js";
import { adToBsDate, getTodayBs } from "./nepaliDate.js";
import { resolveSchoolBranding } from "./schoolBranding.js";

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
 * Seed the counter for a series that predates it.
 *
 * Certificates issued before the counter existed were numbered from the document
 * count, so starting a fresh counter at zero would re-issue numbers that are
 * already on paper. On first use the counter is planted just above the highest
 * number on file instead.
 *
 * `$setOnInsert` makes this safe under a race: if two issues both find no
 * counter, only one insert lands and the other becomes a no-op, after which both
 * take their number from the same atomic `$inc`.
 */
const seedCertificateCounter = async (
  schoolId: Types.ObjectId,
  scope: string,
  prefix: string
): Promise<void> => {
  const existing = await VoucherCounter.findOne({ schoolId, scope }).select("_id").lean();
  if (existing) return;

  const latest = await CharacterCertificate.find({
    schoolId,
    certificateNumber: { $regex: `^${escapeRegex(prefix)}` }
  })
    .sort({ certificateNumber: -1 })
    .limit(1)
    .select("certificateNumber")
    .lean();

  const highest = latest[0]
    ? Number.parseInt(latest[0].certificateNumber.slice(prefix.length), 10) || 0
    : 0;

  await VoucherCounter.updateOne(
    { schoolId, scope },
    { $setOnInsert: { seq: highest } },
    { upsert: true }
  );
};

/**
 * Next certificate number for a school, e.g. CC-2082-00042.
 *
 * Numbers come from an atomic per-school, per-BS-year counter, so a number is
 * never handed out twice: deleting a certificate does NOT return its number to
 * the pool, and two admins issuing at the same instant get different numbers.
 * A deleted certificate therefore leaves a permanent gap in the series, which is
 * the point — the register has to show that a number was spent.
 *
 * The existence check below is belt-and-braces for numbers created before the
 * counter (or inserted by hand); with the counter seeded above the high-water
 * mark it should never fire.
 */
export const generateCertificateNumber = async (
  schoolId: Types.ObjectId
): Promise<string> => {
  const yearBs = (getTodayBs().split("-")[0] ?? "").trim() || String(new Date().getFullYear());
  const prefix = `${CHARACTER_CERTIFICATE_NUMBER_PREFIX}-${yearBs}-`;
  const scope = `${CHARACTER_CERTIFICATE_NUMBER_PREFIX}:${yearBs}`;

  await seedCertificateCounter(schoolId, scope, prefix);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const counter = await VoucherCounter.findOneAndUpdate(
      { schoolId, scope },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const candidate = `${prefix}${String(counter.seq).padStart(5, "0")}`;
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
 * The wording seeded before the template was rebuilt to match the institution's
 * own printed certificate. A template still carrying it verbatim was never
 * edited by an admin, so it is safe to move onto the new default.
 */
const LEGACY_DEFAULT_BODY = `This is to certify that {{studentName}}, {{genderPossessive}} father Mr. {{fatherName}} and mother Mrs. {{motherName}}, was a bona fide student of this institution in the {{program}} programme under batch {{batch}}.

{{genderPronoun}} bears registration number {{registrationNumber}} and successfully completed all academic requirements of the programme on {{passedOutDateBs}} B.S.

To the best of our knowledge, {{genderPossessive}} conduct and moral character during the entire period of study in this institution were found to be {{conduct}}.

We wish {{genderPossessive}} every success in future endeavours.`;

/**
 * The school's templates, seeding a default on first use so the issue form is
 * never empty for an institution that has not configured anything yet.
 *
 * Also refreshes an untouched seeded template to the current default wording —
 * matched on the exact legacy body, so anything an admin has edited is left
 * alone.
 */
export const ensureDefaultCertificateTemplate = async (
  schoolId: Types.ObjectId
): Promise<void> => {
  const count = await CharacterCertificateTemplate.countDocuments({ schoolId });
  if (count === 0) {
    await CharacterCertificateTemplate.create({
      schoolId,
      name: DEFAULT_CHARACTER_CERTIFICATE_TEMPLATE_NAME,
      headingText: DEFAULT_CHARACTER_CERTIFICATE_HEADING,
      bodyTemplate: DEFAULT_CHARACTER_CERTIFICATE_BODY,
      signatoryLabel: DEFAULT_CHARACTER_CERTIFICATE_SIGNATORY,
      affiliationText: DEFAULT_CHARACTER_CERTIFICATE_AFFILIATION,
      collegeNameOverride: DEFAULT_CHARACTER_CERTIFICATE_COLLEGE_NAME,
      collegeAddressOverride: DEFAULT_CHARACTER_CERTIFICATE_COLLEGE_ADDRESS,
      isDefault: true,
      isActive: true
    });
    return;
  }

  await CharacterCertificateTemplate.updateMany(
    { schoolId, bodyTemplate: LEGACY_DEFAULT_BODY },
    {
      $set: {
        bodyTemplate: DEFAULT_CHARACTER_CERTIFICATE_BODY,
        signatoryLabel: DEFAULT_CHARACTER_CERTIFICATE_SIGNATORY
      }
    }
  );

  /*
   * Letterhead fields postdate the first templates, so a school seeded earlier
   * has them unset. Only ever fill a blank — an admin who deliberately cleared
   * an override to fall back to Institution Settings must keep that.
   */
  await CharacterCertificateTemplate.updateMany(
    { schoolId, $or: [{ affiliationText: { $exists: false } }, { affiliationText: "" }] },
    { $set: { affiliationText: DEFAULT_CHARACTER_CERTIFICATE_AFFILIATION } }
  );
  await CharacterCertificateTemplate.updateMany(
    { schoolId, collegeNameOverride: { $exists: false } },
    { $set: { collegeNameOverride: DEFAULT_CHARACTER_CERTIFICATE_COLLEGE_NAME } }
  );
  await CharacterCertificateTemplate.updateMany(
    { schoolId, collegeAddressOverride: { $exists: false } },
    { $set: { collegeAddressOverride: DEFAULT_CHARACTER_CERTIFICATE_COLLEGE_ADDRESS } }
  );
};

export interface CertificateLetterhead {
  collegeName: string;
  collegeNameNp?: string;
  collegeAddress?: string;
  affiliationText: string;
}

/**
 * The letterhead block printed above the heading.
 *
 * Name and address come from the template's overrides when set, falling back to
 * Institution Settings. That keeps the certificate's registered/legal wording
 * independent of the shorter name the rest of the ERP shows on screen.
 */
export const resolveCertificateLetterhead = async (
  schoolId: Types.ObjectId,
  templateId?: Types.ObjectId | string | null
): Promise<CertificateLetterhead> => {
  // A school that has not opened the Templates tab since the letterhead fields
  // were added would otherwise print the old Institution Settings name here.
  // The seeder is idempotent and only ever fills fields that are absent.
  await ensureDefaultCertificateTemplate(schoolId);

  const [branding, template] = await Promise.all([
    resolveSchoolBranding(schoolId),
    templateId
      ? CharacterCertificateTemplate.findOne({ _id: templateId, schoolId }).lean()
      : CharacterCertificateTemplate.findOne({ schoolId, isDefault: true }).lean()
  ]);

  return {
    collegeName: template?.collegeNameOverride?.trim() || branding.collegeName,
    collegeNameNp: branding.collegeNameNp,
    collegeAddress: template?.collegeAddressOverride?.trim() || branding.collegeAddress,
    affiliationText: template?.affiliationText?.trim() || DEFAULT_CHARACTER_CERTIFICATE_AFFILIATION
  };
};
