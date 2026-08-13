import fs from "fs";
import type { Request, Response } from "express";
import type { Types } from "mongoose";
import {
  CHARACTER_CERTIFICATE_CONDUCT_RATINGS,
  DEFAULT_CHARACTER_CERTIFICATE_AFFILIATION,
  DEFAULT_CHARACTER_CERTIFICATE_BODY,
  DEFAULT_CHARACTER_CERTIFICATE_HEADING,
  DEFAULT_CHARACTER_CERTIFICATE_SIGNATORY,
  characterCertificateDuplicateSchema,
  characterCertificateIssueSchema,
  characterCertificatePreviewPdfSchema,
  characterCertificatePreviewSchema,
  characterCertificateTemplateSchema,
  characterCertificateUpdateSchema,
  type CharacterCertificateDetailsInput,
  type CharacterCertificateTokenMap
} from "@phit-erp/shared";
import { Batch } from "../models/Batch.js";
import { CharacterCertificate } from "../models/CharacterCertificate.js";
import { CharacterCertificateTemplate } from "../models/CharacterCertificateTemplate.js";
import { Student } from "../models/Student.js";
import { User } from "../models/User.js";
import { Year } from "../models/Year.js";
import { ApiError } from "../utils/apiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { recordAudit } from "../utils/audit.js";
import {
  derivePassedOutDates,
  ensureDefaultCertificateTemplate,
  generateCertificateNumber,
  genderPronouns,
  resolveCertificateLetterhead,
  resolveCertificateTokens,
  resolveProgramName
} from "../utils/characterCertificateService.js";
import { collegeLogoExists, getCollegeLogoPath } from "../utils/collegeLogo.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { formatAddressLine } from "../utils/formatAddress.js";
import { requireCollegeInstitution } from "../utils/institution.js";
import { getTodayBs } from "../utils/nepaliDate.js";
import { sendSuccess } from "../utils/response.js";
import { resolveSchoolBranding } from "../utils/schoolBranding.js";
import { generateCharacterCertificatePdf } from "../utils/templates/characterCertificateTemplate.js";
import { tenantObjectId } from "../utils/tenant.js";

/** Statuses that put a student in the Passed-Out Students list. */
const PASSED_OUT_STATUSES = ["PASSED_OUT", "ALUMNI"] as const;

const DEFAULT_CONDUCT = CHARACTER_CERTIFICATE_CONDUCT_RATINGS[0];

const resolveActorName = async (req: Request): Promise<string> => {
  if (!req.user?.userId) {
    return "Administrator";
  }
  const user = await User.findById(req.user.userId).select("fullName").lean();
  return user?.fullName || req.user.email || "Administrator";
};

interface LoadedStudent {
  studentId: string;
  studentName: string;
  fatherName: string;
  motherName: string;
  registrationNumber: string;
  admissionNumber: string;
  rollNumber: number;
  batchId?: string;
  batchName: string;
  yearId?: string;
  yearName: string;
  gender: string;
  dateOfBirthBs: string;
  address: string;
  passedOutDateBs: string;
  academicStatus: string;
}

/**
 * Passed-out students with batch/year names resolved and the graduation date
 * backfilled from promotion history where the Student document predates the
 * `passedOutAtBs` stamp.
 */
const loadPassedOutStudents = async (
  schoolId: Types.ObjectId,
  filter: Record<string, unknown> = {}
): Promise<LoadedStudent[]> => {
  const students = await Student.find({
    schoolId,
    academicStatus: { $in: PASSED_OUT_STATUSES },
    ...filter
  })
    .populate("user", "fullName")
    .lean();

  const [batches, years] = await Promise.all([
    Batch.find({ schoolId }).select("name").lean(),
    Year.find({ schoolId }).select("name").lean()
  ]);
  const batchNames = new Map(batches.map((batch) => [batch._id.toString(), batch.name]));
  const yearNames = new Map(years.map((year) => [year._id.toString(), year.name]));

  const missingDates = students
    .filter((student) => !student.passedOutAtBs)
    .map((student) => student._id.toString());
  const derivedDates = await derivePassedOutDates(schoolId, missingDates);

  return students.map((student) => {
    const user = student.user as { fullName?: string } | undefined;
    const id = student._id.toString();
    return {
      studentId: id,
      studentName: user?.fullName ?? "Student",
      fatherName: student.fatherName ?? "",
      motherName: student.motherName ?? "",
      registrationNumber: student.registrationNumber ?? "",
      admissionNumber: student.admissionNumber,
      rollNumber: student.rollNumber ?? 0,
      batchId: student.batchId?.toString(),
      batchName: student.batchId ? (batchNames.get(student.batchId.toString()) ?? "") : "",
      yearId: student.yearId?.toString(),
      yearName: student.yearId ? (yearNames.get(student.yearId.toString()) ?? "") : "",
      gender: student.gender ?? "",
      dateOfBirthBs: student.dateOfBirthBs ?? "",
      address: formatAddressLine(student.address) ?? "",
      passedOutDateBs: student.passedOutAtBs || derivedDates.get(id) || "",
      academicStatus: student.academicStatus ?? "PASSED_OUT"
    };
  });
};

