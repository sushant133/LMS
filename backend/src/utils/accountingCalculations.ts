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
 *
 * Topper rule: award covering year N (e.g. topped 1st → covers 2nd) must zero
 * remaining for that year when waiver is FULL — even if only an opening tuition
 * charge exists and no scholarship amount was written on the fee receipt yet.
 */
export const buildProgramYearFeeSummary = (
  collections: Array<Record<string, unknown>>,
  awards: Array<Record<string, unknown>> = []
) => {
  return ([1, 2, 3] as const).map((programYear) => {
    const yearRows = collections.filter((c) => Number(c.programYear) === programYear);
    const chargedNpr = yearRows.reduce(
      (s, c) => s + Number(c.currentChargesNpr ?? 0) + Number(c.lateFeeNpr ?? 0),
      0
    );
    const paidNpr = yearRows.reduce((s, c) => s + Number(c.amountPaidNpr ?? 0), 0);
    let scholarshipNpr = yearRows.reduce((s, c) => s + Number(c.scholarshipNpr ?? 0), 0);
    const discountNpr = yearRows.reduce((s, c) => s + Number(c.discountNpr ?? 0), 0);

    const award = awards.find(
      (a) =>
        Number(a.coversProgramYear) === programYear &&
        (a.status === "ACTIVE" || a.status === "APPLIED")
    );

    // Credit active/applied awards so year-wise "Due" reflects scholarship allotment.
    if (award) {
      const afterBase = Math.max(0, chargedNpr - paidNpr - discountNpr - scholarshipNpr);
      const waiverType = String(award.waiverType || "FULL").toUpperCase();
      if (waiverType === "FULL") {
        // Full year waiver → remaining must be zero for this program year.
        scholarshipNpr += afterBase;
      } else if (afterBase > 0) {
        // Partial: credit remaining award amount not already on fee receipts.
        const awardAmt = Math.max(0, Number(award.amountNpr) || 0);
        const stillNeeded = Math.max(0, awardAmt - scholarshipNpr);
        scholarshipNpr += Math.min(stillNeeded, afterBase);
      }
    }

    const remainingNpr = Math.max(0, chargedNpr - paidNpr - scholarshipNpr - discountNpr);

    let status: "PAID" | "PARTIAL" | "DUE" | "SCHOLARSHIP" | "NO_RECORD" = "NO_RECORD";
    if (yearRows.length === 0 && award) {
      status = "SCHOLARSHIP";
    } else if (yearRows.length === 0) {
      status = "NO_RECORD";
    } else if (award && remainingNpr <= 0) {
      // Scholarship covers this year (full waiver or collections fully offset)
      status = paidNpr > 0 && scholarshipNpr <= 0 ? "PAID" : "SCHOLARSHIP";
    } else if (scholarshipNpr > 0 && paidNpr === 0 && remainingNpr === 0) {
      status = "SCHOLARSHIP";
    } else if (remainingNpr <= 0 && (paidNpr > 0 || scholarshipNpr > 0)) {
      status = "PAID";
    } else if (paidNpr > 0 || scholarshipNpr > 0 || award) {
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

/**
 * Apply a topper (or other) scholarship award onto fee collection rows for the
 * covered program year so ledger balances and student.feesDueNpr stay correct.
 * FULL waiver zeros remaining on that year's charge rows.
 */
export const applyScholarshipAwardToYearCollections = async (
  params: {
    schoolId: import("mongoose").Types.ObjectId | string;
    studentId: import("mongoose").Types.ObjectId | string;
    coversProgramYear: number;
    waiverType?: string;
    amountNpr?: number;
    awardId?: import("mongoose").Types.ObjectId | string;
    scholarshipType?: string;
  },
  session?: import("mongoose").ClientSession | null
): Promise<{ appliedNpr: number; collectionIds: string[] }> => {
  const { FeeCollection } = await import("../models/FeeCollection.js");

  const query = FeeCollection.find({
    schoolId: params.schoolId,
    studentId: params.studentId,
    programYear: params.coversProgramYear,
    isDeleted: false
  }).sort({ createdAt: 1 });
  if (session) query.session(session);
  const rows = await query;

  if (!rows.length) {
    return { appliedNpr: 0, collectionIds: [] };
  }

  const waiverType = String(params.waiverType || "FULL").toUpperCase();
  let budget =
    waiverType === "FULL"
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Number(params.amountNpr) || 0);
  let appliedNpr = 0;
  const collectionIds: string[] = [];

  for (const row of rows) {
    if (budget <= 0) break;
    const charges =
      Number(row.currentChargesNpr ?? 0) + Number(row.lateFeeNpr ?? 0);
    const paid = Number(row.amountPaidNpr ?? 0);
    const discount = Number(row.discountNpr ?? 0);
    const existingSch = Number(row.scholarshipNpr ?? 0);
    const open = Math.max(0, charges - paid - discount - existingSch);
    if (open <= 0) continue;

    const credit = waiverType === "FULL" ? open : Math.min(open, budget);
    row.scholarshipNpr = existingSch + credit;
    if (!row.scholarshipType || row.scholarshipType === "NONE") {
      row.scholarshipType = (params.scholarshipType ||
        "TOPPER_YEAR_WAIVER") as typeof row.scholarshipType;
    }
    const totals = calculateFeeTotals({
      previousDueNpr: 0,
      currentChargesNpr: Number(row.currentChargesNpr ?? 0),
      amountPaidNpr: paid,
      discountNpr: discount,
      scholarshipNpr: Number(row.scholarshipNpr ?? 0),
      lateFeeNpr: Number(row.lateFeeNpr ?? 0)
    });
    row.remainingDueNpr = totals.remainingDueNpr;
    const noteBit = `Topper scholarship applied (year ${params.coversProgramYear})`;
    const prevNotes = String(row.notes || "").trim();
    if (!prevNotes.includes("Topper scholarship applied")) {
      row.notes = prevNotes ? `${prevNotes}; ${noteBit}` : noteBit;
    }
    await row.save(session ? { session } : undefined);
    appliedNpr += credit;
    collectionIds.push(row._id.toString());
    if (waiverType !== "FULL") budget -= credit;
  }

  await recalculateStudentFeesDue(params.studentId, params.schoolId, session ?? null);
  return { appliedNpr, collectionIds };
};

/**
 * For ACTIVE topper awards not yet written onto fee rows, apply them now
 * (repairs students awarded before ledger auto-apply existed).
 */
export const ensureActiveScholarshipAwardsApplied = async (params: {
  schoolId: import("mongoose").Types.ObjectId | string;
  studentId: import("mongoose").Types.ObjectId | string;
  awards: Array<Record<string, unknown>>;
}): Promise<Array<Record<string, unknown>>> => {
  const { StudentScholarshipAward } = await import("../models/StudentScholarshipAward.js");
  const next = [...params.awards];

  for (let i = 0; i < next.length; i += 1) {
    const award = next[i];
    if (!award) continue;
    if (String(award.status) !== "ACTIVE") continue;
    if (String(award.isDeleted) === "true") continue;

    const covers = Number(award.coversProgramYear);
    if (![1, 2, 3].includes(covers)) continue;

    const applied = await applyScholarshipAwardToYearCollections({
      schoolId: params.schoolId,
      studentId: params.studentId,
      coversProgramYear: covers,
      waiverType: String(award.waiverType || "FULL"),
      amountNpr: Number(award.amountNpr) || 0,
      awardId: award._id ? String(award._id) : undefined,
      scholarshipType: "TOPPER_YEAR_WAIVER"
    });

    if (applied.appliedNpr > 0 && award._id) {
      await StudentScholarshipAward.updateOne(
        { _id: award._id },
        {
          $set: {
            status: "APPLIED",
            ...(applied.collectionIds[0]
              ? { feeCollectionId: applied.collectionIds[0] }
              : {}),
            ...(!Number(award.amountNpr) && applied.appliedNpr
              ? { amountNpr: applied.appliedNpr }
              : {})
          }
        }
      );
      next[i] = {
        ...award,
        status: "APPLIED",
        amountNpr: Number(award.amountNpr) || applied.appliedNpr
      };
    }
  }

  return next;
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