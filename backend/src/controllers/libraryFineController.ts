/**
 * Library → Overdue Fines (Administrator only).
 * College-wide daily fine, per-student rates, the fines list, and clearing a
 * returned book's fine as paid or waived. Calculation lives in libraryFines.ts.
 */
import type { Request, Response } from "express";
import { z } from "zod";
import { LibraryIssue } from "../models/LibraryBook.js";
import { LibraryFineSettings } from "../models/LibraryFineSettings.js";
import { Student } from "../models/Student.js";
import { User } from "../models/User.js";
import { Batch } from "../models/Batch.js";
import { Year } from "../models/Year.js";
import { ApiError } from "../utils/apiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { recordAudit } from "../utils/audit.js";
import {
  libraryIssueFine,
  loadLibraryFineRules,
  notifyAccruingLibraryFines,
  sendLibraryFineNotice,
  settleLibraryFine
} from "../utils/libraryFines.js";
import { ensureValidBsDate, getTodayBs, nepalDatesOf } from "../utils/nepaliDate.js";
import { sendSuccess } from "../utils/response.js";

const money = z.coerce.number().min(0).max(1_000_000);

const settingsSchema = z.object({
  enabled: z.boolean(),
  finePerDayNpr: money,
  graceDays: z.coerce.number().int().min(0).max(60).default(0),
  maxFinePerBookNpr: money.default(0),
  chargeFromBs: z.string().trim().optional().or(z.literal(""))
});

const studentRateSchema = z.object({
  studentId: z.string().regex(/^[a-f\d]{24}$/i, "Choose a student"),
  /** null removes the student's own rate (back to the college-wide rate). */
  finePerDayNpr: money.nullable(),
  note: z.string().trim().max(300).optional().or(z.literal(""))
});

const groupRateSchema = z.object({
  batchId: z.string().regex(/^[a-f\d]{24}$/i, "Choose a batch"),
  /** Empty = every year of the batch. */
  yearId: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .nullable()
    .optional()
    .or(z.literal("")),
  /** null removes the rule. */
  finePerDayNpr: money.nullable(),
  note: z.string().trim().max(300).optional().or(z.literal(""))
});

const clearSchema = z.object({
  method: z.enum(["PAID", "WAIVED"]),
  /** Amount collected when PAID (defaults to the full fine). */
  amountNpr: money.optional(),
  note: z.string().trim().max(300).optional().or(z.literal(""))
});

const adjustSchema = z.object({
  amountNpr: money,
  note: z.string().trim().max(300).optional().or(z.literal(""))
});

const actorName = async (req: Request): Promise<string> => {
  const user = await User.findById(req.user?.userId).select("fullName").lean();
  return user?.fullName ?? "Administrator";
};

