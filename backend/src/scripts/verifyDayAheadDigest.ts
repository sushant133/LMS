/**
 * Rules check for the evening "what's on tomorrow" digest.
 *
 * Run: npx tsx src/scripts/verifyDayAheadDigest.ts
 */
import mongoose from "mongoose";
import { AcademicCalendarEvent } from "../models/AcademicCalendarEvent.js";
import { Exam } from "../models/Exam.js";
import { buildDayAheadDigest } from "../utils/academicCalendarNotifications.js";
import { getDayNameFromBs, getOffsetFromBsDate } from "../utils/nepaliDate.js";

const URI = "mongodb://127.0.0.1:27017/phit_dayahead_check";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const schoolId = new mongoose.Types.ObjectId();

/** Pick a "today" whose tomorrow lands on the requested weekday. */
const todayWhoseTomorrowIs = (weekday: string): string => {
  let cursor = "2083-04-01";
  for (let i = 0; i < 14; i += 1) {
    if (getDayNameFromBs(getOffsetFromBsDate(cursor, 1)) === weekday) return cursor;
    cursor = getOffsetFromBsDate(cursor, 1);
  }
  throw new Error(`no ${weekday} found`);
};

const addEvent = (fields: Record<string, unknown>) =>
  AcademicCalendarEvent.create({
    schoolId,
    academicYearBs: "2083",
    dateAd: "2026-07-16",
    startDateAd: "2026-07-16",
    endDateAd: "2026-07-16",
    dayOfWeek: "Sunday",
    status: "ACTIVE",
    isHoliday: false,
    ...fields
  });

const reset = async () => {
  await AcademicCalendarEvent.deleteMany({ schoolId });
  await Exam.deleteMany({ schoolId });
};

const main = async () => {
  await mongoose.connect(URI);
  await mongoose.connection.db?.dropDatabase();

  const satToday = todayWhoseTomorrowIs("Saturday");
  const satTomorrow = getOffsetFromBsDate(satToday, 1);
  const sunToday = todayWhoseTomorrowIs("Sunday");
  const sunTomorrow = getOffsetFromBsDate(sunToday, 1);

  // 1. Nothing at all scheduled -> stay silent.
  await reset();
  check("empty calendar -> no notification", (await buildDayAheadDigest(schoolId.toString(), sunToday)) === null);

  // 2. Routine Saturday holiday -> stay silent (explicitly requested).
  await reset();
  await addEvent({
    name: "Saturday",
    eventType: "COLLEGE_HOLIDAY",
    dateBs: satTomorrow,
    startDateBs: satTomorrow,
    endDateBs: satTomorrow,
    isHoliday: true
  });
  check("routine Saturday holiday -> silent", (await buildDayAheadDigest(schoolId.toString(), satToday)) === null);

  // 3. Saturday turned into a working day -> that IS news.
  await reset();
  await addEvent({
    name: "Make-up classes",
    eventType: "WORKING_DAY",
    dateBs: satTomorrow,
    startDateBs: satTomorrow,
    endDateBs: satTomorrow,
    isWorkingDayOverride: true
  });
  const working = await buildDayAheadDigest(schoolId.toString(), satToday);
  check("working Saturday -> notifies", working?.title === "Tomorrow is a working day", working?.message);

  // 4. Festival holiday on a weekday -> notify, with the end date.
  await reset();
  await addEvent({
    name: "Dashain",
    eventType: "DASHAIN_VACATION",
    dateBs: sunTomorrow,
    startDateBs: sunTomorrow,
    endDateBs: getOffsetFromBsDate(sunTomorrow, 8),
    isHoliday: true
  });
  const holiday = await buildDayAheadDigest(schoolId.toString(), sunToday);
  check(
    "weekday holiday -> notifies with range",
    holiday?.title === "Tomorrow is a holiday" && holiday.message.includes("through"),
    holiday?.message
  );

  // 5. A multi-day vacation ALREADY running -> no repeat the next evening.
  const midVacationToday = getOffsetFromBsDate(sunTomorrow, 3);
  check(
    "vacation already running -> no repeat",
    (await buildDayAheadDigest(schoolId.toString(), midVacationToday)) === null
  );

  // 6. Exam starting tomorrow -> dedicated line.
  await reset();
  await Exam.create({
    schoolId,
    name: "First Terminal Examination",
    academicYearBs: "2083",
    startDateBs: sunTomorrow,
    endDateBs: getOffsetFromBsDate(sunTomorrow, 5),
    status: "SCHEDULED"
  });
  const exam = await buildDayAheadDigest(schoolId.toString(), sunToday);
  check(
    "exam starts tomorrow -> notifies",
    exam?.title === "Your exams start tomorrow" &&
      exam.message.includes("First Terminal Examination"),
    exam?.message
  );

  // 7. DRAFT exams are not announced.
  await reset();
  await Exam.create({
    schoolId,
    name: "Unannounced Draft Exam",
    academicYearBs: "2083",
    startDateBs: sunTomorrow,
    endDateBs: sunTomorrow,
    status: "DRAFT"
  });
  check("draft exam -> silent", (await buildDayAheadDigest(schoolId.toString(), sunToday)) === null);

  // 8. A bare "working day" row on a normal weekday is not news.
  await reset();
  await addEvent({
    name: "Regular class day",
    eventType: "WORKING_DAY",
    dateBs: sunTomorrow,
    startDateBs: sunTomorrow,
    endDateBs: sunTomorrow
  });
  check("plain working-day row -> silent", (await buildDayAheadDigest(schoolId.toString(), sunToday)) === null);

  // 9. Holiday + exam + event together -> ONE organised message, all sections.
  await reset();
  await addEvent({
    name: "Saraswati Puja",
    eventType: "FESTIVAL_HOLIDAY",
    dateBs: sunTomorrow,
    startDateBs: sunTomorrow,
    endDateBs: sunTomorrow,
    isHoliday: true
  });
  await addEvent({
    name: "Annual Sports Week",
    eventType: "SPORTS_WEEK",
    dateBs: sunTomorrow,
    startDateBs: sunTomorrow,
    endDateBs: getOffsetFromBsDate(sunTomorrow, 4)
  });
  await Exam.create({
    schoolId,
    name: "Practical Examination",
    academicYearBs: "2083",
    startDateBs: sunTomorrow,
    endDateBs: sunTomorrow,
    status: "SCHEDULED"
  });
  const combined = await buildDayAheadDigest(schoolId.toString(), sunToday);
  check(
    "combined day -> one message, three sections",
    Boolean(
      combined &&
        combined.message.includes("Holiday:") &&
        combined.message.includes("Exams start tomorrow:") &&
        combined.message.includes("Events:")
    ),
    combined?.message
  );
  console.log(`\n      example: "${combined?.title}"\n      ${combined?.message}\n`);

  await mongoose.connection.db?.dropDatabase();
  await mongoose.disconnect();
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
