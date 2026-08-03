import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { softDeletePlugin } from "../plugins/softDeletePlugin.js";

const sectionSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    name: { type: String, required: true, trim: true },
    classId: { type: Schema.Types.ObjectId, ref: "SchoolClass", required: true },
    room: { type: String },
    capacity: { type: Number, required: true },
    classTeacherId: { type: Schema.Types.ObjectId, ref: "Teacher" }
  },
  { timestamps: true }
);

sectionSchema.index({ schoolId: 1, classId: 1, name: 1 }, { unique: true });

export type SectionDocument = InferSchemaType<typeof sectionSchema>;
sectionSchema.plugin(softDeletePlugin);
export const Section = mongoose.model("Section", sectionSchema);
