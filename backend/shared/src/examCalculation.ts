import { getNepalGrade } from "./grades.js";
import type { ExamPassFailStatus, GradeSymbol, ResultSubjectMarkInput } from "./types.js";

export const computeObtainedMarks = (mark: Pick<ResultSubjectMarkInput, "theoryMarks" | "practicalMarks" | "internalMarks" | "attendanceStatus">): number => {
  if (mark.attendanceStatus === "ABSENT") {
    return 0;
  }

  return (mark.theoryMarks ?? 0) + (mark.practicalMarks ?? 0) + (mark.internalMarks ?? 0);
};

export const computeSubjectMark = (
  mark: ResultSubjectMarkInput
): ResultSubjectMarkInput & {
  obtainedMarks: number;
  percentage: number;
  grade: GradeSymbol;
  passFail: ExamPassFailStatus;
} => {
  const obtainedMarks = computeObtainedMarks(mark);
  const percentage = mark.fullMarks > 0 ? Number(((obtainedMarks / mark.fullMarks) * 100).toFixed(2)) : 0;
  const { grade } = getNepalGrade(percentage);
  const passFail: ExamPassFailStatus = obtainedMarks >= mark.passMarks ? "PASS" : "FAIL";

  return {
    ...mark,
    obtainedMarks,
    percentage,
    grade,
    passFail
  };
};

export const computeResultSummary = (
  marks: Array<{
    obtainedMarks: number;
    fullMarks: number;
    passFail: ExamPassFailStatus;
  }>
): {
  percentage: number;
  gpa: number;
  grade: GradeSymbol;
  passFailStatus: ExamPassFailStatus;
  totalObtained: number;
  totalFull: number;
} => {
  const totalObtained = marks.reduce((sum, mark) => sum + mark.obtainedMarks, 0);
  const totalFull = marks.reduce((sum, mark) => sum + mark.fullMarks, 0);
  const percentage = totalFull > 0 ? Number(((totalObtained / totalFull) * 100).toFixed(2)) : 0;
  const { grade, gpa } = getNepalGrade(percentage);
  const passFailStatus: ExamPassFailStatus = marks.length > 0 && marks.every((mark) => mark.passFail === "PASS") ? "PASS" : "FAIL";

  return {
    percentage,
    gpa,
    grade,
    passFailStatus,
    totalObtained,
    totalFull
  };
};