/** GET /library/fines/settings */
export const getLibraryFineSettings = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = req.tenantSchoolId!;
  const doc = await LibraryFineSettings.findOne({ schoolId }).lean();
  const rates = doc?.studentRates ?? [];
  const students = await Student.find({
    schoolId,
    _id: { $in: rates.map((r) => r.studentId) }
  })
    .select("user admissionNumber rollNumber batchId yearId")
    .populate("user", "fullName")
    .populate("batchId", "name")
    .populate("yearId", "name")
    .lean();
  const byId = new Map(students.map((s) => [String(s._id), s]));
  const groupRates = doc?.groupRates ?? [];
  const [batches, years] = await Promise.all([
    Batch.find({ schoolId, _id: { $in: groupRates.map((g) => g.batchId) } }).select("name").lean(),
    Year.find({ schoolId, _id: { $in: groupRates.map((g) => g.yearId).filter(Boolean) } })
      .select("name")
      .lean()
  ]);
  const batchName = new Map(batches.map((b) => [String(b._id), b.name]));
  const yearName = new Map(years.map((y) => [String(y._id), y.name]));

  return sendSuccess(res, "Library fine settings", {
    enabled: Boolean(doc?.enabled),
    finePerDayNpr: Number(doc?.finePerDayNpr ?? 0),
    graceDays: Number(doc?.graceDays ?? 0),
    maxFinePerBookNpr: Number(doc?.maxFinePerBookNpr ?? 0),
    chargeFromBs: doc?.chargeFromBs ?? "",
    updatedByName: doc?.updatedByName ?? "",
    updatedAt: doc?.updatedAt,
    groupRates: groupRates.map((g) => ({
      batchId: String(g.batchId),
      yearId: g.yearId ? String(g.yearId) : "",
      batchName: batchName.get(String(g.batchId)) ?? "Batch",
      yearName: g.yearId ? (yearName.get(String(g.yearId)) ?? "Year") : "",
      finePerDayNpr: Number(g.finePerDayNpr),
      note: g.note ?? "",
      setByName: g.setByName ?? "",
      setAt: g.setAt
    })),
    studentRates: rates.map((r) => {
      const s = byId.get(String(r.studentId));
      return {
        studentId: String(r.studentId),
        finePerDayNpr: Number(r.finePerDayNpr),
        note: r.note ?? "",
        setByName: r.setByName ?? "",
        setAt: r.setAt,
        studentName: (s?.user as { fullName?: string } | null)?.fullName ?? "Student",
        admissionNumber: s?.admissionNumber ?? "",
        rollNumber: s?.rollNumber ?? null,
        batchName: (s?.batchId as { name?: string } | null)?.name ?? "",
        yearName: (s?.yearId as { name?: string } | null)?.name ?? ""
      };
    })
  });
});

/** PUT /library/fines/settings — college-wide fine for every student. */
export const updateLibraryFineSettings = asyncHandler(async (req: Request, res: Response) => {
  const payload = settingsSchema.parse(req.body);
  const schoolId = req.tenantSchoolId!;
  if (payload.chargeFromBs) ensureValidBsDate(payload.chargeFromBs);
  if (payload.enabled && payload.finePerDayNpr <= 0) {
    throw new ApiError(400, "Enter the fine per day (more than 0) to turn fines on");
  }

  const before = await LibraryFineSettings.findOne({ schoolId }).lean();
  const doc = await LibraryFineSettings.findOneAndUpdate(
    { schoolId },
    {
      $set: {
        enabled: payload.enabled,
        finePerDayNpr: payload.finePerDayNpr,
        graceDays: payload.graceDays,
        maxFinePerBookNpr: payload.maxFinePerBookNpr,
        chargeFromBs: payload.chargeFromBs ?? "",
        updatedByName: await actorName(req)
      },
      $setOnInsert: { schoolId }
    },
    { upsert: true, new: true }
  );

  await recordAudit(req, {
    action: "library.fine_settings.update",
    entity: "LibraryFineSettings",
    entityId: String(doc._id),
    before: before
      ? {
          enabled: before.enabled,
          finePerDayNpr: before.finePerDayNpr,
          graceDays: before.graceDays,
          maxFinePerBookNpr: before.maxFinePerBookNpr,
          chargeFromBs: before.chargeFromBs
        }
      : null,
    after: payload
  });

  // Students with overdue books hear about the fine now, not at the next sweep
  if (payload.enabled) await notifyAccruingLibraryFines(String(schoolId));
  return sendSuccess(res, payload.enabled ? "Overdue fines are on" : "Overdue fines are off", doc);
});

/** PUT /library/fines/student-rates — one student's own daily rate (or remove it). */
export const setLibraryStudentFineRate = asyncHandler(async (req: Request, res: Response) => {
  const payload = studentRateSchema.parse(req.body);
  const schoolId = req.tenantSchoolId!;
  const student = await Student.findOne({ _id: payload.studentId, schoolId }).select("_id").lean();
  if (!student) throw new ApiError(404, "Student not found");

  const doc =
    (await LibraryFineSettings.findOne({ schoolId })) ??
    new LibraryFineSettings({ schoolId, enabled: false, finePerDayNpr: 0 });
  const rates = (doc.studentRates ?? []).filter(
    (r) => String(r.studentId) !== payload.studentId
  );
  if (payload.finePerDayNpr !== null) {
    rates.push({
      studentId: student._id,
      finePerDayNpr: payload.finePerDayNpr,
      note: payload.note ?? "",
      setByName: await actorName(req),
      setAt: new Date()
    } as never);
  }
  doc.studentRates = rates as typeof doc.studentRates;
  await doc.save();

  await recordAudit(req, {
    action: "library.fine_student_rate.update",
    entity: "Student",
    entityId: payload.studentId,
    after: { finePerDayNpr: payload.finePerDayNpr, note: payload.note }
  });

  if (doc.enabled) await notifyAccruingLibraryFines(String(schoolId));
  return sendSuccess(
    res,
    payload.finePerDayNpr === null
      ? "Student now uses the college-wide fine"
      : "Student fine rate saved",
    { studentId: payload.studentId, finePerDayNpr: payload.finePerDayNpr }
  );
});

