import { User } from "../models/User.js";
import { sendNotification } from "./notificationService.js";

interface NotifyPromotionInput {
  schoolId: string;
  title: string;
  message: string;
  promotionId: string;
  academicSessionBs: string;
}

/**
 * Notify Super Admin, Admin, College Administrator (viewer), and Teachers
 * after a successful academic promotion or rollback.
 */
export const notifyAcademicPromotionStakeholders = async (input: NotifyPromotionInput): Promise<number> => {
  const recipients = await User.find({
    schoolId: input.schoolId,
    isActive: { $ne: false },
    role: { $in: ["SUPER_ADMIN", "COLLEGE_ADMIN", "COLLEGE_VIEWER", "TEACHER"] }
  })
    .select("_id")
    .lean();

  // Super admins may have null schoolId — include tenant-less super admins who manage the system
  const superAdmins = await User.find({
    role: "SUPER_ADMIN",
    isActive: { $ne: false }
  })
    .select("_id")
    .lean();

  const recipientIds = new Set<string>([
    ...recipients.map((user) => user._id.toString()),
    ...superAdmins.map((user) => user._id.toString())
  ]);

  await Promise.all(
    [...recipientIds].map((userId) =>
      sendNotification({
        schoolId: input.schoolId,
        recipientUserId: userId,
        title: input.title,
        message: input.message,
        type: "ACADEMIC_PROMOTION",
        channel: "IN_APP",
        metadata: {
          promotionId: input.promotionId,
          academicSessionBs: input.academicSessionBs
        }
      })
    )
  );

  return recipientIds.size;
};

export const buildPromotionSuccessMessage = (
  groups: Array<{ batchName: string; previousYearName: string; newYearName: string; outcome: string; studentCount: number }>
): string => {
  const lines = groups.map((group) => {
    if (group.outcome === "PASSED_OUT") {
      return `Batch ${group.batchName} has been moved to Passed Out (${group.studentCount} students).`;
    }
    return `Batch ${group.batchName} has been promoted from ${group.previousYearName} to ${group.newYearName} (${group.studentCount} students).`;
  });

  return ["Academic Promotion Completed Successfully.", ...lines].join("\n");
};
