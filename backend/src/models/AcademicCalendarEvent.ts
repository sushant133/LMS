import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { ACADEMIC_CALENDAR_EVENT_TYPES } from "@phit-erp/shared";

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
    dateBs: { type: String, required: true, index: true },
    dateAd: { type: String, required: true },
    dayOfWeek: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    eventType: { type: String, enum: ACADEMIC_CALENDAR_EVENT_TYPES, required: true, index: true },
    reason: { type: String, trim: true },
    isHoliday: { type: Boolean, required: true, default: false },
    audit: { type: academicCalendarAuditSchema, default: () => ({}) }
  },
  { timestamps: true }
);

academicCalendarEventSchema.index({ schoolId: 1, academicYearBs: 1, dateBs: 1 });
academicCalendarEventSchema.index({ schoolId: 1, dateBs: 1, name: 1 }, { unique: true });

export type AcademicCalendarEventDocument = InferSchemaType<typeof academicCalendarEventSchema>;
export const AcademicCalendarEvent = mongoose.model("AcademicCalendarEvent", academicCalendarEventSchema);