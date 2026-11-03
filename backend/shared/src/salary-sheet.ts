import type { TeacherPaymentType } from "./types.js";
import { normalizeTeacherPaymentType } from "./constants.js";

/**
 * Money as whole paisa (integers). Uses the decimal text of the number ("1.005e2"), so
 * amounts like 1.005 round to 1.01 instead of drifting to 1.00 through binary floating point.
 */
export const toPaisa = (npr: number): number => {
  const n = Number(npr) || 0;
  const abs = Math.abs(n);
  const text = String(abs);
  const shifted = text.includes("e") ? abs * 100 : Number(`${text}e2`);
  return (n < 0 ? -1 : 1) * Math.round(shifted);
};

export const fromPaisa = (paisa: number): number => Math.round(paisa) / 100;

/** Round money to 2 decimals (via integer paisa). */
export const roundSalaryNpr = (n: number): number => fromPaisa(toPaisa(n));

export type SalarySheetPaymentType = TeacherPaymentType;

export type SalarySheetCalcInput = {
  /** Staff and unspecified teachers are monthly. */
  paymentType?: SalarySheetPaymentType | string;
  monthlySalaryNpr: number;
  presentDays: number;
  absentDays: number;
  leaveDays?: number;
  extraDuty: number;
  workingDaysInMonth: number;
  /**
   * Calendar days in the BS month (29–32). Monthly per-day salary =
   * monthly ÷ calendar days. Falls back to workingDaysInMonth when absent.
   */
  calendarDaysInMonth?: number;
  /** When set, use instead of extraDuty * per-unit rate */
  extraAmountOverrideNpr?: number;
  periodRateNpr?: number;
  periodsAttended?: number;
  /** Earned this month from syllabus tenders (already net of prior payments). */
  tenderThisMonthNpr?: number;
};

export type SalarySheetCalcResult = {
  perDaySalaryNpr: number;
  absentDeductionNpr: number;
  extraAmountNpr: number;
  salaryAmountNpr: number;
  tax1PercentNpr: number;
  /** Net rounded to the nearest rupee: Net − (Salary amount − Tax). */
  roundingNpr: number;
  netSalaryNpr: number;
};

/** Present + absent + leave should equal working days (unrecorded working days are paid as present). */
export const paidPresentDays = (
  workingDaysInMonth: number,
  absentDays: number,
  leaveDays: number
): number => {
  const days = Math.max(1, Number(workingDaysInMonth) || 30);
  const deducted = Math.max(0, Number(absentDays) || 0) + Math.max(0, Number(leaveDays) || 0);
  return roundSalaryNpr(Math.max(0, days - Math.min(deducted, days)));
};

export const deductedAttendanceDays = (absentDays: number, leaveDays: number): number =>
  Math.max(0, Number(absentDays) || 0) + Math.max(0, Number(leaveDays) || 0);

export const clampSyllabusPercent = (n: number): number =>
  Math.min(100, Math.max(0, Number(n) || 0));

export type TenderProgressCalc = {
  syllabusCompletedPercent: number;
  syllabusAlreadyPaidPercent: number;
  syllabusThisMonthPercent: number;
  syllabusRemainingPercent: number;
  tenderAlreadyPaidNpr: number;
  tenderThisMonthNpr: number;
};

/**
 * Fair tender instalment: pay only the new syllabus % since the last payment.
 * Example: paid at 14% complete, now 33% complete → this month 19% (33 − 14).
 */
export const calculateTenderProgress = (input: {
  tenderAmountNpr: number;
  syllabusCompletedPercent: number;
  syllabusAlreadyPaidPercent: number;
}): TenderProgressCalc => {
  const contract = Math.max(0, Number(input.tenderAmountNpr) || 0);
  const completed = roundSalaryNpr(clampSyllabusPercent(input.syllabusCompletedPercent));
  const alreadyPaidPercent = roundSalaryNpr(
    Math.min(completed, clampSyllabusPercent(input.syllabusAlreadyPaidPercent))
  );
  const thisMonthPercent = roundSalaryNpr(Math.max(0, completed - alreadyPaidPercent));
  const remainingPercent = roundSalaryNpr(Math.max(0, 100 - completed));
  return {
    syllabusCompletedPercent: completed,
    syllabusAlreadyPaidPercent: alreadyPaidPercent,
    syllabusThisMonthPercent: thisMonthPercent,
    syllabusRemainingPercent: remainingPercent,
    tenderAlreadyPaidNpr: roundSalaryNpr((alreadyPaidPercent / 100) * contract),
    tenderThisMonthNpr: roundSalaryNpr((thisMonthPercent / 100) * contract)
  };
};

export const formatTenderPayBreakdown = (
  progress: TenderProgressCalc,
  subjectNotes?: string
): string => {
  const core = [
    `completed ${progress.syllabusCompletedPercent}%`,
    `already paid ${progress.syllabusAlreadyPaidPercent}%`,
    `this month ${progress.syllabusThisMonthPercent}% of Rs ${progress.tenderThisMonthNpr.toLocaleString("en-NP")}`,
    `remaining ${progress.syllabusRemainingPercent}%`
  ].join(" · ");
  return subjectNotes ? `${subjectNotes} · ${core}` : core;
};

