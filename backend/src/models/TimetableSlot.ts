import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { TIMETABLE_ROOM_KINDS, TIMETABLE_SESSION_TYPES } from "@phit-erp/shared";

const timetableSlotSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    classId: { type: Schema.Types.ObjectId, ref: "SchoolClass" },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section" },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch" },
    yearId: { type: Schema.Types.ObjectId, ref: "Year" },
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    periodNumber: { type: Number, required: true, min: 1 },
    /** Optional for BREAK/HOLIDAY periods */
    subjectId: { type: Schema.Types.ObjectId, ref: "Subject" },
    teacherId: { type: Schema.Types.ObjectId, ref: "Teacher" },
    /** Optional link to SubjectAssignment (multi-teacher / unit / % splits) */
    subjectAssignmentId: { type: Schema.Types.ObjectId, ref: "SubjectAssignment", default: null },
    room: { type: String },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    academicYearBs: { type: String, required: true },
    /** Optional session kind — legacy rows without this field read as THEORY */
    sessionType: {
      type: String,
      enum: TIMETABLE_SESSION_TYPES,
      default: "THEORY"
    },
    breakLabel: { type: String, trim: true, default: "" },
    remarks: { type: String, trim: true, default: "" },
    roomKind: {
      type: String,
      enum: TIMETABLE_ROOM_KINDS,
      required: false
    }
  },
  { timestamps: true }
);

timetableSlotSchema.index(
  { schoolId: 1, classId: 1, sectionId: 1, dayOfWeek: 1, periodNumber: 1, academicYearBs: 1 },
  { unique: true, partialFilterExpression: { classId: { $exists: true }, sectionId: { $exists: true } } }
);
timetableSlotSchema.index(
  { schoolId: 1, batchId: 1, yearId: 1, dayOfWeek: 1, periodNumber: 1, academicYearBs: 1 },
  { unique: true, partialFilterExpression: { batchId: { $exists: true }, yearId: { $exists: true } } }
);
timetableSlotSchema.index({ schoolId: 1, teacherId: 1, dayOfWeek: 1, academicYearBs: 1 });
timetableSlotSchema.index({ schoolId: 1, room: 1, dayOfWeek: 1, academicYearBs: 1 });

export type TimetableSlotDocument = InferSchemaType<typeof timetableSlotSchema>;
export const TimetableSlot = mongoose.model("TimetableSlot", timetableSlotSchema);
