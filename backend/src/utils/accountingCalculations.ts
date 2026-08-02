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

/** Program years that can hold tuition (covers / fee ledger). */
export const PROGRAM_YEAR_LABELS: Record<number, string> = {
  0: "Entrance",
  1: "1st Year",
  2: "2nd Year",
  3: "3rd Year"
};

/** Years a student can top to earn a topper scholarship (Entrance, 1st, 2nd — not 3rd). */
export const TOPPER_TOPPED_YEAR_OPTIONS = [0, 1, 2] as const;

/** Default covered program year when a student tops the given exam year. */
export const defaultCoversYearFromTopped = (toppedProgramYear: number): number => {
  if (toppedProgramYear === 0) return 1; // Entrance → 1st year free
  if (toppedProgramYear === 1) return 2;
  if (toppedProgramYear === 2) return 3;
  return Math.min(3, Math.max(1, toppedProgramYear + 1));
};

/** True when row is the system admission-plan opening charge (not a real payment). */
export const isOpeningTuitionCharge = (row: Record<string, unknown>): boolean => {
  const receipt = String(row.receiptNumber ?? "");
  const notes = String(row.notes ?? "");
  return (
    receipt.startsWith("OPEN-") ||
    /opening tuition charge/i.test(notes) ||
    (Number(row.amountPaidNpr ?? 0) === 0 &&
      Number(row.currentChargesNpr ?? 0) > 0 &&
      String(row.paymentMethod ?? "") === "OTHER" &&
      String(row.accountantName ?? "") === "System")
  );
};

/**
 * Payment history / receipts list: fee plan rows set at student create are not payments.
 * Year-wise dues still use those rows internally via year1/2/3FeeNpr + OPEN charges.
 */
export const filterOutOpeningTuitionCharges = <T extends Record<string, unknown>>(
  rows: T[]
): T[] => rows.filter((row) => !isOpeningTuitionCharge(row));

export type PlannedYearFees = {
  1?: number;
  2?: number;
  3?: number;
};

/**
 * HA / multi-year fee ledger: paid, scholarship, remaining per program year.
 *
 * Charge basis (avoids double-counting opening plan + payment "fee charged"):
 * 1. Prefer fixed year fee plan on the student (year1/2/3FeeNpr) when set
 * 2. Else opening tuition charge for that year
 * 3. Else sum of ledger charges (legacy)
 *
 * Merit/topper rule: award covering year N zeros remaining when FULL waiver.
 */