/** Token values for a template body, from the student profile + issue form. */
const buildTokens = (
  student: LoadedStudent,
  context: {
    programName: string;
    certificateNumber: string;
    issueDateBs: string;
    conduct: string;
    purpose: string;
    remarks: string;
    collegeName: string;
    collegeAddress: string;
    principalName: string;
    details?: CharacterCertificateDetailsInput;
  }
): CharacterCertificateTokenMap => {
  const { pronoun, possessive } = genderPronouns(student.gender);
  const details = context.details ?? {};
  return {
    studentName: student.studentName,
    fatherName: student.fatherName,
    motherName: student.motherName,
    registrationNumber: student.registrationNumber || student.admissionNumber,
    admissionNumber: student.admissionNumber,
    rollNumber: student.rollNumber ? String(student.rollNumber) : "",
    batch: student.batchName,
    year: student.yearName,
    // A certificate may name a different course than the institution default.
    program: details.programName?.trim() || context.programName,
    gender: student.gender,
    genderPronoun: pronoun,
    genderPronounLower: pronoun.toLowerCase(),
    genderPossessive: possessive,
    dateOfBirthBs: student.dateOfBirthBs,
    address: student.address,
    passedOutDateBs: student.passedOutDateBs,
    certificateNumber: context.certificateNumber,
    issueNo: details.issueNo ?? "",
    issueDateBs: context.issueDateBs,
    conduct: context.conduct,
    courseDuration: details.courseDuration ?? "",
    studyFromBs: details.studyFromBs ?? "",
    studyFromAd: details.studyFromAd ?? "",
    examYearBs: details.examYearBs ?? "",
    examYearAd: details.examYearAd ?? "",
    division: details.division ?? "",
    purpose: context.purpose,
    remarks: context.remarks,
    collegeName: context.collegeName,
    collegeAddress: context.collegeAddress,
    principalName: context.principalName
  };
};

/** Only the printable blanks, so the issue/duplicate payloads stay explicit. */
const pickDetails = (payload: CharacterCertificateDetailsInput): CharacterCertificateDetailsInput => ({
  issueNo: payload.issueNo ?? "",
  courseDuration: payload.courseDuration ?? "",
  programName: payload.programName ?? "",
  studyFromBs: payload.studyFromBs ?? "",
  studyFromAd: payload.studyFromAd ?? "",
  examYearBs: payload.examYearBs ?? "",
  examYearAd: payload.examYearAd ?? "",
  division: payload.division ?? ""
});

/**
 * Reissue keeps the blanks from the previous sheet unless this issuance
 * actually supplies a replacement — an omitted field must not blank the value
 * the original certificate was printed with.
 */
const mergeDetails = (
  previous: CharacterCertificateDetailsInput | null | undefined,
  payload: CharacterCertificateDetailsInput
): CharacterCertificateDetailsInput => {
  const merged = { ...pickDetails(previous ?? {}) };
  for (const [key, value] of Object.entries(pickDetails(payload))) {
    if (value) merged[key as keyof CharacterCertificateDetailsInput] = value;
  }
  return merged;
};

/** The institution logo, inlined for Puppeteer (which has no base URL). */
const readCollegeLogoDataUri = (): string | undefined => {
  if (!collegeLogoExists()) return undefined;
  try {
    return `data:image/png;base64,${fs.readFileSync(getCollegeLogoPath()).toString("base64")}`;
  } catch {
    return undefined;
  }
};

