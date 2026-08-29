import { AcademicLessonPlan } from "../models/AcademicLessonPlan.js";
import { AcademicLessonPlanItem } from "../models/AcademicLessonPlanItem.js";
import { AcademicLogBookEntry } from "../models/AcademicLogBookEntry.js";
import { AcademicSessionPlan } from "../models/AcademicSessionPlan.js";
import { AcademicSyllabus } from "../models/AcademicSyllabus.js";
import { School } from "../models/School.js";
import { Subject } from "../models/Subject.js";
import { Teacher } from "../models/Teacher.js";
import { TimetableSlot } from "../models/TimetableSlot.js";
import { User } from "../models/User.js";
import {
  academicAdminPendingCopy,
  academicKindTitle,
  calcRemainingPercent,
  computeItemStatus,
  isDeadlineApproaching,
  type AcademicNotifyKind
} from "./academicManagementService.js";
import { getDayOfWeekFromBs, getTodayBs } from "./nepaliDate.js";
import { sendNotification } from "./notificationService.js";

const notifiedCache = new Set<string>();

const cacheKey = (parts: string[]): string => parts.join(":");

const shouldNotify = (key: string): boolean => {
  if (notifiedCache.has(key)) return false;
  notifiedCache.add(key);
  if (notifiedCache.size > 5000) {
    notifiedCache.clear();
  }
  return true;
};

const notifySchoolAdmins = async (
  schoolId: string,
  title: string,
  message: string,
  metadata?: Record<string, string>
) => {
  const admins = await User.find({
    schoolId,
    role: { $in: ["COLLEGE_ADMIN", "SUPER_ADMIN"] }
  })
    .select("_id")
    .lean();
  await Promise.all(
    admins.map((admin) =>
      sendNotification({
        schoolId,
        recipientUserId: admin._id.toString(),
        title,
        message,
        type: "ACADEMIC_MANAGEMENT",
        metadata
      })
    )
  );
};

const notifyTeacherUser = async (
  schoolId: string,
  teacherId: string,
  title: string,
  message: string,
  metadata?: Record<string, string>
) => {
  const teacher = await Teacher.findById(teacherId).select("user").lean();
  if (!teacher?.user) return;
  await sendNotification({
    schoolId,
    recipientUserId: teacher.user.toString(),
    title,
    message,
    type: "ACADEMIC_MANAGEMENT",
    metadata
  });
};

/**
 * Refresh stored completionStatus for items with deadlines so DELAYED is current
 * even when no new log book entry was submitted.
 */
const refreshLessonPlanItemStatuses = async (schoolId: string, todayBs: string): Promise<void> => {
  const items = await AcademicLessonPlanItem.find({
    schoolId,
    completionStatus: { $ne: "COMPLETED" }
  }).limit(500);

  for (const item of items) {
    const next = computeItemStatus(
      item.estimatedClasses,
      item.completedClasses,
      item.deadline,
      todayBs
    );
    if (next !== item.completionStatus) {
      item.completionStatus = next;
      await item.save();
    }
  }
};

type PendingReview = {
  kind: AcademicNotifyKind;
  teacherId: string;
  subjectId: string;
  extra?: string;
  entityId: string;
};

const loadNameMaps = async (teacherIds: string[], subjectIds: string[]) => {
  const uniqueTeachers = [...new Set(teacherIds.filter(Boolean))];
  const uniqueSubjects = [...new Set(subjectIds.filter(Boolean))];
  const [teachers, subjects] = await Promise.all([
    uniqueTeachers.length
      ? Teacher.find({ _id: { $in: uniqueTeachers } })
          .select("teacherCode user")
          .populate("user", "fullName")
          .lean()
      : [],
    uniqueSubjects.length
      ? Subject.find({ _id: { $in: uniqueSubjects } }).select("name").lean()
      : []
  ]);
  const teacherNameById = new Map(
    teachers.map((teacher) => [
      teacher._id.toString(),
      (teacher.user as { fullName?: string } | undefined)?.fullName?.trim() ||
        String(teacher.teacherCode || "").trim() ||
        "a teacher"
    ])
  );
  const subjectNameById = new Map(
    subjects.map((subject) => [
      subject._id.toString(),
      String(subject.name || "").trim() || "a subject"
    ])
  );
  return { teacherNameById, subjectNameById };
};

const formatPendingLine = (
  item: PendingReview,
  teacherNameById: Map<string, string>,
  subjectNameById: Map<string, string>
): string => {
  const teacherName = teacherNameById.get(item.teacherId) || "a teacher";
  const subjectName = subjectNameById.get(item.subjectId) || "a subject";
  const extra = item.extra?.trim() ? ` (${item.extra.trim()})` : "";
  return `${academicKindTitle(item.kind)} — ${subjectName}${extra} by ${teacherName}`;
};

