import type { Types } from "mongoose";
import { FeeCollection } from "../models/FeeCollection.js";
import { Student } from "../models/Student.js";
import { compareBsDates, countInclusiveBsDays, getTodayBs } from "./nepaliDate.js";

/**
 * Receivables aging for outstanding student dues.
 *
 * Read-only: it reports on `Student.feesDueNpr` and existing `FeeCollection` records and
 * writes nothing, so fee collection, security deposits and the student/parent flows are
 * untouched.
 *
 * The ledger posts fee income on a cash basis, so there is no invoice date to age from.
 * The most defensible proxy available is the date money last moved on the account: a due
 * is aged from the student's most recent receipt, falling back to their admission date
 * when they have never paid. That matches how a bursar reads a dues list — "how long since
 * this family last paid" — rather than implying an invoice date the system never recorded.
 */

const BUCKETS = [
  { key: "current", label: "0–30 days", maxDays: 30 },
  { key: "days31to60", label: "31–60 days", maxDays: 60 },
  { key: "days61to90", label: "61–90 days", maxDays: 90 },
  { key: "over90", label: "Over 90 days", maxDays: Number.POSITIVE_INFINITY }
] as const;

type BucketKey = (typeof BUCKETS)[number]["key"];

const bucketFor = (days: number): BucketKey => {
  for (const bucket of BUCKETS) {
    if (days <= bucket.maxDays) return bucket.key;
  }
  return "over90";
};

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export interface AgingRow {
  [key: string]: unknown;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  /** Stored as a number on Student; kept as-is so the report shows the same value. */
  rollNumber: string | number;
  phone: string;
  lastPaymentDateBs: string;
  daysOutstanding: number | null;
  outstandingNpr: number;
  bucket: string;
  current: number;
  days31to60: number;
  days61to90: number;
  over90: number;
}

export const buildReceivablesAging = async (
  schoolId: Types.ObjectId,
  options?: { asOfDateBs?: string; batchId?: string }
) => {
  const asOfDateBs = options?.asOfDateBs?.trim() || getTodayBs();

  const studentFilter: Record<string, unknown> = { schoolId, feesDueNpr: { $gt: 0 } };
  if (options?.batchId) studentFilter.batchId = options.batchId;

  const students = await Student.find(studentFilter)
    .populate("user", "fullName phone")
    .sort({ feesDueNpr: -1 })
    .lean();

  if (students.length === 0) {
    return { rows: [] as AgingRow[], totals: emptyTotals() };
  }

  // One query for every student's payment history, then reduce in memory — far cheaper
  // than a per-student lookup on a list that can run to thousands of rows.
  const collections = await FeeCollection.find({
    schoolId,
    isDeleted: false,
    studentId: { $in: students.map((s) => s._id) }
  })
    .select("studentId paidDateBs")
    .lean();

  const lastPaymentByStudent = new Map<string, string>();
  for (const collection of collections) {
    const key = collection.studentId.toString();
    const existing = lastPaymentByStudent.get(key);
    if (!existing || compareBsDates(collection.paidDateBs, existing) > 0) {
      lastPaymentByStudent.set(key, collection.paidDateBs);
    }
  }

  const rows: AgingRow[] = students.map((student) => {
    const studentKey = student._id.toString();
    const user = student.user as { fullName?: string; phone?: string } | undefined;
    const reference = lastPaymentByStudent.get(studentKey) || student.admissionDateBs || "";

    let daysOutstanding: number | null = null;
    if (reference && compareBsDates(reference, asOfDateBs) <= 0) {
      try {
        // countInclusiveBsDays counts both endpoints; a payment made today is 0 days old.
        daysOutstanding = Math.max(0, countInclusiveBsDays(reference, asOfDateBs) - 1);
      } catch {
        daysOutstanding = null;
      }
    }

    const outstandingNpr = round2(student.feesDueNpr ?? 0);
    // With no usable reference date the age is unknown; treat it as the oldest bucket so
    // it surfaces for follow-up rather than quietly landing in "current".
    const bucket = daysOutstanding === null ? "over90" : bucketFor(daysOutstanding);

    return {
      studentId: studentKey,
      studentName: user?.fullName ?? "",
      admissionNumber: student.admissionNumber ?? "",
      rollNumber: student.rollNumber ?? "",
      phone: user?.phone ?? "",
      lastPaymentDateBs: lastPaymentByStudent.get(studentKey) ?? "",
      daysOutstanding,
      outstandingNpr,
      bucket: BUCKETS.find((b) => b.key === bucket)?.label ?? "",
      current: bucket === "current" ? outstandingNpr : 0,
      days31to60: bucket === "days31to60" ? outstandingNpr : 0,
      days61to90: bucket === "days61to90" ? outstandingNpr : 0,
      over90: bucket === "over90" ? outstandingNpr : 0
    };
  });

  const totals = {
    current: round2(rows.reduce((s, r) => s + r.current, 0)),
    days31to60: round2(rows.reduce((s, r) => s + r.days31to60, 0)),
    days61to90: round2(rows.reduce((s, r) => s + r.days61to90, 0)),
    over90: round2(rows.reduce((s, r) => s + r.over90, 0)),
    totalOutstandingNpr: round2(rows.reduce((s, r) => s + r.outstandingNpr, 0)),
    studentCount: rows.length,
    asOfDateBs
  };

  return { rows, totals };
};

function emptyTotals() {
  return {
    current: 0,
    days31to60: 0,
    days61to90: 0,
    over90: 0,
    totalOutstandingNpr: 0,
    studentCount: 0,
    asOfDateBs: getTodayBs()
  };
}

/** Append a TOTAL row so the printed report carries its own control totals. */
export const flattenReceivablesAging = (
  result: Awaited<ReturnType<typeof buildReceivablesAging>>
): Array<Record<string, unknown>> => {
  if (result.rows.length === 0) return [];
  return [
    ...result.rows,
    {
      studentId: "",
      studentName: "TOTAL",
      admissionNumber: "",
      rollNumber: "",
      phone: "",
      lastPaymentDateBs: "",
      daysOutstanding: null,
      outstandingNpr: result.totals.totalOutstandingNpr,
      bucket: "",
      current: result.totals.current,
      days31to60: result.totals.days31to60,
      days61to90: result.totals.days61to90,
      over90: result.totals.over90
    }
  ];
};