/** PUT /library/fines/group-rates — daily fine for a batch or one year of it (or remove it). */
export const setLibraryGroupFineRate = asyncHandler(async (req: Request, res: Response) => {
  const payload = groupRateSchema.parse(req.body);
  const schoolId = req.tenantSchoolId!;
  const yearId = payload.yearId || null;
  const batch = await Batch.findOne({ _id: payload.batchId, schoolId }).select("_id").lean();
  if (!batch) throw new ApiError(404, "Batch not found");
  if (yearId) {
    const year = await Year.findOne({ _id: yearId, schoolId, batchId: payload.batchId })
      .select("_id")
      .lean();
    if (!year) throw new ApiError(400, "That year does not belong to the chosen batch");
  }

  const doc =
    (await LibraryFineSettings.findOne({ schoolId })) ??
    new LibraryFineSettings({ schoolId, enabled: false, finePerDayNpr: 0 });
  const sameGroup = (g: { batchId: unknown; yearId?: unknown }) =>
    String(g.batchId) === payload.batchId && String(g.yearId ?? "") === String(yearId ?? "");
  const rates = (doc.groupRates ?? []).filter((g) => !sameGroup(g));
  if (payload.finePerDayNpr !== null) {
    rates.push({
      batchId: batch._id,
      yearId,
      finePerDayNpr: payload.finePerDayNpr,
      note: payload.note ?? "",
      setByName: await actorName(req),
      setAt: new Date()
    } as never);
  }
  doc.groupRates = rates as typeof doc.groupRates;
  await doc.save();

  await recordAudit(req, {
    action: "library.fine_group_rate.update",
    entity: "LibraryFineSettings",
    entityId: String(doc._id),
    after: { batchId: payload.batchId, yearId, finePerDayNpr: payload.finePerDayNpr, note: payload.note }
  });

  if (doc.enabled) await notifyAccruingLibraryFines(String(schoolId));
  return sendSuccess(
    res,
    payload.finePerDayNpr === null ? "Batch fine removed" : "Batch fine saved",
    { batchId: payload.batchId, yearId, finePerDayNpr: payload.finePerDayNpr }
  );
});

/**
 * GET /library/fines?view=accruing|outstanding|cleared|all
 * Student loans with a fine: books still out (fine growing) and returned
 * books whose fine is owed or was cleared.
 */
