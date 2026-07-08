import { AcademicLessonPlan } from "../models/AcademicLessonPlan.js";
import { AcademicLessonPlanItem } from "../models/AcademicLessonPlanItem.js";
import { AcademicLogBookEntry } from "../models/AcademicLogBookEntry.js";
import { AcademicSessionPlan } from "../models/AcademicSessionPlan.js";
import { School } from "../models/School.js";
import { Teacher } from "../models/Teacher.js";
import { User } from "../models/User.js";
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

export const runAcademicManagementNotifications = async (): Promise<void> => {
  const schools = await School.find({}).select("_id").lean();
  const today = new Date().toISOString().slice(0, 10);

  for (const school of schools) {
    const schoolId = school._id.toString();

    const pendingSessionPlans = await AcademicSessionPlan.countDocuments({
      schoolId,
      isDeleted: false,
      status: { $in: ["SUBMITTED", "PENDING_APPROVAL"] }
    });
    const pendingLessonPlans = await AcademicLessonPlan.countDocuments({
      schoolId,
      isDeleted: false,
      status: "PENDING_APPROVAL"
    });

    if (pendingSessionPlans + pendingLessonPlans > 0) {
      const key = cacheKey(["admin-pending", schoolId, today]);
      if (shouldNotify(key)) {
        await notifySchoolAdmins(
          schoolId,
          "Pending Academic Approvals",
          `${pendingSessionPlans + pendingLessonPlans} plan(s) are waiting for administrator review.`,
          { dateBs: today }
        );
      }
    }

    const delayedItems = await AcademicLessonPlanItem.find({
      schoolId,
      completionStatus: "DELAYED"
    })
      .limit(20)
      .lean();

    for (const item of delayedItems) {
      const plan = await AcademicLessonPlan.findById(item.lessonPlanId).select("teacherId month").lean();
      if (!plan) continue;
      const key = cacheKey(["delayed", schoolId, item._id.toString(), today]);
      if (!shouldNotify(key)) continue;
      await notifyTeacherUser(
        schoolId,
        plan.teacherId.toString(),
        "Lesson Plan Deadline Approaching",
        `The topic "${item.plannedTopic}" (${plan.month}) is delayed or nearing its deadline.`,
        { lessonPlanItemId: item._id.toString() }
      );
    }

    const teachers = await Teacher.find({ schoolId }).select("_id").lean();
    const teachersWithLog = await AcademicLogBookEntry.distinct("teacherId", {
      schoolId,
      dateBs: today,
      isDeleted: false
    });
    const loggedSet = new Set(teachersWithLog.map((id) => id.toString()));

    for (const teacher of teachers) {
      if (loggedSet.has(teacher._id.toString())) continue;
      const key = cacheKey(["missing-log", schoolId, teacher._id.toString(), today]);
      if (!shouldNotify(key)) continue;
      await notifyTeacherUser(
        schoolId,
        teacher._id.toString(),
        "Log Book Not Submitted",
        `Please submit today's teaching log book entry.`,
        { dateBs: today }
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