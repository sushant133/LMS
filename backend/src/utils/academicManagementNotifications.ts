import { AcademicLessonPlan } from "../models/AcademicLessonPlan.js";
import { AcademicLessonPlanItem } from "../models/AcademicLessonPlanItem.js";
import { AcademicLogBookEntry } from "../models/AcademicLogBookEntry.js";
import { AcademicSessionPlan } from "../models/AcademicSessionPlan.js";
import { School } from "../models/School.js";
import { Teacher } from "../models/Teacher.js";
import { TimetableSlot } from "../models/TimetableSlot.js";
import { User } from "../models/User.js";
import {
  calcRemainingPercent,
  computeItemStatus,
  isDeadlineApproaching
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

const notifySchoolAdmins = async (schoolId: string, title: string, message: string, metadata?: Record<string, string>) => {
  const admins = await User.find({ schoolId, role: { $in: ["COLLEGE_ADMIN", "SUPER_ADMIN"] } }).select("_id").lean();
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

const notifyTeacherUser = async (schoolId: string, teacherId: string, title: string, message: string, metadata?: Record<string, string>) => {
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
    const next = computeItemStatus(item.estimatedClasses, item.completedClasses, item.deadline, todayBs);
    if (next !== item.completionStatus) {
      item.completionStatus = next;
      await item.save();
    }
  }
};

export const runAcademicManagementNotifications = async (): Promise<void> => {
  const schools = await School.find({}).select("_id").lean();
  const todayBs = getTodayBs();
  const dayOfWeek = getDayOfWeekFromBs(todayBs);

  for (const school of schools) {
    const schoolId = school._id.toString();

    await refreshLessonPlanItemStatuses(schoolId, todayBs);

    const pendingSessionPlans = await AcademicSessionPlan.countDocuments({
      schoolId,
      isDeleted: false,
      status: { $in: ["SUBMITTED", "PENDING_APPROVAL"] }
    });
    const pendingLessonPlans = await AcademicLessonPlan.countDocuments({
      schoolId,
      isDeleted: false,
      status: { $in: ["SUBMITTED", "PENDING_APPROVAL"] }
    });

    if (pendingSessionPlans + pendingLessonPlans > 0) {
      const key = cacheKey(["admin-pending", schoolId, todayBs]);
      if (shouldNotify(key)) {
        await notifySchoolAdmins(
          schoolId,
          "Pending Academic Approvals",
          `${pendingSessionPlans + pendingLessonPlans} plan(s) are waiting for administrator review.`,
          { dateBs: todayBs }
        );
      }
    }

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
          isDeleted: false
        })
          .select("teacherId month subjectId")
          .populate("subjectId", "name")
          .lean()
      : [];
    const planMap = new Map(plans.map((plan) => [plan._id.toString(), plan]));

    for (const item of incompleteItems) {
      const plan = planMap.get(item.lessonPlanId.toString());
      if (!plan?.teacherId) continue;

      const liveStatus = computeItemStatus(item.estimatedClasses, item.completedClasses, item.deadline, todayBs);
      if (liveStatus === "COMPLETED") continue;

      const remainingPercent = calcRemainingPercent(item.estimatedClasses, item.completedClasses);
      const subjectName = (plan.subjectId as unknown as { name?: string } | null)?.name ?? "Subject";
      const teacherId = plan.teacherId.toString();
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
          "Lesson Plan Overdue",
          `${subjectName} (${plan.month}): "${item.plannedTopic}" is not on time. ${remainingPercent}% remaining (${item.completedClasses}/${item.estimatedClasses} classes). Please complete and update the log book.`,
          meta
        );
      } else if (isDeadlineApproaching(item.deadline, item.estimatedClasses, item.completedClasses, 3, todayBs)) {
        const key = cacheKey(["approaching", schoolId, item._id.toString(), todayBs]);
        if (!shouldNotify(key)) continue;
        await notifyTeacherUser(
          schoolId,
          teacherId,
          "Lesson Plan Deadline Approaching",
          `${subjectName} (${plan.month}): "${item.plannedTopic}" deadline is near (${item.deadline}). ${remainingPercent}% remaining — finish on time.`,
          meta
        );
      }
    }

    // Missing daily log book — only teachers with timetable periods today (reduces noise)
    const teachersWithSlots = await TimetableSlot.distinct("teacherId", { schoolId, dayOfWeek });
    if (teachersWithSlots.length === 0) continue;

    const teachersWithLog = await AcademicLogBookEntry.distinct("teacherId", {
      schoolId,
      dateBs: todayBs,
      isDeleted: false
    });
    const loggedSet = new Set(teachersWithLog.map((id) => id.toString()));

    for (const teacherId of teachersWithSlots) {
      const tid = teacherId.toString();
      if (loggedSet.has(tid)) continue;
      const key = cacheKey(["missing-log", schoolId, tid, todayBs]);
      if (!shouldNotify(key)) continue;
      await notifyTeacherUser(
        schoolId,
        tid,
        "Log Book Not Submitted",
        `You have a class scheduled today but have not submitted the teaching log book (${todayBs}). Please submit it so lesson plan progress stays up to date.`,
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