export const listLibraryFines = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = req.tenantSchoolId!;
  const view = String(req.query.view ?? "all");
  const todayBs = getTodayBs();
  const rules = await loadLibraryFineRules(schoolId);

  const issues = await LibraryIssue.find({
    schoolId,
    borrowerType: "STUDENT",
    $or: [
      { status: { $in: ["ISSUED", "OVERDUE"] }, dueDateBs: { $lt: todayBs } },
      { status: "RETURNED", fineNpr: { $gt: 0 } },
      { status: "RETURNED", "fineSettlements.0": { $exists: true } }
    ]
  })
    .populate("bookId", "title")
    .populate({
      path: "studentId",
      select: "user admissionNumber rollNumber batchId yearId",
      populate: [
        { path: "user", select: "fullName" },
        { path: "batchId", select: "name" },
        { path: "yearId", select: "name" }
      ]
    })
    .sort({ dueDateBs: 1 })
    .lean();

  const rows = issues
    .map((issue) => {
      const fine = libraryIssueFine(issue as never, rules, todayBs);
      const student = issue.studentId as unknown as {
        _id?: unknown;
        admissionNumber?: string;
        rollNumber?: number;
        user?: { fullName?: string };
        batchId?: { name?: string };
        yearId?: { name?: string };
      } | null;
      return {
        issueId: String(issue._id),
        studentId: student?._id ? String(student._id) : "",
        studentName: student?.user?.fullName ?? "Student",
        admissionNumber: student?.admissionNumber ?? "",
        rollNumber: student?.rollNumber ?? null,
        batchName: student?.batchId?.name ?? "",
        yearName: student?.yearId?.name ?? "",
        bookTitle: (issue.bookId as unknown as { title?: string } | null)?.title ?? "Book",
        bookCode: issue.bookCode ?? "",
        issuedDateBs: issue.issuedDateBs,
        dueDateBs: issue.dueDateBs,
        returnedDateBs: issue.returnedDateBs ?? "",
        loanStatus: issue.status,
        finePaidNpr: fine.paidNpr,
        fineClearedByName: issue.fineClearedByName ?? "",
        fineClearNote: issue.fineClearNote ?? "",
        fine
      };
    })
    .filter((row) => {
      if (view === "accruing") return row.fine.status === "ACCRUING" || (row.loanStatus !== "RETURNED" && row.fine.daysOverdue > 0);
      // Anyone owing now — returned books and books still out
      if (view === "outstanding") return row.fine.outstandingNpr > 0;
      if (view === "cleared") return row.fine.status === "PAID" || row.fine.status === "WAIVED";
      return true;
    });

  const totals = rows.reduce(
    (t, row) => {
      // Owed now: books still out vs returned; collected / waived include
      // payments made while a book was still out
      if (row.loanStatus !== "RETURNED") t.accruingNpr += row.fine.outstandingNpr;
      else t.outstandingNpr += row.fine.outstandingNpr;
      t.collectedNpr += row.fine.paidNpr;
      t.waivedNpr += row.fine.waivedNpr;
      return t;
    },
    { accruingNpr: 0, outstandingNpr: 0, collectedNpr: 0, waivedNpr: 0 }
  );

  return sendSuccess(res, "Library fines", { todayBs, enabled: rules.enabled, rows, totals });
});

/** Any student loan — returned or still out — for fine actions. */
/**
 * GET /library/fines/payments?type=ALL|PAID|WAIVED&fromBs=&toBs=
 * Every fine payment and waiver, one row each — including those taken while
 * the book was still out — newest first.
 */
