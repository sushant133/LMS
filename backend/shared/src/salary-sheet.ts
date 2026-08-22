import type { TeacherPaymentType } from "./types.js";
import { normalizeTeacherPaymentType } from "./constants.js";

export const roundSalaryNpr = (n: number): number => Math.round(n * 100) / 100;

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

export const calculateTenderThisMonthNpr = (
  tenderAmountNpr: number,
  syllabusCompletedPercent: number,
  alreadyPaidNpr: number
): number => {
  const contract = Math.max(0, Number(tenderAmountNpr) || 0);
  const percent = Math.min(100, Math.max(0, Number(syllabusCompletedPercent) || 0));
  const earned = roundSalaryNpr((percent / 100) * contract);
  return roundSalaryNpr(Math.max(0, earned - Math.max(0, Number(alreadyPaidNpr) || 0)));
};

const applyTax = (
  salaryAmountNpr: number,
  extra: {
    perDaySalaryNpr: number;
    absentDeductionNpr: number;
    extraAmountNpr: number;
  }
): SalarySheetCalcResult => {
  const salary = roundSalaryNpr(Math.max(0, salaryAmountNpr));
  const tax1PercentNpr = roundSalaryNpr(salary * 0.01);
  return {
    perDaySalaryNpr: extra.perDaySalaryNpr,
    absentDeductionNpr: extra.absentDeductionNpr,
    extraAmountNpr: extra.extraAmountNpr,
    salaryAmountNpr: salary,
    tax1PercentNpr,
    netSalaryNpr: roundSalaryNpr(Math.max(0, salary - tax1PercentNpr))
  };
};

/**
 * Monthly: (monthly − absence/leave × per-day) + extra duty.
 * Period: periods attended × rate + extra periods × rate.
 * Tender: syllabus-earned amount this month + optional extra amount (no day deduction).
 */
export const calculateSalarySheetLine = (input: SalarySheetCalcInput): SalarySheetCalcResult => {
  const paymentType = normalizeTeacherPaymentType(input.paymentType);
  const extraDuty = Math.max(0, Number(input.extraDuty) || 0);
  const extraOverride =
    input.extraAmountOverrideNpr !== undefined && input.extraAmountOverrideNpr !== null
      ? roundSalaryNpr(Math.max(0, Number(input.extraAmountOverrideNpr) || 0))
      : undefined;

  if (paymentType === "PERIOD") {
    const rate = Math.max(
      0,
      Number(input.periodRateNpr ?? input.monthlySalaryNpr) || 0
    );
    const periods = Math.max(0, Number(input.periodsAttended) || 0);
    const extraAmountNpr = extraOverride !== undefined ? extraOverride : roundSalaryNpr(rate * extraDuty);
    const salaryAmountNpr = roundSalaryNpr(periods * rate + extraAmountNpr);
    return applyTax(salaryAmountNpr, {
      perDaySalaryNpr: roundSalaryNpr(rate),
      absentDeductionNpr: 0,
      extraAmountNpr
    });
  }

  if (paymentType === "TENDER") {
    const tenderThisMonthNpr = Math.max(0, Number(input.tenderThisMonthNpr) || 0);
    const extraAmountNpr = extraOverride !== undefined ? extraOverride : 0;
    const salaryAmountNpr = roundSalaryNpr(tenderThisMonthNpr + extraAmountNpr);
    return applyTax(salaryAmountNpr, {
      perDaySalaryNpr: 0,
      absentDeductionNpr: 0,
      extraAmountNpr
    });
  }

  const days = Math.max(1, Number(input.workingDaysInMonth) || 30);
  const monthly = Math.max(0, Number(input.monthlySalaryNpr) || 0);
  const leave = Math.max(0, Number(input.leaveDays) || 0);
  const deducted = Math.min(deductedAttendanceDays(input.absentDays, leave), days);
  const perDay = monthly / days;
  const absentDeductionNpr = roundSalaryNpr(perDay * deducted);
  const extraAmountNpr =
    extraOverride !== undefined ? extraOverride : roundSalaryNpr(perDay * extraDuty);
  const salaryAmountNpr = roundSalaryNpr(Math.max(0, monthly - absentDeductionNpr + extraAmountNpr));
  return applyTax(salaryAmountNpr, {
    perDaySalaryNpr: roundSalaryNpr(perDay),
    absentDeductionNpr,
    extraAmountNpr
  });
};
