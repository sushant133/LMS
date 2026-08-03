import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { COMPLAINT_CATEGORIES, COMPLAINT_STATUSES, USER_ROLES } from "@phit-erp/shared";

const complaintAttachmentSchema = new Schema(
  {
    url: { type: String, required: true },
    name: { type: String, required: true },
    mimeType: { type: String },
    kind: { type: String, enum: ["FILE", "IMAGE", "PDF", "VIDEO", "LINK"] }
  },
  { _id: false }
);

const complaintSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    submittedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    submitterRole: { type: String, enum: USER_ROLES, required: true },
    subject: { type: String, required: true, trim: true },
    category: { type: String, enum: COMPLAINT_CATEGORIES, required: true },
    content: { type: String, required: true },
    attachments: { type: [complaintAttachmentSchema], default: [] },
    status: { type: String, enum: COMPLAINT_STATUSES, default: "SUBMITTED", index: true },
    adminResponse: { type: String },
    resolvedAt: { type: Date },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

export type ComplaintDocument = InferSchemaType<typeof complaintSchema>;
export const Complaint = mongoose.model("Complaint", complaintSchema);