import mongoose, { Schema, type InferSchemaType } from "mongoose";

const timetableSlotSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    classId: { type: Schema.Types.ObjectId, ref: "SchoolClass", required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    periodNumber: { type: Number, required: true, min: 1 },
    subjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "Teacher", required: true },
    room: { type: String },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    academicYearBs: { type: String, required: true }
  },
  { timestamps: true }
);

timetableSlotSchema.index({ schoolId: 1, classId: 1, sectionId: 1, dayOfWeek: 1, periodNumber: 1, academicYearBs: 1 }, { unique: true });

export type TimetableSlotDocument = InferSchemaType<typeof timetableSlotSchema>;
export const TimetableSlot = mongoose.model("TimetableSlot", timetableSlotSchema);