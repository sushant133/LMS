import type { ClientSession, Types } from "mongoose";
import { AccountingSettings } from "../models/AccountingSettings.js";
import { VoucherCounter } from "../models/VoucherCounter.js";
import { getFiscalYearFromBsDate } from "./fiscalYear.js";

/**
 * Single source of sequential numbering for every accounting document series.
 *
 * Journal vouchers already numbered themselves from `VoucherCounter`; fee receipts and the
 * expense / purchase / income registers still derived their numbers from `countDocuments()`
 * plus a few random characters. That was neither sequential nor gap-free — the count
 * included soft-deleted rows, two cashiers posting at once read the same count, and the
 * random suffix was there purely to paper over the resulting collisions. IRD expects a
 * gap-free series per fiscal year, so every series is now handed out by one atomic `$inc`.
 *
 * Series shapes are `${prefix}-${fiscal year label}-${5-digit seq}`, e.g. `RCPT-2083-84-00001`.
 * None of them can collide with the old shapes (`RCPT-2026-00001-A1B2`, `EXP-00001-A1B`),
 * so documents numbered under the old scheme keep their numbers untouched.
 */

/** "2083/2084" -> "2083-84", the form printed on Nepali vouchers. */
export const formatFiscalYearLabel = (fiscalYearBs: string): string => {
  const [start, end] = fiscalYearBs.split("/");
  if (!start) return fiscalYearBs.replace(/\//g, "-");
  const shortEnd = (end ?? "").slice(-2);
  return shortEnd ? `${start}-${shortEnd}` : start;
};

interface NextVoucherNumberParams {
  schoolId: Types.ObjectId;
  /** Series prefix, e.g. "JV", "RCPT", "EXP". Also keys the counter. */
  prefix: string;
  fiscalYearBs: string;
  session?: ClientSession | null;
}

/**
 * Next number in a gap-free, per-fiscal-year series.
 *
 * Pass the caller's `session` so that a transaction which aborts also rolls the sequence
 * back — otherwise a failed posting burns a number and leaves a hole in the series.
 */
export const nextVoucherNumber = async ({
  schoolId,
  prefix,
  fiscalYearBs,
  session
}: NextVoucherNumberParams): Promise<string> => {
  const scope = `${prefix}:${fiscalYearBs}`;
  const query = VoucherCounter.findOneAndUpdate(
    { schoolId, scope },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  if (session) query.session(session);
  const counter = await query;

  return `${prefix}-${formatFiscalYearLabel(fiscalYearBs)}-${String(counter.seq).padStart(5, "0")}`;
};

interface NextVoucherNumberForDateParams {
  schoolId: Types.ObjectId;
  prefix: string;
  /** BS date (YYYY-MM-DD) the document is posted on; decides which year's series it joins. */
  dateBs: string;
  session?: ClientSession | null;
}

/**
 * As `nextVoucherNumber`, for callers that hold a BS date rather than a resolved fiscal year.
 *
 * The series follows the *document* date, not today's date, so a voucher backdated into the
 * previous fiscal year is numbered in that year's series rather than the current one.
 */
export const nextVoucherNumberForDate = async ({
  schoolId,
  prefix,
  dateBs,
  session
}: NextVoucherNumberForDateParams): Promise<string> => {
  const settingsQuery = AccountingSettings.findOne({ schoolId }).select("currentFiscalYearBs");
  if (session) settingsQuery.session(session);
  const settings = await settingsQuery.lean();

  return nextVoucherNumber({
    schoolId,
    prefix,
    fiscalYearBs: getFiscalYearFromBsDate(dateBs, settings?.currentFiscalYearBs),
    session
  });
};
