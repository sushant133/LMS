/**
 * Library overdue fines (students).
 *
 * Model (as in library systems such as Koha): a fine per day, optional grace
 * days and an optional cap per book. Charging starts the day after the due
 * date (after grace) and stops on the day the book is returned. While a book
 * is out the fine is worked out from today's date on every read, so it is
 * always current and a rate change applies at once; on return it is fixed on
 * the loan and stays OUTSTANDING until the Administrator records it as paid
 * or waived.
 */
import type { Types } from "mongoose";
import { LibraryFineSettings } from "../models/LibraryFineSettings.js";
import { LibraryIssue } from "../models/LibraryBook.js";
import { Student } from "../models/Student.js";
import { compareBsDates, countInclusiveBsDays, getOffsetFromBsDate, getTodayBs } from "./nepaliDate.js";
import { notifyParentsOfStudent, sendNotification } from "./notificationService.js";

export type LibraryFineRules = {
  enabled: boolean;
  finePerDayNpr: number;
  graceDays: number;
  maxFinePerBookNpr: number;
  chargeFromBs: string;
  /** studentId → own daily rate (0 = exempt) */
  studentRates: Map<string, number>;
  /** studentId → rate from their batch / batch-year rule */
  groupStudentRates: Map<string, { rate: number; yearSpecific: boolean }>;
};

/** Where a student's daily rate comes from. */
export type LibraryFineRateSource = "STUDENT" | "BATCH_YEAR" | "BATCH" | "ALL";

export type LibraryFineStatus = "NONE" | "ACCRUING" | "OUTSTANDING" | "PAID" | "WAIVED";

