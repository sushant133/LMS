import type { StudentInput, StudentRecord } from "@phit-erp/shared";

export const mapStudentToInput = (student: StudentRecord): StudentInput => ({
  fullName: student.user?.fullName ?? "",
  email: student.user?.email ?? "",
  phone: student.user?.phone ?? "",
  admissionNumber: student.admissionNumber,
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
  ethnicityCategory: student.ethnicityCategory ?? "Other",
  address: student.address,
  fatherName: student.fatherName,
  fatherPhone: student.fatherPhone ?? "",
  motherName: student.motherName,
  motherPhone: student.motherPhone ?? "",
  guardianName: student.guardianName,
  guardianPhone: student.guardianPhone,
  feesDueNpr: student.hasScholarship ? 0 : student.feesDueNpr,
  hasScholarship: Boolean(student.hasScholarship),
  remarks: student.remarks ?? "",
  academicStatus: student.academicStatus ?? "ACTIVE",
  photoUrl: student.photoUrl ?? "",
  documents: student.documents ?? [],
});

export type StudentEditLocationState = {
  student?: StudentRecord;
};