/** NPR for this month from completed % minus already-paid % (or legacy already-paid NPR). */
export const calculateTenderThisMonthNpr = (
  tenderAmountNpr: number,
  syllabusCompletedPercent: number,
  alreadyPaidNprOrPercent: number,
  alreadyPaidIsPercent = false
): number => {
  const contract = Math.max(0, Number(tenderAmountNpr) || 0);
  const alreadyPaidPercent = alreadyPaidIsPercent
    ? Number(alreadyPaidNprOrPercent) || 0
    : contract > 0
      ? ((Math.max(0, Number(alreadyPaidNprOrPercent) || 0) / contract) * 100)
      : 0;
  return calculateTenderProgress({
    tenderAmountNpr: contract,
    syllabusCompletedPercent,
    syllabusAlreadyPaidPercent: alreadyPaidPercent
  }).tenderThisMonthNpr;
};

/**
 * Net salary is paid in whole rupees: rounded half-up to the nearest rupee. The difference
 * (−0.50 … +0.49) is shown as the "Rounding" line, so
 * Salary amount − 1% tax + Rounding = Net salary.
 */
export const roundNetSalaryToRupee = (
  netBeforeRoundingNpr: number
): { netSalaryNpr: number; roundingNpr: number } => {
  const before = Math.max(0, toPaisa(netBeforeRoundingNpr));
  const net = Math.round(before / 100) * 100;
  return { netSalaryNpr: fromPaisa(net), roundingNpr: fromPaisa(net - before) };
};

/** Rounding of a saved salary row: Net − (Salary amount − Tax). */
export const salaryRoundingNpr = (row: {
  salaryAmountNpr?: number;
  tax1PercentNpr?: number;
  netSalaryNpr?: number;
}): number =>
  fromPaisa(
    toPaisa(row.netSalaryNpr ?? 0) - (toPaisa(row.salaryAmountNpr ?? 0) - toPaisa(row.tax1PercentNpr ?? 0))
  );

/** 1% SST / TDS on the month's salary amount, rounded half-up to the paisa (in paisa). */
const tax1PercentPaisa = (salaryPaisa: number): number => Math.round(salaryPaisa / 100);

const applyTax = (
  salaryPaisa: number,
  extra: {
    perDayPaisa: number;
    absentDeductionPaisa: number;
    extraAmountPaisa: number;
  }
): SalarySheetCalcResult => {
  const salary = Math.max(0, Math.round(salaryPaisa));
  const tax = tax1PercentPaisa(salary);
  const { netSalaryNpr, roundingNpr } = roundNetSalaryToRupee(fromPaisa(salary - tax));
  return {
    perDaySalaryNpr: fromPaisa(extra.perDayPaisa),
    absentDeductionNpr: fromPaisa(extra.absentDeductionPaisa),
    extraAmountNpr: fromPaisa(extra.extraAmountPaisa),
    salaryAmountNpr: fromPaisa(salary),
    tax1PercentNpr: fromPaisa(tax),
    roundingNpr,
    netSalaryNpr
  };
};

/**
 * One salary line, computed in whole paisa (integers) so nothing drifts by floating-point error.
 * Monthly: absent deduction = monthly × deducted days ÷ calendar days of the BS month (rounded
 *          once, e.g. 23,000 × 1 ÷ 31 = 741.94); extra duty is paid the same way.
 * Period: periods attended × rate + extra periods × rate.
 * Tender: syllabus-earned amount this month + optional extra amount (no day deduction).
 * Then 1% tax on the salary amount, and the net is rounded to the nearest rupee.
 */
export const calculateSalarySheetLine = (input: SalarySheetCalcInput): SalarySheetCalcResult => {
  const paymentType = normalizeTeacherPaymentType(input.paymentType);
  const extraDuty = Math.max(0, Number(input.extraDuty) || 0);
  const extraOverridePaisa =
    input.extraAmountOverrideNpr !== undefined && input.extraAmountOverrideNpr !== null
      ? Math.max(0, toPaisa(Number(input.extraAmountOverrideNpr) || 0))
      : undefined;

  if (paymentType === "PERIOD") {
    const rate = Math.max(0, toPaisa(Number(input.periodRateNpr ?? input.monthlySalaryNpr) || 0));
    const periods = Math.max(0, Number(input.periodsAttended) || 0);
    const extraAmountPaisa = extraOverridePaisa ?? Math.round(rate * extraDuty);
    return applyTax(Math.round(rate * periods) + extraAmountPaisa, {
      perDayPaisa: rate,
      absentDeductionPaisa: 0,
      extraAmountPaisa
    });
  }

  if (paymentType === "TENDER") {
    const tenderThisMonth = Math.max(0, toPaisa(Number(input.tenderThisMonthNpr) || 0));
    const extraAmountPaisa = extraOverridePaisa ?? 0;
    return applyTax(tenderThisMonth + extraAmountPaisa, {
      perDayPaisa: 0,
      absentDeductionPaisa: 0,
      extraAmountPaisa
    });
  }

  const days = Math.max(1, Number(input.workingDaysInMonth) || 30);
  const perDayDivisor = Math.max(1, Number(input.calendarDaysInMonth) || days);
  const monthly = Math.max(0, toPaisa(Number(input.monthlySalaryNpr) || 0));
  const leave = Math.max(0, Number(input.leaveDays) || 0);
  const deducted = Math.min(deductedAttendanceDays(input.absentDays, leave), days);
  const absentDeductionPaisa = Math.round((monthly * deducted) / perDayDivisor);
  const extraAmountPaisa = extraOverridePaisa ?? Math.round((monthly * extraDuty) / perDayDivisor);
  return applyTax(Math.max(0, monthly - absentDeductionPaisa + extraAmountPaisa), {
    perDayPaisa: Math.round(monthly / perDayDivisor),
    absentDeductionPaisa,
    extraAmountPaisa
  });
};