export type LibraryIssueFine = {
  amountNpr: number;
  ratePerDayNpr: number;
  /** Days actually charged (after grace / charge-from date, capped or not). */
  daysCharged: number;
  /** Calendar days past the due date (for display). */
  daysOverdue: number;
  /** True while the book is still out and fines are on. */
  accruing: boolean;
  status: LibraryFineStatus;
  /** Rate is not the college-wide one (student, batch or batch-year rule). */
  customRate: boolean;
  rateSource: LibraryFineRateSource;
  /** Amount still owed now (0 once paid / waived). */
  outstandingNpr: number;
  /** Collected so far on this loan (part payments add up). */
  paidNpr: number;
  waivedNpr: number;
  /** Fine days settled up to (inclusive); empty = none yet. */
  settledThroughBs: string;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

const EMPTY_RULES: LibraryFineRules = {
  enabled: false,
  finePerDayNpr: 0,
  graceDays: 0,
  maxFinePerBookNpr: 0,
  chargeFromBs: "",
  studentRates: new Map(),
  groupStudentRates: new Map()
};

export const loadLibraryFineRules = async (
  schoolId: string | Types.ObjectId
): Promise<LibraryFineRules> => {
  const doc = await LibraryFineSettings.findOne({ schoolId }).lean();
  if (!doc) return EMPTY_RULES;

  // Resolve batch / batch-year rules to the students they cover
  const groupStudentRates = new Map<string, { rate: number; yearSpecific: boolean }>();
  const groupRates = doc.groupRates ?? [];
  if (groupRates.length > 0) {
    const students = await Student.find({
      schoolId,
      batchId: { $in: groupRates.map((g) => g.batchId) }
    })
      .select("_id batchId yearId")
      .lean();
    for (const student of students) {
      const batch = String(student.batchId ?? "");
      const year = String(student.yearId ?? "");
      const exact = groupRates.find(
        (g) => String(g.batchId) === batch && g.yearId && String(g.yearId) === year
      );
      const batchWide = groupRates.find((g) => String(g.batchId) === batch && !g.yearId);
      const match = exact ?? batchWide;
      if (match) {
        groupStudentRates.set(String(student._id), {
          rate: Math.max(0, Number(match.finePerDayNpr) || 0),
          yearSpecific: Boolean(exact)
        });
      }
    }
  }

  return {
    groupStudentRates,
    enabled: Boolean(doc.enabled),
    finePerDayNpr: Math.max(0, Number(doc.finePerDayNpr) || 0),
    graceDays: Math.max(0, Math.floor(Number(doc.graceDays) || 0)),
    maxFinePerBookNpr: Math.max(0, Number(doc.maxFinePerBookNpr) || 0),
    chargeFromBs: String(doc.chargeFromBs ?? "").trim(),
    studentRates: new Map(
      (doc.studentRates ?? []).map((r) => [
        String(r.studentId),
        Math.max(0, Number(r.finePerDayNpr) || 0)
      ])
    )
  };
};

/** The daily rate for one student: their own rate if set, else the college-wide one. */
export const fineRateForStudent = (
  rules: LibraryFineRules,
  studentId: string | null | undefined
): { ratePerDayNpr: number; customRate: boolean; rateSource: LibraryFineRateSource } => {
  const id = studentId ? String(studentId) : "";
  const own = id ? rules.studentRates.get(id) : undefined;
  if (own !== undefined) return { ratePerDayNpr: own, customRate: true, rateSource: "STUDENT" };
  const group = id ? rules.groupStudentRates?.get(id) : undefined;
  if (group) {
    return {
      ratePerDayNpr: group.rate,
      customRate: true,
      rateSource: group.yearSpecific ? "BATCH_YEAR" : "BATCH"
    };
  }
  return { ratePerDayNpr: rules.finePerDayNpr, customRate: false, rateSource: "ALL" };
};

/**
 * Pure fine arithmetic for one loan, from the due date to `endBs` (the return
 * date, or today while the book is still out).
 */
export const computeOverdueFine = (params: {
  dueDateBs: string;
  endBs: string;
  ratePerDayNpr: number;
  graceDays: number;
  maxFinePerBookNpr: number;
  chargeFromBs?: string;
}): { daysCharged: number; daysOverdue: number; amountNpr: number } => {
  const daysOverdue =
    compareBsDates(params.endBs, params.dueDateBs) > 0
      ? countInclusiveBsDays(params.dueDateBs, params.endBs) - 1
      : 0;
  const rate = Math.max(0, Number(params.ratePerDayNpr) || 0);
  if (rate <= 0 || daysOverdue <= 0) return { daysCharged: 0, daysOverdue, amountNpr: 0 };

  // First chargeable day: the day after the due date, after any grace days,
  // and never before the "charge from" date
  let firstChargeBs = getOffsetFromBsDate(params.dueDateBs, 1 + Math.max(0, params.graceDays));
  const chargeFrom = (params.chargeFromBs ?? "").trim();
  if (chargeFrom && compareBsDates(chargeFrom, firstChargeBs) > 0) firstChargeBs = chargeFrom;
  if (compareBsDates(params.endBs, firstChargeBs) < 0) {
    return { daysCharged: 0, daysOverdue, amountNpr: 0 };
  }

  const daysCharged = countInclusiveBsDays(firstChargeBs, params.endBs);
  let amountNpr = round2(daysCharged * rate);
  if (params.maxFinePerBookNpr > 0) amountNpr = Math.min(amountNpr, params.maxFinePerBookNpr);
  return { daysCharged, daysOverdue, amountNpr };
};

type IssueLike = {
  borrowerType?: string | null;
  studentId?: unknown;
  status?: string | null;
  dueDateBs: string;
  returnedDateBs?: string | null;
  fineNpr?: number | null;
  fineStatus?: string | null;
  fineRatePerDayNpr?: number | null;
  fineDaysCharged?: number | null;
  finePaidNpr?: number | null;
  fineWaivedNpr?: number | null;
  fineSettledThroughBs?: string | null;
  fineCarriedNpr?: number | null;
};

const studentIdOf = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "object" && value !== null && "_id" in value) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
};

const daysPastDue = (dueDateBs: string, endBs: string): number =>
  compareBsDates(endBs, dueDateBs) > 0 ? countInclusiveBsDays(dueDateBs, endBs) - 1 : 0;

/**
 * Settlement state of a loan's fine. Older rows (before part payments) have
 * no carried amount: a returned, unpaid fine counts as wholly owed.
 */
const settlementOf = (issue: IssueLike) => {
  const paid = Math.max(0, Number(issue.finePaidNpr) || 0);
  const waived = Math.max(0, Number(issue.fineWaivedNpr) || 0);
  const settledThroughBs = String(issue.fineSettledThroughBs ?? "").trim();
  let carried = issue.fineCarriedNpr;
  if (carried === undefined || carried === null) {
    carried =
      issue.status === "RETURNED" && issue.fineStatus === "OUTSTANDING"
        ? Math.max(0, (Number(issue.fineNpr) || 0) - paid)
        : 0;
  }
  return { paid, waived, settledThroughBs, carried: Math.max(0, Number(carried) || 0) };
};

