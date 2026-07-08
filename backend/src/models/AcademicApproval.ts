import mongoose, { Schema, type InferSchemaType } from "mongoose";

const approvalSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    entityType: { type: String, enum: ["SESSION_PLAN", "LESSON_PLAN", "LOG_BOOK_ENTRY"], required: true, index: true },
    entityId: { type: Schema.Types.ObjectId, required: true, index: true },
    action: { type: String, enum: ["SUBMITTED", "APPROVED", "REJECTED", "UNLOCKED"], required: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    actorRole: { type: String, required: true },
    remarks: { type: String }
  },
  { timestamps: true }
);

export type AcademicApprovalDocument = InferSchemaType<typeof approvalSchema>;
export const AcademicApproval = mongoose.model("AcademicApproval", approvalSchema);