const notifyPendingAcademicReviews = async (schoolId: string, todayBs: string): Promise<void> => {
  const [sessionPlans, lessonPlans, syllabi, logEntries] = await Promise.all([
    AcademicSessionPlan.find({
      schoolId,
      isDeleted: { $ne: true },
      status: { $in: ["SUBMITTED", "PENDING_APPROVAL"] }
    })
      .select("teacherId subjectId academicYearBs")
      .lean(),
    AcademicLessonPlan.find({
      schoolId,
      isDeleted: { $ne: true },
      status: { $in: ["SUBMITTED", "PENDING_APPROVAL"] }
    })
      .select("teacherId subjectId month teachingDateBs")
      .lean(),
    AcademicSyllabus.find({
      schoolId,
      isDeleted: { $ne: true },
      status: { $in: ["SUBMITTED", "PENDING_APPROVAL"] }
    })
      .select("teacherId subjectId academicYearBs")
      .lean(),
    AcademicLogBookEntry.find({
      schoolId,
      isDeleted: { $ne: true },
      reviewStatus: "PENDING"
    })
      .select("teacherId subjectId dateBs")
      .limit(40)
      .lean()
  ]);

  const pending: PendingReview[] = [
    ...sessionPlans.map((row) => ({
      kind: "SESSION_PLAN" as const,
      teacherId: row.teacherId?.toString() || "",
      subjectId: row.subjectId?.toString() || "",
      extra: row.academicYearBs,
      entityId: row._id.toString()
    })),
    ...lessonPlans.map((row) => ({
      kind: "LESSON_PLAN" as const,
      teacherId: row.teacherId?.toString() || "",
      subjectId: row.subjectId?.toString() || "",
      extra: row.teachingDateBs || row.month,
      entityId: row._id.toString()
    })),
    ...syllabi.map((row) => ({
      kind: "SYLLABUS" as const,
      teacherId: row.teacherId?.toString() || "",
      subjectId: row.subjectId?.toString() || "",
      extra: row.academicYearBs,
      entityId: row._id.toString()
    })),
    ...logEntries.map((row) => ({
      kind: "LOG_BOOK" as const,
      teacherId: row.teacherId?.toString() || "",
      subjectId: row.subjectId?.toString() || "",
      extra: row.dateBs,
      entityId: row._id.toString()
    }))
  ].filter((row) => row.subjectId);

  if (pending.length === 0) return;

  const key = cacheKey(["admin-pending", schoolId, todayBs, String(pending.length)]);
  if (!shouldNotify(key)) return;

  const { teacherNameById, subjectNameById } = await loadNameMaps(
    pending.map((row) => row.teacherId),
    pending.map((row) => row.subjectId)
  );

  if (pending.length === 1) {
    const item = pending[0]!;
    const copy = academicAdminPendingCopy(
      item.kind,
      teacherNameById.get(item.teacherId) || "a teacher",
      subjectNameById.get(item.subjectId) || "a subject",
      item.extra
    );
    await notifySchoolAdmins(schoolId, copy.title, copy.message, {
      dateBs: todayBs,
      kind: item.kind,
      entityId: item.entityId
    });
    return;
  }

  const listed = pending.slice(0, 8);
  const more = pending.length - listed.length;
  const lines = listed.map((item, index) =>
    `${index + 1}) ${formatPendingLine(item, teacherNameById, subjectNameById)}`
  );
  const message = [
    `${pending.length} academic items are waiting for administrator review: ${lines.join("; ")}.`,
    more > 0 ? `And ${more} more.` : ""
  ]
    .filter(Boolean)
    .join(" ");

  await notifySchoolAdmins(schoolId, "Pending academic reviews", message, {
    dateBs: todayBs,
    count: String(pending.length)
  });
};

