import mongoose, { Schema, type InferSchemaType } from "mongoose";

const dailyAttendanceLogSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    dailyAttendanceId: { type: Schema.Types.ObjectId, ref: "DailyAttendance", required: true, index: true },
    action: {
      type: String,
      enum: ["CREATE", "SUBMIT", "UPDATE", "UNLOCK", "DELETE", "SYNC", "SYNC_UPDATE", "REASSIGN"],
      required: true
    },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    actorRole: { type: String, required: true },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    synchronizationStatus: { type: String },
    metadata: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

export type DailyAttendanceLogDocument = InferSchemaType<typeof dailyAttendanceLogSchema>;
export const DailyAttendanceLog = mongoose.model("DailyAttendanceLog", dailyAttendanceLogSchema);