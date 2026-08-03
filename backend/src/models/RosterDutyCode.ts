import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { softDeletePlugin } from "../plugins/softDeletePlugin.js";

/**
 * Free-form roster cell codes (Off, Leave, ID, DW, …).
 * Managed like departments / shifts under Hospital Roster.
 */
const rosterDutyCodeSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    code: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    sortOrder: { type: Number, default: 100 },
    isActive: { type: Boolean, default: true },
    isSystem: { type: Boolean, default: false },
    /** When true, counts as leave in duty summary. */
    isLeave: { type: Boolean, default: false },
    /** When true, counts as off (not on duty) in duty summary. */
    isOff: { type: Boolean, default: false },
    color: { type: String, default: "" },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

rosterDutyCodeSchema.index({ schoolId: 1, code: 1 }, { unique: true });

export type RosterDutyCodeDocument = InferSchemaType<typeof rosterDutyCodeSchema>;
rosterDutyCodeSchema.plugin(softDeletePlugin);
export const RosterDutyCode = mongoose.model("RosterDutyCode", rosterDutyCodeSchema);
