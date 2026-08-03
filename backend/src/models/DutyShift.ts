import mongoose, { Schema, type InferSchemaType } from "mongoose";

const dutyShiftSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    name: { type: String, required: true, trim: true },
    shortCode: { type: String, required: true, trim: true, uppercase: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    dutyHours: { type: Number, required: true, min: 0, max: 24 },
    sortOrder: { type: Number, default: 100 },
    isActive: { type: Boolean, default: true },
    isSystem: { type: Boolean, default: false },
    color: { type: String, default: "" },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

dutyShiftSchema.index({ schoolId: 1, shortCode: 1 }, { unique: true });

export type DutyShiftDocument = InferSchemaType<typeof dutyShiftSchema>;
export const DutyShift = mongoose.model("DutyShift", dutyShiftSchema);
