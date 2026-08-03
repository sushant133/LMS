import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { softDeletePlugin } from "../plugins/softDeletePlugin.js";
import { USER_ROLES } from "@phit-erp/shared";

const assignmentCommentSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    assignmentId: { type: Schema.Types.ObjectId, ref: "Assignment", required: true, index: true },
    authorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    authorName: { type: String, required: true },
    authorRole: { type: String, enum: USER_ROLES, required: true },
    content: { type: String, required: true, trim: true, maxlength: 2000 }
  },
  { timestamps: true }
);

export type AssignmentCommentDocument = InferSchemaType<typeof assignmentCommentSchema>;
assignmentCommentSchema.plugin(softDeletePlugin);
export const AssignmentComment = mongoose.model("AssignmentComment", assignmentCommentSchema);