import type { StudentInput, StudentRecord } from "@phit-erp/shared";

export const mapStudentToInput = (student: StudentRecord): StudentInput => ({
  fullName: student.user?.fullName ?? "",
  email: student.user?.email ?? "",
  phone: student.user?.phone ?? "",
  admissionNumber: student.admissionNumber,
  registrationNumber: student.registrationNumber ?? "",
  rollNumber: student.rollNumber,
  classId: student.classId,
  sectionId: student.sectionId,
  batchId: student.batchId,
  yearId: student.yearId,
  admissionDateBs: student.admissionDateBs,
  dateOfBirthBs: student.dateOfBirthBs,
  gender: student.gender,
  bloodGroup: student.bloodGroup,
  disabilityCategory: student.disabilityCategory ?? "None",
  ethnicityCategory: student.ethnicityCategory,
  religion: student.religion,
  caste: student.caste ?? "",
  address: student.address,
  fatherName: student.fatherName,
  fatherPhone: student.fatherPhone ?? "",
  motherName: student.motherName,
  motherPhone: student.motherPhone ?? "",
  guardianName: student.guardianName,
  guardianPhone: student.guardianPhone,
  feesDueNpr: student.hasScholarship ? 0 : student.feesDueNpr,
  year1FeeNpr: student.year1FeeNpr ?? 0,
  year2FeeNpr: student.year2FeeNpr ?? 0,
  year3FeeNpr: student.year3FeeNpr ?? 0,
  // Form shows planned deposit only — never use held/collected as the plan field
  securityDepositNpr: student.securityDepositWaived
    ? 0
    : Number(student.securityDepositExpectedNpr) || 0,
  securityDepositWaived: Boolean(student.securityDepositWaived),
  hasScholarship: Boolean(student.hasScholarship),
  remarks: student.remarks ?? "",
  academicStatus: student.academicStatus ?? "ACTIVE",
  backCount:
    (student.academicStatus ?? "ACTIVE") === "PENDING_NOT_PASSED"
      ? Math.max(1, Number(student.backCount) || 1)
      : 0,
  photoUrl: student.photoUrl ?? "",
  documents: student.documents ?? [],
});

export type StudentEditLocationState = {
  student?: StudentRecord;
};
