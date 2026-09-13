/**
 * Correctness checks for the BS date helpers.
 *
 * Nearly every dated feature — attendance, exams, fees, the calendar digest,
 * syllabus taught dates — routes through these, so an off-by-one here is an
 * off-by-one everywhere. Pure functions, no database needed.
 *
 * Run: npx tsx src/scripts/verifyNepaliDate.ts
 */
import {
  adToBsDate,
  bsToAdDate,
  compareBsDates,
  countInclusiveBsDays,
  getDayNameFromBs,
  getDayOfWeekFromBs,
  getDeadlineStatus,
  getOffsetFromBsDate
} from "../utils/nepaliDate.js";

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} (got ${String(actual)}, want ${String(expected)})`);
};
const checkThrows = (label: string, fn: () => unknown) => {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) failures += 1;
  console.log(`${threw ? "PASS" : "FAIL"}  ${label}`);
};

// --- round trip -------------------------------------------------------------
const bs = "2083-04-12";
const ad = bsToAdDate(bs).dateAd;
check("BS -> AD -> BS round trip", adToBsDate(ad).dateBs, bs);
check("weekday agrees across conversion", adToBsDate(ad).dayOfWeek, getDayNameFromBs(bs));

// --- offsets ----------------------------------------------------------------
check("offset 0 is identity", getOffsetFromBsDate("2083-04-12", 0), "2083-04-12");
check("offset +1 inside a month", getOffsetFromBsDate("2083-04-12", 1), "2083-04-13");
check("offset -1 inside a month", getOffsetFromBsDate("2083-04-12", -1), "2083-04-11");
check(
  "offset +1 and -1 cancel",
  getOffsetFromBsDate(getOffsetFromBsDate("2083-04-12", 1), -1),
  "2083-04-12"
);
// Month rollover: Baisakh 2083 has 31 days, so 01-31 + 1 = 02-01.
check("rolls into the next BS month", getOffsetFromBsDate("2083-01-31", 1), "2083-02-01");
check("rolls back into the previous month", getOffsetFromBsDate("2083-02-01", -1), "2083-01-31");
// Year rollover.
check("rolls into the next BS year", getOffsetFromBsDate("2082-12-30", 1), "2083-01-01");
check("rolls back into the previous year", getOffsetFromBsDate("2083-01-01", -1), "2082-12-30");
check("offset +365 stays a valid date", /^\d{4}-\d{2}-\d{2}$/.test(getOffsetFromBsDate("2083-04-12", 365)), true);

// --- ordering ---------------------------------------------------------------
check("compare: earlier < later (day)", compareBsDates("2083-04-11", "2083-04-12"), -1);
check("compare: later > earlier (day)", compareBsDates("2083-04-13", "2083-04-12"), 1);
check("compare: equal", compareBsDates("2083-04-12", "2083-04-12"), 0);
check("compare: month dominates day", compareBsDates("2083-03-30", "2083-04-01"), -1);
check("compare: year dominates month", compareBsDates("2082-12-30", "2083-01-01"), -1);

// Zero-padded strings must sort the same way lexicographically, because the
// backfill and digest code rely on plain string comparison for "latest".
const sorted = ["2083-04-09", "2083-04-02", "2083-12-01", "2082-11-30"].sort();
check("string sort matches BS order", sorted.join(","), "2082-11-30,2083-04-02,2083-04-09,2083-12-01");

// --- inclusive day count ----------------------------------------------------
check("same day counts as 1", countInclusiveBsDays("2083-04-12", "2083-04-12"), 1);
check("two consecutive days", countInclusiveBsDays("2083-04-12", "2083-04-13"), 2);
check("across a month boundary", countInclusiveBsDays("2083-01-31", "2083-02-01"), 2);
checkThrows("end before start throws", () => countInclusiveBsDays("2083-04-13", "2083-04-12"));

// --- weekday ----------------------------------------------------------------
const dow = getDayOfWeekFromBs("2083-04-12");
check("weekday index in range", dow >= 0 && dow <= 6, true);
check("weekday name matches index", getDayNameFromBs("2083-04-12"), [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
][dow]);
// Seven consecutive days must cover seven distinct weekday names.
const names = new Set<string>();
let cursor = "2083-04-12";
for (let i = 0; i < 7; i += 1) {
  names.add(getDayNameFromBs(cursor));
  cursor = getOffsetFromBsDate(cursor, 1);
}
check("7 consecutive days = 7 distinct weekdays", names.size, 7);

// --- deadline status --------------------------------------------------------
check("deadline in the past", getDeadlineStatus("2083-04-11", "2083-04-12"), "OVERDUE");
check("deadline today", getDeadlineStatus("2083-04-12", "2083-04-12"), "DUE_TODAY");
check("deadline ahead", getDeadlineStatus("2083-04-13", "2083-04-12"), "UPCOMING");
check("no deadline", getDeadlineStatus(undefined, "2083-04-12"), null);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
