/**
 * Character Certificate issuance (Examination Management → College → Passed-Out Students).
 *
 * Numbering policy: a student's certificate keeps ONE certificate number for life.
 * Reprints and duplicates reuse that number and are distinguished by the issuance
 * row (ORIGINAL vs DUPLICATE) plus the DUPLICATE mark printed on the document.
 */

/** Every issuance of a certificate is one of these. The first is always ORIGINAL. */
export const CHARACTER_CERTIFICATE_ISSUE_TYPES = ["ORIGINAL", "DUPLICATE"] as const;

export const CHARACTER_CERTIFICATE_ISSUE_TYPE_LABELS: Record<
  (typeof CHARACTER_CERTIFICATE_ISSUE_TYPES)[number],
  string
> = {
  ORIGINAL: "Original",
  DUPLICATE: "Duplicate"
};

/** Conduct wording offered on the issue form; free text is allowed too. */
export const CHARACTER_CERTIFICATE_CONDUCT_RATINGS = [
  "Excellent",
  "Very Good",
  "Good",
  "Satisfactory"
] as const;

/** Certificate numbers look like CC-2082-00042 (prefix, BS year, per-school counter). */
export const CHARACTER_CERTIFICATE_NUMBER_PREFIX = "CC";

/**
 * Tokens an institution may use in a template body. Resolved from the student
 * profile + issue form at preview/issue time; unknown tokens are left untouched
 * so a typo is visible on the preview instead of silently blanking.
 */
export const CHARACTER_CERTIFICATE_PLACEHOLDERS = [
  "studentName",
  "fatherName",
  "motherName",
  "registrationNumber",
  "admissionNumber",
  "rollNumber",
  "batch",
  "year",
  "program",
  "gender",
  "genderPronoun",
  "genderPossessive",
  "dateOfBirthBs",
  "address",
  "passedOutDateBs",
  "certificateNumber",
  "issueDateBs",
  "conduct",
  "purpose",
  "remarks",
  "collegeName",
  "collegeAddress",
  "principalName"
] as const;

export const CHARACTER_CERTIFICATE_PLACEHOLDER_LABELS: Record<
  (typeof CHARACTER_CERTIFICATE_PLACEHOLDERS)[number],
  string
> = {
  studentName: "Student full name",
  fatherName: "Father's name",
  motherName: "Mother's name",
  registrationNumber: "Registration number",
  admissionNumber: "Admission number",
  rollNumber: "Roll number",
  batch: "Batch",
  year: "Year",
  program: "Program / course",
  gender: "Gender",
  genderPronoun: "he / she / they",
  genderPossessive: "his / her / their",
  dateOfBirthBs: "Date of birth (BS)",
  address: "Address",
  passedOutDateBs: "Passed-out date (BS)",
  certificateNumber: "Certificate number",
  issueDateBs: "Issue date (BS)",
  conduct: "Conduct",
  purpose: "Purpose",
  remarks: "Remarks",
  collegeName: "Institution name",
  collegeAddress: "Institution address",
  principalName: "Principal name"
};

/** Seeded for a school that has not defined any template yet. */
export const DEFAULT_CHARACTER_CERTIFICATE_TEMPLATE_NAME = "Default Character Certificate";

export const DEFAULT_CHARACTER_CERTIFICATE_HEADING = "CHARACTER CERTIFICATE";

export const DEFAULT_CHARACTER_CERTIFICATE_BODY = `This is to certify that {{studentName}}, {{genderPossessive}} father Mr. {{fatherName}} and mother Mrs. {{motherName}}, was a bona fide student of this institution in the {{program}} programme under batch {{batch}}.

{{genderPronoun}} bears registration number {{registrationNumber}} and successfully completed all academic requirements of the programme on {{passedOutDateBs}} B.S.

To the best of our knowledge, {{genderPossessive}} conduct and moral character during the entire period of study in this institution were found to be {{conduct}}.

We wish {{genderPossessive}} every success in future endeavours.`;

export const DEFAULT_CHARACTER_CERTIFICATE_SIGNATORY = "Principal";
