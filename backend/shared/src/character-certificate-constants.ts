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
  "genderPronounLower",
  "genderPossessive",
  "dateOfBirthBs",
  "address",
  "passedOutDateBs",
  "certificateNumber",
  "issueNo",
  "issueDateBs",
  "conduct",
  "courseDuration",
  "studyFromBs",
  "studyFromAd",
  "examYearBs",
  "examYearAd",
  "division",
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
  genderPronoun: "He / She / They",
  genderPronounLower: "he / she / they",
  genderPossessive: "his / her / their",
  dateOfBirthBs: "Date of birth (BS)",
  address: "Address",
  passedOutDateBs: "Passed-out date (BS)",
  certificateNumber: "Certificate number",
  issueNo: "Issue no. (register)",
  issueDateBs: "Issue date (BS)",
  conduct: "Conduct",
  courseDuration: "Course duration",
  studyFromBs: "Studied from (BS)",
  studyFromAd: "Studied from (AD)",
  examYearBs: "Final exam year (BS)",
  examYearAd: "Final exam year (AD)",
  division: "Division",
  purpose: "Purpose",
  remarks: "Remarks",
  collegeName: "Institution name",
  collegeAddress: "Institution address",
  principalName: "Principal name"
};

/** Seeded for a school that has not defined any template yet. */
export const DEFAULT_CHARACTER_CERTIFICATE_TEMPLATE_NAME = "Default Character Certificate";

export const DEFAULT_CHARACTER_CERTIFICATE_HEADING = "CHARACTER CERTIFICATE";

/**
 * Wording of the institution's printed certificate. `**…**` marks the runs the
 * paper form sets in bold; a placeholder with nothing to fill it prints as a
 * dotted blank so the sheet can still be completed by hand.
 */
export const DEFAULT_CHARACTER_CERTIFICATE_BODY = `This is to certify that Mr./Mrs. {{studentName}} Son/Daughter of Mr./Mrs. {{fatherName}} Was a regular student of the {{courseDuration}} **{{program}}** of this technical institute from {{studyFromBs}} B.S. ({{studyFromAd}} A.D.). {{genderPronoun}} appeared in the final examination held in {{examYearBs}} B.S. ({{examYearAd}} A.D.) and was placed in {{division}} Division. According to the institute record {{genderPossessive}} Registration number is {{registrationNumber}} and date of birth is {{dateOfBirthBs}} B.S.

To the best of my knowledge and belief {{genderPronounLower}} bears a **{{conduct}}** moral character. I wish every success in {{genderPossessive}} future.`;

/** Printed under the right-hand signature block. */
export const DEFAULT_CHARACTER_CERTIFICATE_SIGNATORY = "Director/Chairperson";

/**
 * Small print set under the address line on the letterhead. Editable per
 * template, but every certificate carries it unless an admin clears it.
 */
export const DEFAULT_CHARACTER_CERTIFICATE_AFFILIATION = "(Affiliated To CTEVT)";

/**
 * Letterhead identity for the printed certificate.
 *
 * The certificate is a legal document and carries the institution's registered
 * name and full municipal address, which are longer than the short forms used
 * on screen (dashboard, login, report headers). They are seeded onto the
 * default template as overrides rather than pushed into Institution Settings,
 * so changing them affects this document only. Clear an override and the
 * certificate falls back to Institution Settings.
 */
export const DEFAULT_CHARACTER_CERTIFICATE_COLLEGE_NAME =
  "Public Himal Institute Of Technology (Pvt.) Ltd";

export const DEFAULT_CHARACTER_CERTIFICATE_COLLEGE_ADDRESS =
  "Ward 3, Dhangadhimai Municipality, Siraha, Madesh Province";

/** Fixed labels under the first three signature blocks of the printed form. */
export const CHARACTER_CERTIFICATE_SIGNATURE_LABELS = [
  "Prepared by",
  "Checked by",
  "Office Stamp"
] as const;
