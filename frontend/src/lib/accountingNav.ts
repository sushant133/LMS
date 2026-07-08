export const accountingStudentAccountsUrl = (studentId: string): string =>
  `/accounting?tab=student-accounts&studentId=${encodeURIComponent(studentId)}`;

export const accountingFeeCollectionUrl = (studentId: string): string =>
  `/accounting?tab=fee-collection&studentId=${encodeURIComponent(studentId)}`;