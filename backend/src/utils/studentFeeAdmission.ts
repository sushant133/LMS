import type { ClientSession, Types } from "mongoose";
import { FeeCollection } from "../models/FeeCollection.js";
import { PROGRAM_YEAR_LABELS, recalculateStudentFeesDue } from "./accountingCalculations.js";
import { getTodayBs } from "./nepaliDate.js";
import { getSessionOption } from "./transaction.js";

export type YearFeePlan = {
  year1FeeNpr: number;
  year2FeeNpr: number;
  year3FeeNpr: number;
};

/** Total planned tuition (excludes security deposit). */
export const sumYearFeesNpr = (plan: YearFeePlan): number =>
  Math.max(0, Number(plan.year1FeeNpr) || 0) +
  Math.max(0, Number(plan.year2FeeNpr) || 0) +
  Math.max(0, Number(plan.year3FeeNpr) || 0);

/**
 * Seed opening tuition charges per program year so Accounts / parent year-wise
 * ledger can track paid vs remaining. Safe to call on create; on update only
 * adds years that do not already have a collection row.
 */
export const seedStudentYearFeeCharges = async (params: {
  schoolId: Types.ObjectId | string;
  studentId: Types.ObjectId | string;
  admissionNumber: string;
  plan: YearFeePlan;
  hasScholarship: boolean;
  paidDateBs?: string;
  createdBy: Types.ObjectId | string;
  session?: ClientSession | null;
  /** When true, skip years that already have any fee row. */
  onlyMissingYears?: boolean;
}): Promise<void> => {
  if (params.hasScholarship) return;

  const years: Array<{ programYear: 1 | 2 | 3; amount: number }> = [
    { programYear: 1, amount: Math.max(0, Number(params.plan.year1FeeNpr) || 0) },
    { programYear: 2, amount: Math.max(0, Number(params.plan.year2FeeNpr) || 0) },
    { programYear: 3, amount: Math.max(0, Number(params.plan.year3FeeNpr) || 0) }
  ].filter((y) => y.amount > 0) as Array<{ programYear: 1 | 2 | 3; amount: number }>;

  if (years.length === 0) return;

  const sessionOpt = getSessionOption(params.session ?? null);
  const paidDateBs = (params.paidDateBs || "").trim() || getTodayBs();
  const adm = (params.admissionNumber || "STU").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24);

  let existingYears = new Set<number>();
  if (params.onlyMissingYears) {
    const existingQuery = FeeCollection.find({
      schoolId: params.schoolId,
      studentId: params.studentId,
      isDeleted: false,
      programYear: { $in: [1, 2, 3] }
    }).select("programYear");
    if (params.session) existingQuery.session(params.session);
    const existing = await existingQuery.lean();
    existingYears = new Set(
      existing.map((r) => Number(r.programYear)).filter((n) => n === 1 || n === 2 || n === 3)
    );
  }

  for (const row of years) {
    if (existingYears.has(row.programYear)) continue;
    const label = PROGRAM_YEAR_LABELS[row.programYear] ?? `Year ${row.programYear}`;
    const receiptNumber = `OPEN-${adm}-Y${row.programYear}-${Date.now().toString(36)}`;
    await FeeCollection.create(
      [
        {
          schoolId: params.schoolId,
          studentId: params.studentId,
          receiptNumber,
          paidDateBs,
          programYear: row.programYear,
          previousDueNpr: 0,
          currentChargesNpr: row.amount,
          amountPaidNpr: 0,
          discountNpr: 0,
          scholarshipNpr: 0,
          scholarshipType: "NONE",
          lateFeeNpr: 0,
          remainingDueNpr: row.amount,
          paymentMethod: "OTHER",
          feeBreakdown: [
            {
              feeType: "TUITION",
              title: `${label} tuition (admission plan)`,
              amountNpr: row.amount
            }
          ],
          notes: "Opening tuition charge from student admission fee plan",
          accountantName: "System",
          createdBy: params.createdBy,
          isDeleted: false
        }
      ],
      sessionOpt
    );
  }

  await recalculateStudentFeesDue(params.studentId, params.schoolId, params.session ?? null);
};
