import mongoose from "mongoose";
import { connectDatabase } from "../config/db.js";
import { Assignment, AssignmentSubmission } from "../models/Assignment.js";
import { AssignmentComment } from "../models/AssignmentComment.js";
import { Notification } from "../models/Notification.js";

/**
 * Deletes all classroom assignments (HOMEWORK / CAS / NOTE), related
 * submissions, comments, and homework notifications.
 */
const run = async (): Promise<void> => {
  await connectDatabase();

  const before = await Assignment.countDocuments({});
  const [assignments, submissions, comments, homeworkNotifs] = await Promise.all([
    Assignment.deleteMany({}),
    AssignmentSubmission.deleteMany({}),
    AssignmentComment.deleteMany({}),
    Notification.deleteMany({ type: "HOMEWORK" })
  ]);

  console.log(
    JSON.stringify(
      {
        assignmentsBefore: before,
        assignmentsDeleted: assignments.deletedCount,
        submissionsDeleted: submissions.deletedCount,
        commentsDeleted: comments.deletedCount,
        homeworkNotificationsDeleted: homeworkNotifs.deletedCount
      },
      null,
      2
    )
  );

  await mongoose.connection.close();
};

run().catch(async (error) => {
  console.error("Failed to clear assignments", error);
  await mongoose.connection.close().catch(() => undefined);
  process.exit(1);
});
