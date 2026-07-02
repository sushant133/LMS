import mongoose, { Schema, type InferSchemaType } from "mongoose";

const auditLogSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    actorRole: { type: String, required: true },
    action: { type: String, required: true, index: true }, // e.g. "student.create", "fee.collection", "result.update"
    entity: { type: String, required: true, index: true }, // "Student", "FeeCollection", etc.
    entityId: { type: String, required: true },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    ipAddress: { type: String },
    userAgent: { type: String }
  },
  { timestamps: true }
);

// Compound indexes for efficient compliance queries
auditLogSchema.index({ schoolId: 1, createdAt: -1 });
auditLogSchema.index({ schoolId: 1, entity: 1, createdAt: -1 });
auditLogSchema.index({ schoolId: 1, actorUserId: 1, createdAt: -1 });

export type AuditLogDocument = InferSchemaType<typeof auditLogSchema>;
export const AuditLog = mongoose.model("AuditLog", auditLogSchema);
