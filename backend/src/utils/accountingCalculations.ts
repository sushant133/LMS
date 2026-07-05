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
    input.basicSalaryNpr + input.allowancesNpr + input.bonusNpr + input.advanceSalaryNpr;
  const deductions = input.loanDeductionNpr + input.taxNpr + input.otherDeductionsNpr;
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

  let runningDue = 0;
  for (const collection of collections) {
    const totals = calculateFeeTotals({
      previousDueNpr: collection.previousDueNpr ?? runningDue,
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