/** Whole-loan fine from the due date to endBs (cap applies to the loan total). */
const loanFineThrough = (
  issue: IssueLike,
  rules: LibraryFineRules,
  ratePerDayNpr: number,
  endBs: string
) =>
  computeOverdueFine({
    dueDateBs: issue.dueDateBs,
    endBs,
    ratePerDayNpr,
    graceDays: rules.graceDays,
    maxFinePerBookNpr: rules.maxFinePerBookNpr,
    chargeFromBs: rules.chargeFromBs
  });

/**
 * Fine added since the last settlement, up to endBs: the loan's fine through
 * endBs minus its fine through the settled date (keeps the per-book cap right
 * across part payments).
 */
const newFineSinceSettlement = (
  issue: IssueLike,
  rules: LibraryFineRules,
  ratePerDayNpr: number,
  endBs: string,
  settledThroughBs: string
): { amountNpr: number; daysCharged: number } => {
  const upTo = loanFineThrough(issue, rules, ratePerDayNpr, endBs);
  if (!settledThroughBs) return { amountNpr: upTo.amountNpr, daysCharged: upTo.daysCharged };
  if (compareBsDates(endBs, settledThroughBs) <= 0) return { amountNpr: 0, daysCharged: 0 };
  const before = loanFineThrough(issue, rules, ratePerDayNpr, settledThroughBs);
  return {
    amountNpr: round2(Math.max(0, upTo.amountNpr - before.amountNpr)),
    daysCharged: Math.max(0, upTo.daysCharged - before.daysCharged)
  };
};

/**
 * The fine to show for a loan. Books still out: live, from today (what is
 * owed now = carried + new days since the last payment). Returned books:
 * fixed at return. Either can be paid / waived, in full or in part.
 */
export const libraryIssueFine = (
  issue: IssueLike,
  rules: LibraryFineRules,
  todayBs: string = getTodayBs()
): LibraryIssueFine => {
  const isStudent = (issue.borrowerType ?? "STUDENT") === "STUDENT";
  const { ratePerDayNpr, customRate, rateSource } = fineRateForStudent(
    rules,
    studentIdOf(issue.studentId)
  );
  const settled = settlementOf(issue);

  if (issue.status === "RETURNED") {
    const outstanding = settled.carried;
    const total = round2(settled.paid + settled.waived + outstanding);
    const status: LibraryFineStatus =
      outstanding > 0
        ? "OUTSTANDING"
        : total <= 0
          ? "NONE"
          : settled.paid > 0
            ? "PAID"
            : "WAIVED";
    return {
      amountNpr: total,
      ratePerDayNpr: Math.max(0, Number(issue.fineRatePerDayNpr) || 0),
      daysCharged: Math.max(0, Number(issue.fineDaysCharged) || 0),
      daysOverdue: issue.returnedDateBs ? daysPastDue(issue.dueDateBs, issue.returnedDateBs) : 0,
      accruing: false,
      status,
      customRate: false,
      rateSource: "ALL",
      outstandingNpr: outstanding,
      paidNpr: settled.paid,
      waivedNpr: settled.waived,
      settledThroughBs: settled.settledThroughBs
    };
  }

  const daysOverdue = daysPastDue(issue.dueDateBs, todayBs);
  const fresh =
    isStudent && rules.enabled
      ? newFineSinceSettlement(issue, rules, ratePerDayNpr, todayBs, settled.settledThroughBs)
      : { amountNpr: 0, daysCharged: 0 };
  const outstanding = round2(settled.carried + fresh.amountNpr);
  const total = round2(settled.paid + settled.waived + outstanding);
  const accruing = isStudent && rules.enabled && daysOverdue > 0 && ratePerDayNpr > 0;
  const whole = isStudent && rules.enabled
    ? loanFineThrough(issue, rules, ratePerDayNpr, todayBs)
    : { daysCharged: 0 };
  return {
    amountNpr: total,
    ratePerDayNpr: isStudent && rules.enabled ? ratePerDayNpr : 0,
    daysCharged: whole.daysCharged,
    daysOverdue,
    accruing,
    // Still out and overdue: the fine keeps growing even right after a payment
    status: accruing || outstanding > 0 ? "ACCRUING" : "NONE",
    customRate: isStudent && rules.enabled ? customRate : false,
    rateSource: isStudent && rules.enabled ? rateSource : "ALL",
    outstandingNpr: outstanding,
    paidNpr: settled.paid,
    waivedNpr: settled.waived,
    settledThroughBs: settled.settledThroughBs
  };
};