/* ------------------------------------------------------------------ *
 * Passed-Out Students
 * ------------------------------------------------------------------ */

export const listPassedOutStudents = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const schoolId = tenantObjectId(req);

  const filter: Record<string, unknown> = {};
  if (typeof req.query.batchId === "string" && req.query.batchId) {
    filter.batchId = req.query.batchId;
  }
  if (typeof req.query.yearId === "string" && req.query.yearId) {
    filter.yearId = req.query.yearId;
  }

  const [students, programName, certificates] = await Promise.all([
    loadPassedOutStudents(schoolId, filter),
    resolveProgramName(schoolId),
    CharacterCertificate.find({ schoolId })
      .select("certificateNumber student.studentId issueCount lastIssueDateBs")
      .lean()
  ]);

  const certificateByStudent = new Map(
    certificates.map((certificate) => [String(certificate.student.studentId), certificate])
  );

  const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
  const certificateFilter =
    typeof req.query.certificateStatus === "string" ? req.query.certificateStatus : "";

  const rows = students
    .map((student) => {
      const certificate = certificateByStudent.get(student.studentId);
      return {
        ...student,
        programName,
        certificateId: certificate?._id?.toString(),
        certificateNumber: certificate?.certificateNumber,
        issueCount: certificate?.issueCount ?? 0,
        lastIssueDateBs: certificate?.lastIssueDateBs || undefined
      };
    })
    .filter((row) => {
      if (certificateFilter === "ISSUED" && !row.certificateNumber) return false;
      if (certificateFilter === "NOT_ISSUED" && row.certificateNumber) return false;
      if (!search) return true;
      return [
        row.studentName,
        row.registrationNumber,
        row.admissionNumber,
        row.batchName,
        row.certificateNumber ?? ""
      ]
        .join(" ")
        .toLowerCase()
        .includes(search);
    })
    .sort(
      (left, right) =>
        left.batchName.localeCompare(right.batchName) ||
        left.studentName.localeCompare(right.studentName)
    );

  return sendSuccess(res, "Passed-out students fetched", rows);
});

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */

export const listCertificateTemplates = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const schoolId = tenantObjectId(req);
  await ensureDefaultCertificateTemplate(schoolId);

  const templates = await CharacterCertificateTemplate.find({ schoolId })
    .sort({ isDefault: -1, name: 1 })
    .lean();

  return sendSuccess(
    res,
    "Certificate templates fetched",
    templates.map((template) => ({
      ...template,
      _id: template._id.toString(),
      schoolId: template.schoolId.toString()
    }))
  );
});

export const createCertificateTemplate = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const schoolId = tenantObjectId(req);
  const payload = characterCertificateTemplateSchema.parse(req.body);

  const duplicate = await CharacterCertificateTemplate.findOne({ schoolId, name: payload.name });
  if (duplicate) {
    throw new ApiError(409, "A template with this name already exists");
  }

  // Exactly one default per school.
  if (payload.isDefault) {
    await CharacterCertificateTemplate.updateMany({ schoolId }, { $set: { isDefault: false } });
  }

  const template = await CharacterCertificateTemplate.create({
    ...payload,
    schoolId,
    createdBy: req.user?.userId,
    createdByName: await resolveActorName(req)
  });

  await recordAudit(req, {
    action: "CREATE",
    entity: "CharacterCertificateTemplate",
    entityId: template._id.toString(),
    after: template.toObject()
  });

  return sendSuccess(res, "Certificate template created", template, 201);
});

export const updateCertificateTemplate = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const schoolId = tenantObjectId(req);
  const templateId = String(req.params.templateId);
  const payload = characterCertificateTemplateSchema.parse(req.body);

  const existing = await CharacterCertificateTemplate.findOne({ _id: templateId, schoolId });
  if (!existing) {
    throw new ApiError(404, "Certificate template not found");
  }

  const nameClash = await CharacterCertificateTemplate.findOne({
    schoolId,
    name: payload.name,
    _id: { $ne: templateId }
  });
  if (nameClash) {
    throw new ApiError(409, "A template with this name already exists");
  }

  if (payload.isDefault) {
    await CharacterCertificateTemplate.updateMany(
      { schoolId, _id: { $ne: templateId } },
      { $set: { isDefault: false } }
    );
  }

  const before = existing.toObject();
  existing.set(payload);
  await existing.save();

  await recordAudit(req, {
    action: "UPDATE",
    entity: "CharacterCertificateTemplate",
    entityId: templateId,
    before,
    after: existing.toObject()
  });

  return sendSuccess(res, "Certificate template updated", existing);
});

