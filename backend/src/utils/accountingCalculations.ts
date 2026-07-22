interface FeeCalculationInput {
  previousDueNpr: number;
  currentChargesNpr: number;
  amountPaidNpr: number;
  discountNpr: number;
  scholarshipNpr: number;
  lateFeeNpr: number;
}

export interface FeeCalculationResult {
  remainingDueNpr: number;
  advancePaymentNpr: number;
}

export const calculateFeeTotals = (input: FeeCalculationInput): FeeCalculationResult => {
  const grossDue = input.previousDueNpr + input.currentChargesNpr + input.lateFeeNpr;
  const netDue = Math.max(0, grossDue - input.discountNpr - input.scholarshipNpr);
  const totalPayment = input.amountPaidNpr;

  if (totalPayment >= netDue) {
    return {
      remainingDueNpr: 0,
      advancePaymentNpr: totalPayment - netDue
    };
  }

  return {
    remainingDueNpr: netDue - totalPayment,
    advancePaymentNpr: 0
  };
};

/**
 * Net pay = earnings − deductions.
 * advanceSalaryNpr is treated as advance recovery (deduction), not an earning.
 */
export const calculateNetSalary = (input: {
  basicSalaryNpr: number;
  allowancesNpr: number;
  bonusNpr: number;
  advanceSalaryNpr: number;
  loanDeductionNpr: number;
  taxNpr: number;
  otherDeductionsNpr: number;
}): number => {
  const gross =
    Number(input.basicSalaryNpr || 0) +
    Number(input.allowancesNpr || 0) +
    Number(input.bonusNpr || 0);
  const deductions =
    Number(input.advanceSalaryNpr || 0) +
    Number(input.loanDeductionNpr || 0) +
    Number(input.taxNpr || 0) +
    Number(input.otherDeductionsNpr || 0);
  return Math.max(0, gross - deductions);
};

export const generateReceiptNumber = (prefix: string, sequence: number): string => {
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${String(sequence).padStart(5, "0")}`;
};

export const calculateSuggestedLateFee = (
  outstandingDueNpr: number,
  lateFinePercent: number
): number => {
  if (outstandingDueNpr <= 0 || lateFinePercent <= 0) {
    return 0;
  }
  return Math.round((outstandingDueNpr * lateFinePercent) / 100);
};

export const computeBalanceAfterEntry = (
  previousBalanceNpr: number,
  entryType: "DEBIT" | "CREDIT",
  amountNpr: number
): number =>
  entryType === "CREDIT" ? previousBalanceNpr + amountNpr : previousBalanceNpr - amountNpr;

export const PROGRAM_YEAR_LABELS: Record<number, string> = {
  1: "1st Year",
  2: "2nd Year",
  3: "3rd Year"
};

/**
 * HA / multi-year fee ledger: paid, scholarship, remaining per program year.
 */
export const buildProgramYearFeeSummary = (
  collections: Array<Record<string, unknown>>,
  awards: Array<Record<string, unknown>> = []
) => {
  return ([1, 2, 3] as const).map((programYear) => {
    const yearRows = collections.filter((c) => Number(c.programYear) === programYear);
    const chargedNpr = yearRows.reduce((s, c) => s + Number(c.currentChargesNpr ?? 0), 0);
    const paidNpr = yearRows.reduce((s, c) => s + Number(c.amountPaidNpr ?? 0), 0);
    const scholarshipNpr = yearRows.reduce((s, c) => s + Number(c.scholarshipNpr ?? 0), 0);
    const discountNpr = yearRows.reduce((s, c) => s + Number(c.discountNpr ?? 0), 0);
    const remainingNpr = Math.max(0, chargedNpr - paidNpr - scholarshipNpr - discountNpr);
    const award = awards.find(
      (a) =>
        Number(a.coversProgramYear) === programYear &&
        (a.status === "ACTIVE" || a.status === "APPLIED")
    );
    let status: "PAID" | "PARTIAL" | "DUE" | "SCHOLARSHIP" | "NO_RECORD" = "NO_RECORD";
    if (yearRows.length === 0 && award) {
      status = "SCHOLARSHIP";
    } else if (yearRows.length === 0) {
      status = "NO_RECORD";
    } else if (scholarshipNpr > 0 && paidNpr === 0 && remainingNpr === 0) {
      status = "SCHOLARSHIP";
    } else if (remainingNpr <= 0 && (paidNpr > 0 || scholarshipNpr > 0)) {
      status = "PAID";
    } else if (paidNpr > 0 || scholarshipNpr > 0) {
      status = "PARTIAL";
    } else {
      status = "DUE";
    }
    return {
      programYear,
      label: PROGRAM_YEAR_LABELS[programYear] ?? `Year ${programYear}`,
      chargedNpr,
      paidNpr,
      scholarshipNpr,
      discountNpr,
      remainingNpr,
      status,
      scholarshipNote: award
        ? String(
            award.reason ||
              `Topper scholarship covering ${PROGRAM_YEAR_LABELS[programYear]} (topped year ${award.toppedProgramYear})`
          )
        : undefined
    };
  });
};

/** Replays active fee collections chronologically to derive the correct outstanding balance. */
export const recalculateStudentFeesDue = async (
  studentId: import("mongoose").Types.ObjectId | string,
  schoolId: import("mongoose").Types.ObjectId | string,
  session?: import("mongoose").ClientSession | null
): Promise<number> => {
  const { FeeCollection } = await import("../models/FeeCollection.js");
  const { Student } = await import("../models/Student.js");

  const query = FeeCollection.find({ studentId, schoolId, isDeleted: false }).sort({ createdAt: 1 });
  if (session) query.session(session);
  const collections = await query.lean();

  // Replay chronologically using running balance only (ignore frozen previousDue snapshots)
  let runningDue = 0;
  for (const collection of collections) {
    const totals = calculateFeeTotals({
      previousDueNpr: runningDue,
      currentChargesNpr: collection.currentChargesNpr ?? 0,
      amountPaidNpr: collection.amountPaidNpr,
      discountNpr: collection.discountNpr ?? 0,
      scholarshipNpr: collection.scholarshipNpr ?? 0,
      lateFeeNpr: collection.lateFeeNpr ?? 0
    });
    runningDue = totals.remainingDueNpr;
  }

  const updateQuery = Student.findByIdAndUpdate(studentId, { feesDueNpr: runningDue }, { new: true });
  if (session) updateQuery.session(session);
  await updateQuery;
  return runningDue;
};