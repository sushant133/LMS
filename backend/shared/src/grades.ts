import { GRADE_SCALE } from "./constants.js";
import type { GradeSymbol } from "./types.js";

export const getNepalGrade = (percentage: number): { grade: GradeSymbol; gpa: number } => {
  const matched = GRADE_SCALE.find((item) => percentage >= item.minPercentage) ?? GRADE_SCALE[GRADE_SCALE.length - 1]!;

  return {
    grade: matched.symbol,
    gpa: matched.gpa
  };
};