export const deleteCertificateTemplate = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const schoolId = tenantObjectId(req);
  const templateId = String(req.params.templateId);

  const template = await CharacterCertificateTemplate.findOne({ _id: templateId, schoolId });
  if (!template) {
    throw new ApiError(404, "Certificate template not found");
  }

  // Issued certificates keep their own copy of the body, so deleting a template
  // never changes what an already-issued certificate reprints as.
  await template.deleteOne();

  await recordAudit(req, {
    action: "DELETE",
    entity: "CharacterCertificateTemplate",
    entityId: templateId,
    before: template.toObject()
  });

  return sendSuccess(res, "Certificate template deleted", { _id: templateId });
});

/* ------------------------------------------------------------------ *
 * Preview / issue
 * ------------------------------------------------------------------ */

export const previewCertificate = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const schoolId = tenantObjectId(req);
  const payload = characterCertificatePreviewSchema.parse(req.body);

  const [students, programName, branding] = await Promise.all([
    loadPassedOutStudents(schoolId, { _id: payload.studentId }),
    resolveProgramName(schoolId),
    resolveSchoolBranding(schoolId)
  ]);

  const student = students[0];
  if (!student) {
    throw new ApiError(404, "Passed-out student not found");
  }

  let bodyTemplate = payload.bodyTemplate?.trim() ?? "";
  let headingText = DEFAULT_CHARACTER_CERTIFICATE_HEADING;
  let signatoryLabel = DEFAULT_CHARACTER_CERTIFICATE_SIGNATORY;
  let affiliationText = "";

  // The heading/signatory/affiliation come from the template even when the body
  // was typed by hand, so the form can still show what will be printed.
  const template = payload.templateId
    ? await CharacterCertificateTemplate.findOne({ _id: payload.templateId, schoolId }).lean()
    : await CharacterCertificateTemplate.findOne({ schoolId, isDefault: true }).lean();
  headingText = template?.headingText || headingText;
  signatoryLabel = template?.signatoryLabel || signatoryLabel;
  affiliationText = template?.affiliationText || DEFAULT_CHARACTER_CERTIFICATE_AFFILIATION;
  if (!bodyTemplate) {
    bodyTemplate = template?.bodyTemplate ?? DEFAULT_CHARACTER_CERTIFICATE_BODY;
  }

  // Existing certificate reuses its number in the preview so the admin sees the
  // real number a duplicate will carry, not a fresh one.
  const existing = await CharacterCertificate.findOne({
    schoolId,
    "student.studentId": payload.studentId
  })
    .select("certificateNumber")
    .lean();

  const tokens = buildTokens(student, {
    programName,
    certificateNumber: existing?.certificateNumber ?? "(assigned on issue)",
    issueDateBs: payload.issueDateBs || getTodayBs(),
    conduct: payload.conduct || DEFAULT_CONDUCT,
    purpose: payload.purpose ?? "",
    remarks: payload.remarks ?? "",
    collegeName: branding.collegeName,
    collegeAddress: branding.collegeAddress ?? "",
    principalName: branding.principalName ?? "",
    details: pickDetails(payload)
  });

  return sendSuccess(res, "Certificate preview generated", {
    student,
    programName,
    headingText,
    signatoryLabel,
    affiliationText,
    bodyTemplate,
    resolvedBody: resolveCertificateTokens(bodyTemplate, tokens),
    certificateNumber: existing?.certificateNumber ?? null,
    tokens
  });
});

/**
 * Render the certificate PDF from values that have not been saved, so the admin
 * can check (or hand over) the sheet before a certificate number is committed
 * to the register. Writes nothing.
 */