/**
 * Fix the fine on a loan being returned: new days since the last settlement
 * (or since the due date) are added to what is still owed.
 */
export const fineForReturn = (
  issue: IssueLike,
  rules: LibraryFineRules,
  returnedDateBs: string
): {
  /** Fine added on return (days not yet settled). */
  amountNpr: number;
  ratePerDayNpr: number;
  daysCharged: number;
  /** Owed after return = carried + amountNpr. */
  owedNpr: number;
  /** Whole-loan fine = paid + waived + owed. */
  totalNpr: number;
  paidNpr: number;
  waivedNpr: number;
} => {
  const settled = settlementOf(issue);
  const finish = (amount: number, rate: number, days: number) => {
    const owed = round2(settled.carried + amount);
    return {
      amountNpr: amount,
      ratePerDayNpr: rate,
      daysCharged: days,
      owedNpr: owed,
      totalNpr: round2(settled.paid + settled.waived + owed),
      paidNpr: settled.paid,
      waivedNpr: settled.waived
    };
  };
  if ((issue.borrowerType ?? "STUDENT") !== "STUDENT" || !rules.enabled) {
    return finish(0, 0, 0);
  }
  const { ratePerDayNpr } = fineRateForStudent(rules, studentIdOf(issue.studentId));
  const fresh = newFineSinceSettlement(
    issue,
    rules,
    ratePerDayNpr,
    returnedDateBs,
    settled.settledThroughBs
  );
  const whole = loanFineThrough(issue, rules, ratePerDayNpr, returnedDateBs);
  return finish(fresh.amountNpr, ratePerDayNpr, whole.daysCharged);
};

/**
 * Pay / waive / correct a loan's fine — returned or still out. Works on what
 * is owed right now; a book still out is settled through today and keeps
 * accruing from tomorrow. Returns the field updates to save.
 */
export const settleLibraryFine = (params: {
  issue: IssueLike;
  rules: LibraryFineRules;
  todayBs: string;
  action: "PAID" | "WAIVED" | "ADJUSTED";
  /** PAID: amount collected (default all owed). ADJUSTED: the new amount owed. */
  amountNpr?: number;
}): {
  owedBeforeNpr: number;
  recordedNpr: number;
  updates: {
    finePaidNpr: number;
    fineWaivedNpr: number;
    fineCarriedNpr: number;
    fineSettledThroughBs: string;
    fineNpr?: number;
    fineStatus?: "NONE" | "OUTSTANDING" | "PAID" | "WAIVED";
  };
} => {
  const current = libraryIssueFine(params.issue, params.rules, params.todayBs);
  const settled = settlementOf(params.issue);
  const owed = current.outstandingNpr;
  const isOut = params.issue.status !== "RETURNED";

  let paid = settled.paid;
  let waived = settled.waived;
  let carried = owed;
  let recorded = 0;

  if (params.action === "PAID") {
    if (owed <= 0) throw new Error("There is no fine to collect right now");
    const amount = params.amountNpr ?? owed;
    if (!(amount > 0)) throw new Error("Enter the amount collected");
    if (amount > owed + 0.001) throw new Error("Amount collected cannot be more than the fine owed");
    recorded = round2(amount);
    paid = round2(paid + recorded);
    carried = round2(owed - recorded);
  } else if (params.action === "WAIVED") {
    if (owed <= 0) throw new Error("There is no fine to waive right now");
    recorded = owed;
    waived = round2(waived + owed);
    carried = 0;
  } else {
    const amount = Math.max(0, Number(params.amountNpr) || 0);
    recorded = round2(amount);
    carried = recorded;
  }

  // Book out: everything up to today is now settled; returned: keep the return date
  const settledThroughBs = isOut
    ? params.todayBs
    : String(params.issue.returnedDateBs ?? settled.settledThroughBs ?? "");
  const total = round2(paid + waived + carried);
  return {
    owedBeforeNpr: owed,
    recordedNpr: recorded,
    updates: {
      finePaidNpr: paid,
      fineWaivedNpr: waived,
      fineCarriedNpr: carried,
      fineSettledThroughBs: settledThroughBs,
      ...(isOut
        ? {}
        : {
            fineNpr: total,
            fineStatus:
              carried > 0 ? "OUTSTANDING" : total <= 0 ? "NONE" : paid > 0 ? "PAID" : "WAIVED"
          })
    }
  };
};

