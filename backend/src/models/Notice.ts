import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { USER_ROLES } from "@nepal-school-erp/shared";

const noticeSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    title: { type: String, required: true },
    content: { type: String, required: true },
    visibleTo: { type: [String], enum: USER_ROLES, required: true },
    publishDateBs: { type: String, required: true },
    expiresAtBs: { type: String },
    subjectId: { type: Schema.Types.ObjectId, ref: "Subject" },
    classId: { type: Schema.Types.ObjectId, ref: "SchoolClass" },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section" },
    teacherId: { type: Schema.Types.ObjectId, ref: "Teacher" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

export type NoticeDocument = InferSchemaType<typeof noticeSchema>;
export const Notice = mongoose.model("Notice", noticeSchema);
