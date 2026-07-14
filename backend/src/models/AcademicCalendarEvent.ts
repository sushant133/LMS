import mongoose, { Schema, type InferSchemaType } from "mongoose";
import {
  ACADEMIC_CALENDAR_EVENT_STATUSES,
  ACADEMIC_CALENDAR_EVENT_TYPES
} from "@phit-erp/shared";

const academicCalendarAuditSchema = new Schema(
  {
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { _id: false, timestamps: true }
);

const academicCalendarEventSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    academicYearBs: { type: String, required: true, index: true },
    /** Primary / start date (BS). Kept for backward compatibility with single-day queries. */
    dateBs: { type: String, required: true, index: true },
    startDateBs: { type: String, required: true, index: true },
    endDateBs: { type: String, required: true, index: true },
    dateAd: { type: String, required: true },
    startDateAd: { type: String, required: true },
    endDateAd: { type: String, required: true },
    dayOfWeek: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    eventType: { type: String, enum: ACADEMIC_CALENDAR_EVENT_TYPES, required: true, index: true },
    reason: { type: String, trim: true },
    isHoliday: { type: Boolean, required: true, default: false },
    status: {
      type: String,
      enum: ACADEMIC_CALENDAR_EVENT_STATUSES,
      required: true,
      default: "ACTIVE",
      index: true
    },
    /** When true, this entry marks a Saturday (or holiday) as a working day. */
    isWorkingDayOverride: { type: Boolean, default: false },
    audit: { type: academicCalendarAuditSchema, default: () => ({}) }
  },
  { timestamps: true }
);

academicCalendarEventSchema.index({ schoolId: 1, academicYearBs: 1, startDateBs: 1, endDateBs: 1 });
academicCalendarEventSchema.index({ schoolId: 1, startDateBs: 1, endDateBs: 1 });
academicCalendarEventSchema.index({ schoolId: 1, dateBs: 1, name: 1 });

export type AcademicCalendarEventDocument = InferSchemaType<typeof academicCalendarEventSchema>;
export const AcademicCalendarEvent = mongoose.model("AcademicCalendarEvent", academicCalendarEventSchema);
