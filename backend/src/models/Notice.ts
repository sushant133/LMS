import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { USER_ROLES } from "@phit-erp/shared";

const noticeImageSchema = new Schema(
  {
    url: { type: String, required: true },
    thumbnailUrl: { type: String },
    originalName: { type: String },
    width: { type: Number },
    height: { type: Number },
    size: { type: Number }
  },
  { _id: false }
);

const noticeSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    title: { type: String, required: true },
    content: { type: String, required: true },
    images: { type: [noticeImageSchema], default: [] },
    visibleTo: { type: [String], enum: USER_ROLES, required: true },
    publishDateBs: { type: String, required: true },
    expiresAtBs: { type: String },
    subjectId: { type: Schema.Types.ObjectId, ref: "Subject" },
    classId: { type: Schema.Types.ObjectId, ref: "SchoolClass" },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section" },
    teacherId: { type: Schema.Types.ObjectId, ref: "Teacher" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    /**
     * Audience notification lifecycle. PENDING = waiting for its publish date;
     * SENT = delivered (claimed atomically so it never goes out twice).
     * Absent on notices created before notifications existed — those are never sent.
     */
    notificationStatus: { type: String, enum: ["PENDING", "SENT"] },
    notifiedAt: { type: Date }
  },
  { timestamps: true }
);

noticeSchema.index({ notificationStatus: 1, publishDateBs: 1 });

export type NoticeDocument = InferSchemaType<typeof noticeSchema>;
export const Notice = mongoose.model("Notice", noticeSchema);