// ---------------------------------------------------------------- notifications

const money = (value: number) =>
  `NPR ${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const studentUserId = async (studentId: string): Promise<string | null> => {
  const student = await Student.findById(studentId).select("user").lean();
  return student?.user ? String(student.user) : null;
};

/** Tell the student (and their parents) about a fine; `key` keeps each message to once. */
export const sendLibraryFineNotice = async (params: {
  schoolId: string;
  studentId: string;
  issueId: string;
  title: string;
  message: string;
  key: string;
}): Promise<void> => {
  const userId = await studentUserId(params.studentId);
  if (userId) {
    await sendNotification({
      schoolId: params.schoolId,
      recipientUserId: userId,
      title: params.title,
      message: params.message,
      type: "LIBRARY",
      channel: "BOTH",
      dedupeKey: params.key,
      metadata: { libraryIssueId: params.issueId, action: "FINE" }
    });
  }
  await notifyParentsOfStudent(
    params.schoolId,
    params.studentId,
    params.title,
    params.message,
    "LIBRARY",
    "BOTH",
    { key: `${params.key}:parent` }
  );
};

/**
 * Fine notices for books still out: once when a fine first applies (again if
 * the daily rate changes), then a weekly running total.
 */
export const notifyAccruingLibraryFines = async (
  schoolId: string,
  todayBs: string = getTodayBs()
): Promise<void> => {
  const rules = await loadLibraryFineRules(schoolId);
  if (!rules.enabled) return;
  const issues = await LibraryIssue.find({
    schoolId,
    borrowerType: "STUDENT",
    status: { $in: ["ISSUED", "OVERDUE"] },
    dueDateBs: { $lt: todayBs }
  })
    .populate("bookId", "title")
    .lean();

  for (const issue of issues) {
    const studentId = studentIdOf(issue.studentId);
    if (!studentId) continue;
    const fine = libraryIssueFine(issue as unknown as IssueLike, rules, todayBs);
    if (fine.amountNpr <= 0) continue;
    const issueId = String(issue._id);
    const book = (issue.bookId as { title?: string } | null)?.title ?? "Library book";
    const code = issue.bookCode ? ` [${issue.bookCode}]` : "";

    await sendLibraryFineNotice({
      schoolId,
      studentId,
      issueId,
      title: "Library overdue fine",
      message: `"${book}${code}" was due on ${issue.dueDateBs}. A fine of ${money(fine.ratePerDayNpr)} per day applies until it is returned — ${money(fine.amountNpr)} so far.`,
      key: `library:FINE_START:${issueId}:${fine.ratePerDayNpr}`
    });

    if (fine.daysCharged >= 7) {
      await sendLibraryFineNotice({
        schoolId,
        studentId,
        issueId,
        title: "Library fine still growing",
        message: `"${book}${code}" is ${fine.daysOverdue} days overdue. Fine so far: ${money(fine.amountNpr)} (${money(fine.ratePerDayNpr)} per day). Please return it to stop the fine.`,
        key: `library:FINE_WEEK:${issueId}:${Math.floor(fine.daysCharged / 7)}`
      });
    }
  }
};

/** Background sweep for every college with fines on (every few hours). */
export const startLibraryFineScheduler = (): void => {
  const intervalMs = 3 * 60 * 60 * 1000;
  const run = () => {
    void (async () => {
      const schools = await LibraryFineSettings.find({ enabled: true }).select("schoolId").lean();
      for (const row of schools) {
        await notifyAccruingLibraryFines(String(row.schoolId)).catch((error) =>
          console.error("Library fine notifications failed:", error)
        );
      }
    })().catch((error) => console.error("Library fine scheduler failed:", error));
  };
  run();
  setInterval(run, intervalMs);
};