export const previewCertificatePdf = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const schoolId = tenantObjectId(req);
  const payload = characterCertificatePreviewPdfSchema.parse(req.body);

  const [students, programName, letterhead] = await Promise.all([
    loadPassedOutStudents(schoolId, { _id: payload.studentId }),
    resolveProgramName(schoolId),
    resolveCertificateLetterhead(schoolId)
  ]);

  const student = students[0];
  if (!student) {
    throw new ApiError(404, "Passed-out student not found");
  }

  const existing = await CharacterCertificate.findOne({
    schoolId,
    "student.studentId": payload.studentId
  })
    .select("certificateNumber issueCount")
    .lean();

  const details = pickDetails(payload);
  const pdfBuffer = await generateCharacterCertificatePdf({
    collegeName: letterhead.collegeName,
    collegeNameNp: letterhead.collegeNameNp,
    collegeAddress: letterhead.collegeAddress,
    collegeLogoDataUri: readCollegeLogoDataUri(),
    affiliationText: payload.affiliationText || letterhead.affiliationText,
    headingText: payload.headingText || DEFAULT_CHARACTER_CERTIFICATE_HEADING,
    certificateNumber: existing?.certificateNumber ?? "(assigned on issue)",
    issueNo: details.issueNo || undefined,
    body: payload.resolvedBody,
    studentName: student.studentName,
    registrationNumber: student.registrationNumber || undefined,
    admissionNumber: student.admissionNumber,
    batchName: student.batchName || undefined,
    yearName: student.yearName || undefined,
    programName: details.programName || programName || undefined,
    passedOutDateBs: student.passedOutDateBs || undefined,
    conduct: payload.conduct || undefined,
    issueDateBs: payload.issueDateBs || getTodayBs(),
    signatoryLabel: payload.signatoryLabel || DEFAULT_CHARACTER_CERTIFICATE_SIGNATORY,
    isDuplicate: payload.isDuplicate === true,
    issueNumber: (existing?.issueCount ?? 0) + 1,
    printedDateBs: getTodayBs()
  });

  const safeName = student.studentName.replace(/\s+/g, "-");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="character-certificate-preview-${safeName}.pdf"`
  );
  return res.send(pdfBuffer);
});

export const issueCertificate = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const schoolId = tenantObjectId(req);
  const payload = characterCertificateIssueSchema.parse(req.body);

  const existing = await CharacterCertificate.findOne({
    schoolId,
    "student.studentId": payload.studentId
  });
  if (existing) {
    throw new ApiError(
      409,
      `A character certificate (${existing.certificateNumber}) has already been issued for this student. Use Generate Duplicate to reissue it.`
    );
  }

  const [students, programName] = await Promise.all([
    loadPassedOutStudents(schoolId, { _id: payload.studentId }),
    resolveProgramName(schoolId)
  ]);

  const student = students[0];
  if (!student) {
    throw new ApiError(404, "Only passed-out students can be issued a character certificate");
  }

  const template = payload.templateId
    ? await CharacterCertificateTemplate.findOne({ _id: payload.templateId, schoolId }).lean()
    : null;

  const issueDateBs = payload.issueDateBs || getTodayBs();
  const certificateNumber = await generateCertificateNumber(schoolId);
  const issuedByName = await resolveActorName(req);

  const certificate = await CharacterCertificate.create({
    schoolId,
    certificateNumber,
    student: {
      studentId: student.studentId,
      studentName: student.studentName,
      fatherName: student.fatherName,
      motherName: student.motherName,
      registrationNumber: student.registrationNumber,
      admissionNumber: student.admissionNumber,
      rollNumber: student.rollNumber,
      batchId: student.batchId,
      batchName: student.batchName,
      yearId: student.yearId,
      yearName: student.yearName,
      programName,
      gender: student.gender,
      dateOfBirthBs: student.dateOfBirthBs,
      address: student.address,
      passedOutDateBs: student.passedOutDateBs
    },
    conduct: payload.conduct || DEFAULT_CONDUCT,
    issuances: [
      {
        issueType: "ORIGINAL",
        issueNumber: 1,
        issueDateBs,
        issuedAt: new Date(),
        issuedBy: req.user?.userId,
        issuedByName,
        purpose: payload.purpose ?? "",
        remarks: payload.remarks ?? "",
        resolvedBody: payload.resolvedBody,
        headingText: payload.headingText || template?.headingText || DEFAULT_CHARACTER_CERTIFICATE_HEADING,
        signatoryLabel:
          payload.signatoryLabel || template?.signatoryLabel || DEFAULT_CHARACTER_CERTIFICATE_SIGNATORY,
        affiliationText: payload.affiliationText || template?.affiliationText || "",
        details: pickDetails(payload),
        templateId: template?._id,
        templateName: template?.name ?? ""
      }
    ],
    issueCount: 1,
    originalIssueDateBs: issueDateBs,
    lastIssueDateBs: issueDateBs
  });

  await recordAudit(req, {
    action: "ISSUE_CHARACTER_CERTIFICATE",
    entity: "CharacterCertificate",
    entityId: certificate._id.toString(),
    after: certificate.toObject()
  });

  return sendSuccess(res, `Character certificate ${certificateNumber} issued`, certificate, 201);
});

/**
 * Append a DUPLICATE issuance. The certificate number is unchanged by policy —
 * the duplicate is distinguished by its issuance row and the DUPLICATE mark on
 * the printed document.
 */
export const issueDuplicateCertificate = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const schoolId = tenantObjectId(req);
  const certificateId = String(req.params.certificateId);
  const payload = characterCertificateDuplicateSchema.parse(req.body);

  const certificate = await CharacterCertificate.findOne({ _id: certificateId, schoolId });
  if (!certificate) {
    throw new ApiError(404, "Character certificate not found");
  }

  const latest = certificate.issuances[certificate.issuances.length - 1];
  if (!latest) {
    throw new ApiError(400, "This certificate has no original issuance to duplicate");
  }

  const before = certificate.toObject();
  const issueDateBs = payload.issueDateBs || getTodayBs();
  const issueNumber = certificate.issuances.length + 1;

  /**
   * Guarded on the issueCount we read, so two admins reissuing at the same
   * instant cannot both claim the same issue number — the loser gets a 409 and
   * retries against the updated count.
   */
  const updated = await CharacterCertificate.findOneAndUpdate(
    { _id: certificateId, schoolId, issueCount: certificate.issueCount },
    {
      $push: {
        issuances: {
          issueType: "DUPLICATE",
          issueNumber,
          issueDateBs,
          issuedAt: new Date(),
          issuedBy: req.user?.userId as unknown as Types.ObjectId,
          issuedByName: await resolveActorName(req),
          purpose: payload.purpose ?? "",
          remarks: payload.remarks ?? "",
          // Default to reissuing exactly what was issued last time.
          resolvedBody: payload.resolvedBody?.trim() || latest.resolvedBody,
          headingText: payload.headingText?.trim() || latest.headingText || "",
          signatoryLabel: payload.signatoryLabel?.trim() || latest.signatoryLabel || "",
          affiliationText: payload.affiliationText?.trim() || latest.affiliationText || "",
          // Blanks default to whatever the previous sheet carried.
          details: mergeDetails(latest.details, payload),
          templateId: latest.templateId,
          templateName: latest.templateName ?? ""
        }
      },
      $set: { issueCount: issueNumber, lastIssueDateBs: issueDateBs }
    },
    { new: true }
  );

  if (!updated) {
    throw new ApiError(
      409,
      "This certificate was reissued by someone else a moment ago. Reopen the record and try again."
    );
  }

  await recordAudit(req, {
    action: "ISSUE_DUPLICATE_CHARACTER_CERTIFICATE",
    entity: "CharacterCertificate",
    entityId: certificateId,
    before,
    after: updated.toObject()
  });

  return sendSuccess(
    res,
    `Duplicate certificate ${updated.certificateNumber} recorded (issue no. ${issueNumber})`,
    updated
  );
});

/* ------------------------------------------------------------------ *
 * Records
 * ------------------------------------------------------------------ */

export const listCertificateRecords = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const schoolId = tenantObjectId(req);

  const filter: Record<string, unknown> = { schoolId };
  if (typeof req.query.batchId === "string" && req.query.batchId) {
    filter["student.batchId"] = req.query.batchId;
  }
  if (typeof req.query.certificateNumber === "string" && req.query.certificateNumber.trim()) {
    filter.certificateNumber = {
      $regex: escapeRegex(req.query.certificateNumber.trim()),
      $options: "i"
    };
  }

  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  if (search) {
    const pattern = { $regex: escapeRegex(search), $options: "i" };
    filter.$or = [
      { certificateNumber: pattern },
      { "student.studentName": pattern },
      { "student.registrationNumber": pattern },
      { "student.admissionNumber": pattern },
      { "student.batchName": pattern },
      { "student.programName": pattern }
    ];
  }

  const records = await CharacterCertificate.find(filter).sort({ createdAt: -1 }).lean();

  return sendSuccess(
    res,
    "Certificate records fetched",
    records.map((record) => ({
      ...record,
      _id: record._id.toString(),
      schoolId: record.schoolId.toString()
    }))
  );
});

export const getCertificateRecord = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const schoolId = tenantObjectId(req);
  const certificate = await CharacterCertificate.findOne({
    _id: String(req.params.certificateId),
    schoolId
  }).lean();

  if (!certificate) {
    throw new ApiError(404, "Character certificate not found");
  }

  return sendSuccess(res, "Certificate fetched", certificate);
});

/**
 * Correct an issued certificate in place.
 *
 * Certificates are handed to students, so a typo caught after issue has to be
 * fixable without spending a new certificate number — that number stays with
 * the student for life and is not editable here. Every correction is audited
 * with the full before/after so the register still reconstructs.
 *
 * Only the fields actually supplied are touched; an omitted field keeps what
 * was issued rather than being blanked.
 */
export const updateCertificateRecord = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const schoolId = tenantObjectId(req);
  const certificateId = String(req.params.certificateId);
  const payload = characterCertificateUpdateSchema.parse(req.body);

  const certificate = await CharacterCertificate.findOne({ _id: certificateId, schoolId });
  if (!certificate) {
    throw new ApiError(404, "Character certificate not found");
  }

  const before = certificate.toObject();

  const index = payload.issueNumber
    ? certificate.issuances.findIndex((entry) => entry.issueNumber === payload.issueNumber)
    : certificate.issuances.length - 1;
  const issuance = index >= 0 ? certificate.issuances[index] : undefined;
  if (!issuance) {
    throw new ApiError(404, "Requested issuance not found for this certificate");
  }

  // Record-level fields — these drive the list and search, not the printed body.
  if (payload.studentName !== undefined && payload.studentName !== "") {
    certificate.student.studentName = payload.studentName;
  }
  if (payload.fatherName !== undefined) certificate.student.fatherName = payload.fatherName;
  if (payload.motherName !== undefined) certificate.student.motherName = payload.motherName;
  if (payload.registrationNumber !== undefined) {
    certificate.student.registrationNumber = payload.registrationNumber;
  }
  if (payload.dateOfBirthBs !== undefined) {
    certificate.student.dateOfBirthBs = payload.dateOfBirthBs;
  }
  if (payload.conduct !== undefined) certificate.conduct = payload.conduct;

  // Printed sheet.
  if (payload.resolvedBody) issuance.resolvedBody = payload.resolvedBody;
  if (payload.headingText !== undefined) issuance.headingText = payload.headingText;
  if (payload.signatoryLabel !== undefined) issuance.signatoryLabel = payload.signatoryLabel;
  if (payload.affiliationText !== undefined) issuance.affiliationText = payload.affiliationText;
  if (payload.purpose !== undefined) issuance.purpose = payload.purpose;
  if (payload.remarks !== undefined) issuance.remarks = payload.remarks;
  if (payload.issueDateBs) issuance.issueDateBs = payload.issueDateBs;
  // The stored subdocument requires every blank to be a string, so fill the
  // merged result out rather than letting an untouched key arrive undefined.
  const merged = mergeDetails(issuance.details, pickDetails(payload));
  issuance.details = {
    issueNo: merged.issueNo ?? "",
    courseDuration: merged.courseDuration ?? "",
    programName: merged.programName ?? "",
    studyFromBs: merged.studyFromBs ?? "",
    studyFromAd: merged.studyFromAd ?? "",
    examYearBs: merged.examYearBs ?? "",
    examYearAd: merged.examYearAd ?? "",
    division: merged.division ?? ""
  };

  // Keep the denormalised date columns in step with the issuance just edited.
  if (payload.issueDateBs) {
    if (issuance.issueNumber === 1) certificate.originalIssueDateBs = payload.issueDateBs;
    if (index === certificate.issuances.length - 1) {
      certificate.lastIssueDateBs = payload.issueDateBs;
    }
  }

  certificate.markModified("issuances");
  await certificate.save();

  await recordAudit(req, {
    action: "UPDATE",
    entity: "CharacterCertificate",
    entityId: certificateId,
    before,
    after: {
      ...certificate.toObject(),
      correctedIssueNumber: issuance.issueNumber,
      reason: payload.reason || null
    }
  });

  return sendSuccess(res, "Certificate corrected", certificate);
});

/**
 * Delete a certificate so the student can be issued a fresh one.
 *
 * The student drops back to "Not issued" on the Passed-Out list and can be
 * issued again — with a NEW number. The deleted number is never reissued: it
 * came from an atomic counter that a delete cannot wind back, so the series
 * keeps a permanent gap showing that the number was spent. The audit entry
 * below holds the full before-image of what that number was used for.
 */
export const deleteCertificateRecord = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const schoolId = tenantObjectId(req);
  const certificateId = String(req.params.certificateId);

  const certificate = await CharacterCertificate.findOne({ _id: certificateId, schoolId }).lean();
  if (!certificate) {
    throw new ApiError(404, "Character certificate not found");
  }

  await CharacterCertificate.deleteOne({ _id: certificateId, schoolId });

  await recordAudit(req, {
    action: "DELETE",
    entity: "CharacterCertificate",
    entityId: certificateId,
    before: certificate,
    after: {
      reason: typeof req.query.reason === "string" ? req.query.reason : null
    }
  });

  return sendSuccess(res, "Certificate deleted", {
    certificateId,
    certificateNumber: certificate.certificateNumber
  });
});

/**
 * Print/download a certificate. Read-only: reprinting an existing issuance
 * never mutates the record. `issueNumber` selects which issuance to reproduce
 * and defaults to the most recent one.
 */
export const downloadCertificatePdf = asyncHandler(async (req: Request, res: Response) => {
  await requireCollegeInstitution(req);
  const schoolId = tenantObjectId(req);
  const certificateId = String(req.params.certificateId);

  const certificate = await CharacterCertificate.findOne({ _id: certificateId, schoolId }).lean();

  if (!certificate) {
    throw new ApiError(404, "Character certificate not found");
  }

  // Letterhead follows the template the certificate was issued from, so a
  // reprint reproduces the sheet that was handed over.
  const letterhead = await resolveCertificateLetterhead(
    schoolId,
    certificate.issuances[certificate.issuances.length - 1]?.templateId
  );

  const requested = Number.parseInt(String(req.query.issueNumber ?? ""), 10);
  const issuance = Number.isFinite(requested)
    ? certificate.issuances.find((entry) => entry.issueNumber === requested)
    : certificate.issuances[certificate.issuances.length - 1];

  if (!issuance) {
    throw new ApiError(404, "Requested issuance not found for this certificate");
  }

  const pdfBuffer = await generateCharacterCertificatePdf({
    collegeName: letterhead.collegeName,
    collegeNameNp: letterhead.collegeNameNp,
    collegeAddress: letterhead.collegeAddress,
    collegeLogoDataUri: readCollegeLogoDataUri(),
    affiliationText: issuance.affiliationText || letterhead.affiliationText,
    headingText: issuance.headingText || DEFAULT_CHARACTER_CERTIFICATE_HEADING,
    certificateNumber: certificate.certificateNumber,
    issueNo: issuance.details?.issueNo || undefined,
    body: issuance.resolvedBody,
    studentName: certificate.student.studentName,
    registrationNumber: certificate.student.registrationNumber || undefined,
    admissionNumber: certificate.student.admissionNumber,
    batchName: certificate.student.batchName || undefined,
    yearName: certificate.student.yearName || undefined,
    programName: issuance.details?.programName || certificate.student.programName || undefined,
    passedOutDateBs: certificate.student.passedOutDateBs || undefined,
    conduct: certificate.conduct || undefined,
    purpose: issuance.purpose || undefined,
    remarks: issuance.remarks || undefined,
    issueDateBs: issuance.issueDateBs,
    issuedByName: issuance.issuedByName,
    signatoryLabel: issuance.signatoryLabel || DEFAULT_CHARACTER_CERTIFICATE_SIGNATORY,
    isDuplicate: issuance.issueType === "DUPLICATE",
    issueNumber: issuance.issueNumber,
    printedDateBs: getTodayBs()
  });

  const safeName = certificate.student.studentName.replace(/\s+/g, "-");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="character-certificate-${safeName}-${certificate.certificateNumber}.pdf"`
  );
  return res.send(pdfBuffer);
});
