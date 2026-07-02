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