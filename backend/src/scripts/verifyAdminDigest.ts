/**
 * Rules check for the administrator daily roll-up.
 * Run: npx tsx src/scripts/verifyAdminDigest.ts
 */
import mongoose from "mongoose";
import { AcademicLessonPlanItem } from "../models/AcademicLessonPlanItem.js";
import { DailyAttendance } from "../models/DailyAttendance.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { LibraryIssue } from "../models/LibraryBook.js";
import { buildAdminDailyDigest } from "../utils/adminDailyDigest.js";

const URI = "mongodb://127.0.0.1:27017/phit_admindigest_check";
const TODAY = "2083-05-27";
const schoolId = new mongoose.Types.ObjectId();

/** DailyAttendance requires a full sheet context; only `entries` matters here. */
const attendanceSheet = (entries: Array<{ studentId: mongoose.Types.ObjectId; status: string }>) => ({
  schoolId,
  dateBs: TODAY,
  academicYearBs: "2083",
  dayOfWeek: 1,
  teacherId: new mongoose.Types.ObjectId(),
  subjectId: new mongoose.Types.ObjectId(),
  createdBy: new mongoose.Types.ObjectId(),
  entries
});

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const reset = async () => {
  await Promise.all([
    DailyAttendance.deleteMany({ schoolId }),
    LeaveRequest.deleteMany({ schoolId }),
    LibraryIssue.deleteMany({ schoolId }),
    AcademicLessonPlanItem.deleteMany({ schoolId })
  ]);
};

const main = async () => {
  await mongoose.connect(URI);
  await mongoose.connection.db?.dropDatabase();

  // 1. Quiet school -> no digest at all.
  await reset();
  check("nothing outstanding -> silent", (await buildAdminDailyDigest(schoolId.toString(), TODAY)) === null);

  // 2. Attendance taken, everyone present -> still silent (nothing to act on).
  await reset();
  await DailyAttendance.create(
    attendanceSheet([
      { studentId: new mongoose.Types.ObjectId(), status: "PRESENT" },
      { studentId: new mongoose.Types.ObjectId(), status: "PRESENT" }
    ])
  );
  check("full attendance -> silent", (await buildAdminDailyDigest(schoolId.toString(), TODAY)) === null);

  // 3. Absences -> reported as a count, not one message per student.
  await reset();
  await DailyAttendance.create(
    attendanceSheet([
      { studentId: new mongoose.Types.ObjectId(), status: "ABSENT" },
      { studentId: new mongoose.Types.ObjectId(), status: "ABSENT" },
      { studentId: new mongoose.Types.ObjectId(), status: "MEDICAL_LEAVE" },
      { studentId: new mongoose.Types.ObjectId(), status: "PRESENT" }
    ])
  );
  const att = await buildAdminDailyDigest(schoolId.toString(), TODAY);
  check(
    "absences -> one counted line",
    Boolean(att && att.message.includes("2 student(s) absent") && att.message.includes("1 on leave")),
    att?.message
  );

  // 4. Pending approvals and overdue items each add their own section.
  await reset();
  await LeaveRequest.create({
    schoolId,
    teacherId: new mongoose.Types.ObjectId(),
    type: "SICK",
    startDateBs: TODAY,
    endDateBs: TODAY,
    reason: "Fever",
    status: "PENDING"
  });
  await LibraryIssue.create({
    schoolId,
    bookId: new mongoose.Types.ObjectId(),
    studentId: new mongoose.Types.ObjectId(),
    issuedDateBs: "2083-05-01",
    dueDateBs: "2083-05-10",
    status: "OVERDUE"
  });
  await AcademicLessonPlanItem.create({
    schoolId,
    lessonPlanId: new mongoose.Types.ObjectId(),
    serialNo: 1,
    plannedTopic: "Photosynthesis",
    estimatedClasses: 4,
    completedClasses: 1,
    completionStatus: "DELAYED"
  });
  const multi = await buildAdminDailyDigest(schoolId.toString(), TODAY);
  check(
    "approvals + overdue -> three sections",
    Boolean(
      multi &&
        multi.sections === 3 &&
        multi.message.includes("Leave requests:") &&
        multi.message.includes("Library:") &&
        multi.message.includes("Lesson plans:")
    ),
    multi?.message
  );

  // 5. An APPROVED leave is not "waiting for approval".
  await LeaveRequest.updateMany({ schoolId }, { status: "APPROVED" });
  const afterApproval = await buildAdminDailyDigest(schoolId.toString(), TODAY);
  check(
    "approved leave drops out",
    Boolean(afterApproval && !afterApproval.message.includes("Leave requests:")),
    afterApproval?.message
  );
  console.log(`\n      example: "${multi?.title}"\n      ${multi?.message}\n`);

  await mongoose.connection.db?.dropDatabase();
  await mongoose.disconnect();
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