export const listLibraryFinePayments = asyncHandler(async (req: Request, res: Response) => {
  const schoolId = req.tenantSchoolId!;
  const type = String(req.query.type ?? "ALL").toUpperCase();
  const fromBs = String(req.query.fromBs ?? "").trim();
  const toBs = String(req.query.toBs ?? "").trim();
  if (fromBs) ensureValidBsDate(fromBs);
  if (toBs) ensureValidBsDate(toBs);

  const issues = await LibraryIssue.find({
    schoolId,
    borrowerType: "STUDENT",
    $or: [
      { "fineSettlements.0": { $exists: true } },
      // Cleared before payment history existed
      { fineStatus: { $in: ["PAID", "WAIVED"] } }
    ]
  })
    .populate("bookId", "title")
    .populate({
      path: "studentId",
      select: "user admissionNumber rollNumber batchId yearId",
      populate: [
        { path: "user", select: "fullName" },
        { path: "batchId", select: "name" },
        { path: "yearId", select: "name" }
      ]
    })
    .lean();

  type Row = {
    key: string;
    issueId: string;
    action: "PAID" | "WAIVED";
    amountNpr: number;
    dateBs: string;
    dateAd: string;
    at: string;
    whileOut: boolean;
    throughBs: string;
    byName: string;
    note: string;
    studentId: string;
    studentName: string;
    admissionNumber: string;
    rollNumber: number | null;
    batchName: string;
    yearName: string;
    bookTitle: string;
    bookCode: string;
    dueDateBs: string;
    returnedDateBs: string;
  };

  const rows: Row[] = [];
  for (const issue of issues) {
    const student = issue.studentId as unknown as {
      _id?: unknown;
      admissionNumber?: string;
      rollNumber?: number;
      user?: { fullName?: string };
      batchId?: { name?: string };
      yearId?: { name?: string };
    } | null;
    const common = {
      issueId: String(issue._id),
      studentId: student?._id ? String(student._id) : "",
      studentName: student?.user?.fullName ?? "Student",
      admissionNumber: student?.admissionNumber ?? "",
      rollNumber: student?.rollNumber ?? null,
      batchName: student?.batchId?.name ?? "",
      yearName: student?.yearId?.name ?? "",
      bookTitle: (issue.bookId as unknown as { title?: string } | null)?.title ?? "Book",
      bookCode: issue.bookCode ?? "",
      dueDateBs: issue.dueDateBs,
      returnedDateBs: issue.returnedDateBs ?? ""
    };

    const settlements = (issue.fineSettlements ?? []).filter(
      (s) => s.action === "PAID" || s.action === "WAIVED"
    );
    if (settlements.length > 0) {
      settlements.forEach((s, index) => {
        const at = s.at ? new Date(s.at) : new Date(issue.updatedAt ?? Date.now());
        const dates = nepalDatesOf(at);
        rows.push({
          ...common,
          key: `${String(issue._id)}:${index}`,
          action: s.action as "PAID" | "WAIVED",
          amountNpr: Number(s.amountNpr) || 0,
          dateBs: dates.dateBs,
          dateAd: dates.dateAd,
          at: at.toISOString(),
          whileOut: Boolean(s.whileOut),
          throughBs: s.throughBs ?? "",
          byName: s.byName ?? "",
          note: s.note ?? ""
        });
      });
    } else if (issue.fineStatus === "PAID" || issue.fineStatus === "WAIVED") {
      // Older clearance: one row from the loan's own fields
      const at = issue.fineClearedAt ? new Date(issue.fineClearedAt) : new Date(issue.updatedAt ?? Date.now());
      const dates = nepalDatesOf(at);
      rows.push({
        ...common,
        key: `${String(issue._id)}:legacy`,
        action: issue.fineStatus,
        amountNpr:
          issue.fineStatus === "PAID"
            ? Number(issue.finePaidNpr) || Number(issue.fineNpr) || 0
            : Number(issue.fineNpr) || 0,
        dateBs: dates.dateBs,
        dateAd: dates.dateAd,
        at: at.toISOString(),
        whileOut: false,
        throughBs: issue.returnedDateBs ?? "",
        byName: issue.fineClearedByName ?? "",
        note: issue.fineClearNote ?? ""
      });
    }
  }

  const filtered = rows
    .filter((row) => (type === "PAID" || type === "WAIVED" ? row.action === type : true))
    .filter((row) => (!fromBs || row.dateBs >= fromBs) && (!toBs || row.dateBs <= toBs))
    .sort((a, b) => b.at.localeCompare(a.at));

  const totals = filtered.reduce(
    (t, row) => {
      if (row.action === "PAID") {
        t.paidNpr += row.amountNpr;
        t.paidCount += 1;
      } else {
        t.waivedNpr += row.amountNpr;
        t.waivedCount += 1;
      }
      return t;
    },
    { paidNpr: 0, waivedNpr: 0, paidCount: 0, waivedCount: 0 }
  );
  totals.paidNpr = Math.round(totals.paidNpr * 100) / 100;
  totals.waivedNpr = Math.round(totals.waivedNpr * 100) / 100;

  return sendSuccess(res, "Library fine payments", { rows: filtered, totals });
});

const findStudentFineIssue = async (req: Request) => {
  const issue = await LibraryIssue.findOne({
    _id: req.params.issueId,
    schoolId: req.tenantSchoolId!,
    borrowerType: "STUDENT"
  }).populate("bookId", "title");
  if (!issue) throw new ApiError(404, "Library loan not found");
  return issue;
};

type SettleAction = "PAID" | "WAIVED" | "ADJUSTED";