export const buildProgramYearFeeSummary = (
  collections: Array<Record<string, unknown>>,
  awards: Array<Record<string, unknown>> = [],
  plannedFees: PlannedYearFees = {}
) => {
  return ([1, 2, 3] as const).map((programYear) => {
    const yearRows = collections.filter((c) => Number(c.programYear) === programYear);
    const openingRows = yearRows.filter((c) => isOpeningTuitionCharge(c));
    const paymentRows = yearRows.filter((c) => !isOpeningTuitionCharge(c));

    const openingChargeNpr = openingRows.reduce(
      (s, c) => s + Number(c.currentChargesNpr ?? 0),
      0
    );
    const paymentChargeNpr = paymentRows.reduce(
      (s, c) => s + Number(c.currentChargesNpr ?? 0),
      0
    );
    // Late fee / fine is not used for student tuition dues
    const lateFeeNpr = 0;

    const plannedNpr = Math.max(0, Number(plannedFees[programYear]) || 0);

    // Fixed year plan is authoritative when set — prevents double-count of
    // opening charge + same amount re-entered as "Fee charged" on payment.
    let baseChargeNpr = 0;
    if (plannedNpr > 0) {
      baseChargeNpr = plannedNpr;
    } else if (openingChargeNpr > 0) {
      // Opening booked the year; only count payment charges ABOVE that opening amount
      baseChargeNpr =
        openingChargeNpr + Math.max(0, paymentChargeNpr - openingChargeNpr);
    } else {
      baseChargeNpr = paymentChargeNpr;
    }

    const chargedNpr = baseChargeNpr + lateFeeNpr;
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
    const hasLedger = yearRows.length > 0 || plannedNpr > 0;
    if (!hasLedger && award) {
      status = "SCHOLARSHIP";
    } else if (!hasLedger) {
      status = "NO_RECORD";
    } else if (award && remainingNpr <= 0) {
      // Scholarship covers this year (full waiver or collections fully offset)
      status = paidNpr > 0 && scholarshipNpr <= 0 ? "PAID" : "SCHOLARSHIP";
    } else if (scholarshipNpr > 0 && paidNpr === 0 && remainingNpr === 0) {
      status = "SCHOLARSHIP";
    } else if (remainingNpr <= 0 && (paidNpr > 0 || scholarshipNpr > 0 || plannedNpr > 0)) {
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
              `Merit scholarship covering ${PROGRAM_YEAR_LABELS[programYear]} (based on year ${award.toppedProgramYear})`
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
    const noteBit = `Merit scholarship applied (year ${params.coversProgramYear})`;
    const prevNotes = String(row.notes || "").trim();
    if (
      !prevNotes.includes("Merit scholarship applied") &&
      !prevNotes.includes("Topper scholarship applied")
    ) {
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
 * Undo merit scholarship amounts written on fee collection rows for a covered year
 * (used when revoking / deleting / re-editing an award).
 */
export const reverseScholarshipAwardFromCollections = async (
  params: {
    schoolId: import("mongoose").Types.ObjectId | string;
    studentId: import("mongoose").Types.ObjectId | string;
    coversProgramYear: number;
    feeCollectionId?: import("mongoose").Types.ObjectId | string | null;
  },
  session?: import("mongoose").ClientSession | null
): Promise<{ reversedNpr: number }> => {
  const { FeeCollection } = await import("../models/FeeCollection.js");

  let reversedNpr = 0;
  const filter: Record<string, unknown> = {
    schoolId: params.schoolId,
    studentId: params.studentId,
    isDeleted: false
  };
  if (params.feeCollectionId) {
    filter._id = params.feeCollectionId;
  } else {
    filter.programYear = params.coversProgramYear;
    filter.scholarshipType = "TOPPER_YEAR_WAIVER";
  }

  const query = FeeCollection.find(filter);
  if (session) query.session(session);
  const rows = await query;

  for (const row of rows) {
    const sch = Number(row.scholarshipNpr ?? 0);
    if (sch <= 0) continue;
    reversedNpr += sch;
    row.scholarshipNpr = 0;
    if (row.scholarshipType === "TOPPER_YEAR_WAIVER") {
      row.scholarshipType = "NONE";
    }
    const totals = calculateFeeTotals({
      previousDueNpr: 0,
      currentChargesNpr: Number(row.currentChargesNpr ?? 0),
      amountPaidNpr: Number(row.amountPaidNpr ?? 0),
      discountNpr: Number(row.discountNpr ?? 0),
      scholarshipNpr: 0,
      lateFeeNpr: Number(row.lateFeeNpr ?? 0)
    });
    row.remainingDueNpr = totals.remainingDueNpr;
    const notes = String(row.notes || "");
    row.notes = notes
      .replace(/;?\s*(Merit|Topper) scholarship applied \(year \d+\)/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    await row.save(session ? { session } : undefined);
  }

  await recalculateStudentFeesDue(params.studentId, params.schoolId, session ?? null);
  return { reversedNpr };
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

/**
 * Zero late fee / fine on all fee collections (late fines are not used for student fees).
 */
const stripAllLateFees = async (
  collections: Array<{
    _id: unknown;
    lateFeeNpr?: number;
  }>,
  session?: import("mongoose").ClientSession | null
): Promise<void> => {
  const { FeeCollection } = await import("../models/FeeCollection.js");
  const dirty = collections.filter((row) => Number(row.lateFeeNpr ?? 0) > 0);
  if (dirty.length === 0) return;
  const ids = dirty.map((row) => row._id);
  const update = FeeCollection.updateMany(
    { _id: { $in: ids } },
    { $set: { lateFeeNpr: 0 } }
  );
  if (session) update.session(session);
  await update;
  for (const row of dirty) {
    row.lateFeeNpr = 0;
  }
};

/**
 * Cap new "fee charged" so year plan / existing OPEN charges are not double-booked.
 */
export const capProgramYearChargesNpr = (params: {
  programYear?: number | null;
  requestedChargesNpr: number;
  priorChargedNpr: number;
  plannedYearFeeNpr: number;
}): number => {
  const requested = Math.max(0, Number(params.requestedChargesNpr) || 0);
  const prior = Math.max(0, Number(params.priorChargedNpr) || 0);
  const planned = Math.max(0, Number(params.plannedYearFeeNpr) || 0);
  const year = Number(params.programYear);
  if (year !== 1 && year !== 2 && year !== 3) {
    return requested;
  }
  if (planned > 0) {
    return Math.min(requested, Math.max(0, planned - prior));
  }
  if (prior > 0) {
    // Year already has ledger charges (e.g. OPEN) — do not restate them on a payment
    return 0;
  }
  return requested;
};

/**
 * Derive outstanding tuition due from year-wise plan + payments (HA).
 * Falls back to chronological replay for non–program-year / legacy rows.
 */
export const recalculateStudentFeesDue = async (
  studentId: import("mongoose").Types.ObjectId | string,
  schoolId: import("mongoose").Types.ObjectId | string,
  session?: import("mongoose").ClientSession | null
): Promise<number> => {
  const { FeeCollection } = await import("../models/FeeCollection.js");
  const { Student } = await import("../models/Student.js");
  const { StudentScholarshipAward } = await import("../models/StudentScholarshipAward.js");

  const studentQuery = Student.findOne({ _id: studentId, schoolId });
  if (session) studentQuery.session(session);
  const student = await studentQuery.lean();
  if (!student) return 0;

  const query = FeeCollection.find({ studentId, schoolId, isDeleted: false }).sort({
    createdAt: 1
  });
  if (session) query.session(session);
  const collections = await query.lean();

  // Clear any stored late fees so tuition dues are plan − paid only
  await stripAllLateFees(collections, session ?? null);

  const awardsQuery = StudentScholarshipAward.find({
    schoolId,
    studentId,
    isDeleted: false,
    status: { $in: ["ACTIVE", "APPLIED"] }
  });
  if (session) awardsQuery.session(session);
  const awards = await awardsQuery.lean();

  const planned: PlannedYearFees = {
    1: Math.max(0, Number((student as { year1FeeNpr?: number }).year1FeeNpr) || 0),
    2: Math.max(0, Number((student as { year2FeeNpr?: number }).year2FeeNpr) || 0),
    3: Math.max(0, Number((student as { year3FeeNpr?: number }).year3FeeNpr) || 0)
  };

  const yearWise = buildProgramYearFeeSummary(
    collections as unknown as Array<Record<string, unknown>>,
    awards as unknown as Array<Record<string, unknown>>,
    planned
  );
  let runningDue = yearWise.reduce((s, y) => s + Number(y.remainingNpr || 0), 0);

  // Legacy / unscoped fee rows (no program year 1–3) — still replay chronologically
  const otherRows = collections.filter((c) => {
    const y = Number(c.programYear);
    return y !== 1 && y !== 2 && y !== 3;
  });
  if (otherRows.length > 0) {
    let otherDue = 0;
    for (const collection of otherRows) {
      const totals = calculateFeeTotals({
        previousDueNpr: otherDue,
        currentChargesNpr: collection.currentChargesNpr ?? 0,
        amountPaidNpr: collection.amountPaidNpr,
        discountNpr: collection.discountNpr ?? 0,
        scholarshipNpr: collection.scholarshipNpr ?? 0,
        lateFeeNpr: 0
      });
      otherDue = totals.remainingDueNpr;
    }
    runningDue += otherDue;
  }

  const updateQuery = Student.findByIdAndUpdate(
    studentId,
    { feesDueNpr: runningDue },
    { new: true }
  );
  if (session) updateQuery.session(session);
  await updateQuery;
  return runningDue;
};