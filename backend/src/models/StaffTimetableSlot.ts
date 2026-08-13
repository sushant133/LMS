import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { STAFF_TIMETABLE_SESSION_TYPES } from "@phit-erp/shared";

/**
 * Weekly duty timetable for non-teaching college staff.
 *
 * Kept separate from TimetableSlot rather than folded into it: that model is
 * keyed on academic groups (class+section or batch+year) with unique indexes to
 * match, and requires a subject/teacher pair for anything that is not a break.
 * A staff roster has none of those — it is keyed on the staff member — so
 * sharing the collection would mean partial indexes and validation branches on
 * every academic write path.
 */
const staffTimetableSlotSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    staffId: {
      type: Schema.Types.ObjectId,
      ref: "CollegeStaff",
      required: true,
      index: true
    },
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    /** DUTY: 1–12. BREAK/DAY_OFF: synthetic ≥1000 derived from startTime. */
    periodNumber: { type: Number, required: true, min: 0 },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    academicYearBs: { type: String, required: true },
    sessionType: {
      type: String,
      enum: STAFF_TIMETABLE_SESSION_TYPES,
      default: "DUTY"
    },
    /** What the staff member is doing in this period. */
    dutyTitle: { type: String, trim: true, default: "" },
    /** Where — room, counter, gate. Also what room clash detection matches on. */
    room: { type: String, trim: true, default: "" },
    /** Snapshotted from the staff record at write time so the grid can colour by it. */
    department: { type: String, trim: true, default: "" },
    breakLabel: { type: String, trim: true, default: "" },
    remarks: { type: String, trim: true, default: "" }
  },
  { timestamps: true }
);

/** One entry per staff member per period column per day, within an academic year. */
staffTimetableSlotSchema.index(
  { schoolId: 1, staffId: 1, dayOfWeek: 1, periodNumber: 1, academicYearBs: 1 },
  { unique: true }
);
/** Backs the room double-booking check. */
staffTimetableSlotSchema.index({ schoolId: 1, room: 1, dayOfWeek: 1, academicYearBs: 1 });

export type StaffTimetableSlotDocument = InferSchemaType<typeof staffTimetableSlotSchema>;
export const StaffTimetableSlot = mongoose.model(
  "StaffTimetableSlot",
  staffTimetableSlotSchema
);
