import type {
  CHARACTER_CERTIFICATE_ISSUE_TYPES,
  CHARACTER_CERTIFICATE_PLACEHOLDERS
} from "./character-certificate-constants.js";

export type CharacterCertificateIssueType = (typeof CHARACTER_CERTIFICATE_ISSUE_TYPES)[number];
export type CharacterCertificatePlaceholder = (typeof CHARACTER_CERTIFICATE_PLACEHOLDERS)[number];

/**
 * Values the printed form leaves blank for the office to complete. Stored per
 * issuance so a reprint reproduces the sheet that was handed over.
 */
export interface CharacterCertificateDetails {
  issueNo?: string;
  courseDuration?: string;
  programName?: string;
  studyFromBs?: string;
  studyFromAd?: string;
  examYearBs?: string;
  examYearAd?: string;
  division?: string;
}

/** An institution-defined template body with {{token}} placeholders. */
export interface CharacterCertificateTemplateRecord {
  _id: string;
  schoolId: string;
  name: string;
  headingText: string;
  bodyTemplate: string;
  signatoryLabel: string;
  /** Small print under the address line, e.g. "(Affiliated To CTEVT)". */
  affiliationText?: string;
  /** Letterhead overrides for the certificate; blank falls back to Institution Settings. */
  collegeNameOverride?: string;
  collegeAddressOverride?: string;
  /** Used when the issue form does not pick a template explicitly. */
  isDefault: boolean;
  isActive: boolean;
  createdBy?: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * One issuance event. The first is ORIGINAL; every later one is a DUPLICATE.
 * Rows are append-only — reprinting an existing issuance never adds a row.
 */
export interface CharacterCertificateIssuanceRecord {
  issueType: CharacterCertificateIssueType;
  /** 1-based; matches "Issue Count (Original/Duplicate)" on the records list. */
  issueNumber: number;
  issueDateBs: string;
  issuedAt: string;
  issuedBy: string;
  issuedByName: string;
  purpose?: string;
  remarks?: string;
  /** Body as printed for this issuance — kept so a reprint is byte-identical. */
  resolvedBody: string;
  headingText: string;
  signatoryLabel: string;
  affiliationText?: string;
  /** The blanks the office filled in for this issuance. */
  details?: CharacterCertificateDetails;
  templateId?: string;
  templateName?: string;
}

/** Student details frozen at first issue so later profile edits cannot rewrite history. */
export interface CharacterCertificateStudentSnapshot {
  studentId: string;
  studentName: string;
  fatherName?: string;
  motherName?: string;
  registrationNumber?: string;
  admissionNumber: string;
  rollNumber?: number;
  batchId?: string;
  batchName?: string;
  yearId?: string;
  yearName?: string;
  programName?: string;
  gender?: string;
  dateOfBirthBs?: string;
  address?: string;
  passedOutDateBs?: string;
}

export interface CharacterCertificateRecord {
  _id: string;
  schoolId: string;
  certificateNumber: string;
  student: CharacterCertificateStudentSnapshot;
  conduct: string;
  issuances: CharacterCertificateIssuanceRecord[];
  /** Denormalised issuances.length — drives the Issue Count column and duplicate numbering. */
  issueCount: number;
  originalIssueDateBs: string;
  lastIssueDateBs: string;
  createdAt?: string;
  updatedAt?: string;
}

/** A row in the Passed-Out Students list. */
export interface PassedOutStudentRecord {
  studentId: string;
  studentName: string;
  registrationNumber?: string;
  admissionNumber: string;
  rollNumber?: number;
  batchId?: string;
  batchName?: string;
  yearId?: string;
  yearName?: string;
  programName?: string;
  academicStatus: string;
  passedOutDateBs?: string;
  /** Present once a certificate exists for this student. */
  certificateNumber?: string;
  certificateId?: string;
  issueCount: number;
  lastIssueDateBs?: string;
}

/** Resolved token values handed to the template renderer. */
export type CharacterCertificateTokenMap = Partial<
  Record<CharacterCertificatePlaceholder, string>
>;
