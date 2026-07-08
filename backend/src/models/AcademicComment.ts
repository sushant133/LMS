import mongoose, { Schema, type InferSchemaType } from "mongoose";

const commentSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    entityType: { type: String, enum: ["SESSION_PLAN", "LESSON_PLAN", "LOG_BOOK_ENTRY"], required: true, index: true },
    entityId: { type: Schema.Types.ObjectId, required: true, index: true },
    authorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    authorRole: { type: String, required: true },
    authorName: { type: String, required: true },
    comment: { type: String, required: true }
  },
  { timestamps: true }
);

export type AcademicCommentDocument = InferSchemaType<typeof commentSchema>;
export const AcademicComment = mongoose.model("AcademicComment", commentSchema);