/** Apply a payment / waiver / correction to a loan's fine and keep its history. */
const settleAndSave = async (
  req: Request,
  action: SettleAction,
  amountNpr: number | undefined,
  note: string
) => {
  const issue = await findStudentFineIssue(req);
  const rules = await loadLibraryFineRules(req.tenantSchoolId!);
  const todayBs = getTodayBs();
  const stillOut = issue.status !== "RETURNED";
  let result;
  try {
    result = settleLibraryFine({
      issue: issue.toObject() as never,
      rules,
      todayBs,
      action,
      amountNpr
    });
  } catch (error) {
    throw new ApiError(400, (error as Error).message);
  }

  const name = await actorName(req);
  Object.assign(issue, result.updates);
  issue.fineSettlements = [
    ...(issue.fineSettlements ?? []),
    {
      action,
      amountNpr: result.recordedNpr,
      throughBs: result.updates.fineSettledThroughBs,
      whileOut: stillOut,
      byName: name,
      note,
      at: new Date()
    }
  ] as typeof issue.fineSettlements;
  issue.fineClearedAt = new Date();
  issue.fineClearedByName = name;
  issue.fineClearNote = note;
  await issue.save();

  await recordAudit(req, {
    action:
      action === "PAID"
        ? "library.fine.paid"
        : action === "WAIVED"
          ? "library.fine.waived"
          : "library.fine.adjust",
    entity: "LibraryIssue",
    entityId: String(issue._id),
    before: { owedNpr: result.owedBeforeNpr },
    after: {
      amountNpr: result.recordedNpr,
      owedNpr: result.updates.fineCarriedNpr,
      throughBs: result.updates.fineSettledThroughBs,
      whileOut: stillOut,
      note,
      by: name
    }
  });

  return { issue, result, stillOut, rules };
};

/** PUT /library/fines/:issueId — correct what a student owes (returned or still out). */
export const adjustLibraryFine = asyncHandler(async (req: Request, res: Response) => {
  const payload = adjustSchema.parse(req.body);
  const { issue } = await settleAndSave(req, "ADJUSTED", payload.amountNpr, payload.note ?? "");
  return sendSuccess(res, "Fine updated", issue);
});

/**
 * POST /library/fines/:issueId/clear — collect (in full or part) or waive the
 * fine owed now. Works while the book is still out: what is owed up to today
 * is settled and the fine keeps growing from tomorrow until it is returned.
 */
export const clearLibraryFine = asyncHandler(async (req: Request, res: Response) => {
  const payload = clearSchema.parse(req.body);
  const { issue, result, stillOut } = await settleAndSave(
    req,
    payload.method,
    payload.method === "PAID" ? payload.amountNpr : undefined,
    payload.note ?? ""
  );

  if (issue.studentId) {
    const book = (issue.bookId as unknown as { title?: string } | null)?.title ?? "Library book";
    const left = result.updates.fineCarriedNpr;
    const tail = stillOut
      ? " The book is still not returned, so the fine keeps adding up each day until it is returned."
      : left > 0
        ? ` NPR ${left} is still to pay.`
        : "";
    await sendLibraryFineNotice({
      schoolId: String(req.tenantSchoolId),
      studentId: String(issue.studentId),
      issueId: String(issue._id),
      title: payload.method === "PAID" ? "Library fine payment received" : "Library fine waived",
      message:
        (payload.method === "PAID"
          ? `NPR ${result.recordedNpr} received for your fine on "${book}".`
          : `Your fine of NPR ${result.recordedNpr} on "${book}" has been waived.`) + tail,
      // One message per settlement (a loan can be paid more than once)
      key: `library:FINE_SETTLED:${String(issue._id)}:${(issue.fineSettlements ?? []).length}`
    });
  }

  return sendSuccess(
    res,
    payload.method === "PAID"
      ? result.updates.fineCarriedNpr > 0
        ? `NPR ${result.recordedNpr} recorded — NPR ${result.updates.fineCarriedNpr} still owed`
        : "Fine marked as paid"
      : "Fine waived",
    issue
  );
});
