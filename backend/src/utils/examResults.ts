import { computeResultSummary } from "@phit-erp/shared";
import type { ExamDocument } from "../models/Exam.js";
import { compareBsDates, getTodayBs } from "./nepaliDate.js";

export const buildResultTotals = (
  marks: Array<{ obtainedMarks: number; fullMarks: number; passFail: "PASS" | "FAIL" }>
) => computeResultSummary(marks);

export const canViewPublishedResults = (exam: Pick<ExamDocument, "resultsPublished" | "resultPublishDateBs">): boolean => {
  if (!exam.resultsPublished) {
    return false;
  }

  if (!exam.resultPublishDateBs) {
    return true;
  }

  return compareBsDates(exam.resultPublishDateBs, getTodayBs()) <= 0;
};