export const runAcademicManagementNotifications = async (): Promise<void> => {
  const schools = await School.find({}).select("_id").lean();
  const todayBs = getTodayBs();
  const dayOfWeek = getDayOfWeekFromBs(todayBs);

  for (const school of schools) {
    const schoolId = school._id.toString();

    await refreshLessonPlanItemStatuses(schoolId, todayBs);
    await notifyPendingAcademicReviews(schoolId, todayBs);

    // Incomplete lesson plan items — batch-load plans (avoid N+1)
    const incompleteItems = await AcademicLessonPlanItem.find({
      schoolId,
      completionStatus: { $ne: "COMPLETED" }
    })
      .limit(200)
      .lean();

    const planIds = [...new Set(incompleteItems.map((item) => item.lessonPlanId.toString()))];
    const plans = planIds.length
      ? await AcademicLessonPlan.find({
          _id: { $in: planIds },
          schoolId,
          isDeleted: { $ne: true }
        })
          .select("teacherId month teachingDateBs subjectId")
          .populate("subjectId", "name")
          .lean()
      : [];
    const planMap = new Map(plans.map((plan) => [plan._id.toString(), plan]));

    for (const item of incompleteItems) {
      const plan = planMap.get(item.lessonPlanId.toString());
      if (!plan?.teacherId) continue;

      const liveStatus = computeItemStatus(
        item.estimatedClasses,
        item.completedClasses,
        item.deadline,
        todayBs
      );
      if (liveStatus === "COMPLETED") continue;

      const remainingPercent = calcRemainingPercent(item.estimatedClasses, item.completedClasses);
      const subjectName =
        (plan.subjectId as unknown as { name?: string } | null)?.name ?? "this subject";
      const teacherId = plan.teacherId.toString();
      const when = plan.teachingDateBs || plan.month || "";
      const topic = String(item.plannedTopic || "a planned topic").trim();
      const meta = {
        lessonPlanItemId: item._id.toString(),
        lessonPlanId: plan._id.toString(),
        remainingPercent: String(remainingPercent),
        completedClasses: String(item.completedClasses),
        estimatedClasses: String(item.estimatedClasses),
        dateBs: todayBs
      };

      if (liveStatus === "DELAYED") {
        const key = cacheKey(["overdue", schoolId, item._id.toString(), todayBs]);
        if (!shouldNotify(key)) continue;
        await notifyTeacherUser(
          schoolId,
          teacherId,
          "Lesson plan overdue",
          `Your ${subjectName} lesson plan${when ? ` (${when})` : ""} is overdue: "${topic}" still has ${remainingPercent}% remaining (${item.completedClasses}/${item.estimatedClasses} classes). Please complete it and update the log book.`,
          meta
        );
      } else if (
        isDeadlineApproaching(item.deadline, item.estimatedClasses, item.completedClasses, 3, todayBs)
      ) {
        const key = cacheKey(["approaching", schoolId, item._id.toString(), todayBs]);
        if (!shouldNotify(key)) continue;
        await notifyTeacherUser(
          schoolId,
          teacherId,
          "Lesson plan deadline approaching",
          `Your ${subjectName} lesson plan topic "${topic}" is due ${item.deadline || "soon"}. ${remainingPercent}% remaining — finish on time and record it in the log book.`,
          meta
        );
      }
    }

    // Missing daily log book — only teachers with timetable periods today
    const teachersWithSlots = await TimetableSlot.distinct("teacherId", {
      schoolId,
      dayOfWeek,
      teacherId: { $ne: null }
    });
    if (teachersWithSlots.length === 0) continue;

    const teachersWithLog = await AcademicLogBookEntry.distinct("teacherId", {
      schoolId,
      dateBs: todayBs,
      isDeleted: false
    });
    const loggedSet = new Set(teachersWithLog.map((id) => id.toString()));

    const missingTeacherIds = teachersWithSlots
      .map((id) => id?.toString() || "")
      .filter((id) => id && !loggedSet.has(id));
    if (missingTeacherIds.length === 0) continue;

    const slots = await TimetableSlot.find({
      schoolId,
      dayOfWeek,
      teacherId: { $in: missingTeacherIds }
    })
      .select("teacherId subjectId")
      .populate("subjectId", "name")
      .lean();

    const subjectsByTeacher = new Map<string, string[]>();
    for (const slot of slots) {
      const tid = slot.teacherId?.toString();
      if (!tid) continue;
      const name = (slot.subjectId as unknown as { name?: string } | null)?.name?.trim();
      if (!name) continue;
      const list = subjectsByTeacher.get(tid) ?? [];
      if (!list.includes(name)) list.push(name);
      subjectsByTeacher.set(tid, list);
    }

    for (const tid of missingTeacherIds) {
      const key = cacheKey(["missing-log", schoolId, tid, todayBs]);
      if (!shouldNotify(key)) continue;
      const subjects = subjectsByTeacher.get(tid) ?? [];
      const subjectBit = subjects.length > 0 ? ` for ${subjects.join(", ")}` : "";
      await notifyTeacherUser(
        schoolId,
        tid,
        "Log book not submitted",
        `You have a class scheduled today${subjectBit} (${todayBs}) but have not submitted the teaching log book. Please submit it so lesson plan and syllabus progress stay up to date.`,
        { dateBs: todayBs }
      );
    }
  }
};

export const startAcademicManagementNotificationScheduler = (): void => {
  const intervalMs = 6 * 60 * 60 * 1000;
  const run = () => {
    void runAcademicManagementNotifications().catch((error) => {
      console.error("Academic management notification job failed:", error);
    });
  };
  run();
  setInterval(run, intervalMs);
};
