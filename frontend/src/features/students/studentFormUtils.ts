import type { StudentInput, StudentRecord } from "@phit-erp/shared";

export const mapStudentToInput = (student: StudentRecord): StudentInput => ({
  fullName: student.user.fullName,
  email: student.user.email,
  phone: student.user.phone ?? "",
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
  address: student.address,
  fatherName: student.fatherName,
  fatherPhone: student.fatherPhone ?? "",
  motherName: student.motherName,
  motherPhone: student.motherPhone ?? "",
  guardianName: student.guardianName,
  guardianPhone: student.guardianPhone,
  feesDueNpr: student.feesDueNpr,
  remarks: student.remarks ?? "",
  academicStatus: student.academicStatus ?? "ACTIVE",
  photoUrl: student.photoUrl ?? "",
  documents: student.documents ?? []
});

export type StudentEditLocationState = {
  student?: StudentRecord;
};